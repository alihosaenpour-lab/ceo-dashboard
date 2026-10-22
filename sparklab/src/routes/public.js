'use strict';
const express = require('express');
const { get, all, run } = require('../db');
const { jsonField, sanitizeRich, percentOff, fmtMoney } = require('../lib/helpers');
const { getSetting } = require('../lib/settings');
const { validator, clean } = require('../middleware/validate');
const { formLimiter, audit, clientIp } = require('../middleware/security');

const router = express.Router();
const now = () => new Date().toISOString();

function activeProduct(p) {
  return {
    ...p,
    features: jsonField(p.features_json),
    faq: jsonField(p.faq_json),
    images: jsonField(p.images_json),
    off: percentOff(p.price, p.discount_price),
    finalPrice: p.discount_price && p.discount_price > 0 && p.discount_price < p.price ? p.discount_price : p.price,
  };
}

/* ---------- Home ---------- */
router.get('/', (req, res) => {
  const featured = all(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = 1 ORDER BY p.is_featured DESC, p.sales_count DESC, p.id DESC LIMIT 6`
  ).map(activeProduct);
  const categories = all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id LIMIT 8');
  const portfolio = all('SELECT * FROM portfolio_items WHERE is_active = 1 ORDER BY sort_order, id DESC LIMIT 3');
  const banners = all('SELECT * FROM banners WHERE is_active = 1 ORDER BY sort_order, id LIMIT 2');
  const stats = jsonField(getSetting('home.stats_json', '[]'));
  res.render('public/home', {
    title: getSetting('home.meta_title', 'اسپارک لب | فروشگاه محصولات دیجیتال و سفارش طراحی نرم‌افزار'),
    metaDescription: getSetting('home.meta_description', 'اسپارک لب — فروش محصولات دیجیتال آماده (نرم‌افزار مدیریتی، قالب، افزونه، ابزار هوش مصنوعی) و دریافت سفارش طراحی سایت، اپلیکیشن و اتوماسیون کسب‌وکار.'),
    heroTitle: getSetting('home_hero_title', 'نرم‌افزاری که کسب‌وکار شما را یک گام جلوتر می‌برد'),
    heroSubtitle: getSetting('home_hero_subtitle', ''),
    featured, categories, portfolio, banners, stats,
  });
});

/* ---------- Shop ---------- */
router.get('/shop', (req, res) => {
  const categories = all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id');
  const q = clean(req.query.q).slice(0, 120);
  const catSlug = clean(req.query.category).slice(0, 120);
  const type = ['all', ' discounted', 'featured'].includes(req.query.type) ? req.query.type : (req.query.type === 'discounted' || req.query.type === 'featured' ? req.query.type : 'all');
  const minP = /^\d+$/.test(clean(req.query.min)) ? parseInt(clean(req.query.min), 10) : null;
  const maxP = /^\d+$/.test(clean(req.query.max)) ? parseInt(clean(req.query.max), 10) : null;
  const sort = ['newest', 'cheapest', 'priciest', 'bestselling'].includes(req.query.sort) ? req.query.sort : 'newest';
  const page = Math.max(1, parseInt(clean(req.query.page), 10) || 1);
  const perPage = 12;

  const where = ['p.is_active = 1'];
  const params = [];
  if (q) {
    where.push('(p.title LIKE ? OR p.summary LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  let category = null;
  if (catSlug) {
    category = get('SELECT * FROM categories WHERE slug = ? AND is_active = 1', catSlug);
    if (category) { where.push('p.category_id = ?'); params.push(category.id); }
  }
  if (type === 'discounted') where.push('p.discount_price IS NOT NULL AND p.discount_price > 0 AND p.discount_price < p.price');
  if (type === 'featured') where.push('p.is_featured = 1');
  if (minP !== null) where.push('COALESCE(NULLIF(p.discount_price,0), p.price) >= ?'), params.push(minP);
  if (maxP !== null) where.push('COALESCE(NULLIF(p.discount_price,0), p.price) <= ?'), params.push(maxP);

  const orderSql = {
    newest: 'p.id DESC',
    cheapest: 'COALESCE(NULLIF(p.discount_price,0), p.price) ASC',
    priciest: 'COALESCE(NULLIF(p.discount_price,0), p.price) DESC',
    bestselling: 'p.sales_count DESC, p.id DESC',
  }[sort];

  const total = get(`SELECT COUNT(*) AS c FROM products p WHERE ${where.join(' AND ')}`, ...params).c;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const products = all(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where.join(' AND ')} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    ...params, perPage, (Math.min(page, pages) - 1) * perPage
  ).map(activeProduct);

  res.render('public/shop', {
    title: `${category ? category.name + ' — ' : ''}فروشگاه | اسپارک لب`,
    metaDescription: 'فروشگاه محصولات دیجیتال اسپارک لب — نرم‌افزارهای مدیریتی، قالب و افزونه، ابزارهای هوش مصنوعی با تحویل فوری پس از پرداخت.',
    products, categories, category, q, type, minP, maxP, sort, page: Math.min(page, pages), pages, total,
  });
});

/* ---------- Product ---------- */
router.get('/product/:slug', (req, res, next) => {
  const p = get(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = ? AND p.is_active = 1`, req.params.slug
  );
  if (!p) return next();
  run('UPDATE products SET views_count = views_count + 1 WHERE id = ?', p.id);
  const product = activeProduct(p);
  product.descriptionHtml = sanitizeRich(p.description_html || '');
  const files = all('SELECT version, label, size, created_at FROM product_files WHERE product_id = ? AND is_active = 1 ORDER BY id DESC', p.id);
  const related = all(
    `SELECT * FROM products WHERE is_active = 1 AND id != ? AND (category_id = ? OR is_featured = 1)
     ORDER BY CASE WHEN category_id = ? THEN 0 ELSE 1 END, sales_count DESC LIMIT 4`,
    p.id, p.category_id, p.category_id
  ).map(activeProduct);
  const faq = product.faq;
  res.render('public/product', {
    title: `${p.title} | اسپارک لب`,
    metaDescription: (p.summary || '').slice(0, 158) || `خرید ${p.title} از اسپارک لب — تحویل فوری فایل پس از پرداخت، پشتیبانی و مجوز رسمی.`,
    product, files, related, faq,
  });
});

/* ---------- Services ---------- */
router.get('/services', (req, res) => {
  const services = jsonField(getSetting('services.items_json', '[]'));
  res.render('public/services', {
    title: 'خدمات تخصصی طراحی و توسعه نرم‌افزار | اسپارک لب',
    metaDescription: 'طراحی سایت، توسعه اپلیکیشن، اتوماسیون کسب‌وکار، نرم‌افزارهای مدیریتی، داشبورد سازمانی و راهکارهای هوش مصنوعی — سفارش پروژه در اسپارک لب.',
    services,
  });
});

/* ---------- Portfolio ---------- */
router.get('/portfolio', (req, res) => {
  const items = all('SELECT * FROM portfolio_items WHERE is_active = 1 ORDER BY sort_order, id DESC').map((i) => ({
    ...i, features: jsonField(i.features_json), tech: jsonField(i.tech_json),
  }));
  res.render('public/portfolio', {
    title: 'نمونه‌کارها | اسپارک لب',
    metaDescription: 'نمونه پروژه‌های انجام‌شده توسط تیم اسپارک لب — فروشگاه اینترنتی، داشبورد سازمانی، اپلیکیشن موبایل و اتوماسیون کسب‌وکار.',
    items,
  });
});
router.get('/portfolio/:slug', (req, res, next) => {
  const item = get('SELECT * FROM portfolio_items WHERE slug = ? AND is_active = 1', req.params.slug);
  if (!item) return next();
  item.features = jsonField(item.features_json);
  item.tech = jsonField(item.tech_json);
  res.render('public/portfolio-item', {
    title: `${item.title} | نمونه‌کار اسپارک لب`,
    metaDescription: (item.summary || '').slice(0, 158),
    item,
  });
});

/* ---------- FAQ ---------- */
router.get('/faq', (req, res) => {
  const faqs = all('SELECT * FROM faqs WHERE is_active = 1 ORDER BY group_name, sort_order, id');
  const groups = {};
  for (const f of faqs) { (groups[f.group_name] = groups[f.group_name] || []).push(f); }
  res.render('public/faq', {
    title: 'پرسش‌های متداول | اسپارک لب',
    metaDescription: 'پاسخ پرسش‌های پرتکرار درباره خرید، تحویل فایل، پشتیبانی، بازپرداخت و سفارش پروژه در اسپارک لب.',
    groups, faqs,
  });
});

/* ---------- Contact ---------- */
router.get('/contact', (req, res) => {
  res.render('public/contact', {
    title: 'تماس با ما | اسپارک لب',
    metaDescription: 'راه‌های ارتباطی با تیم اسپارک لب — تلفن، ایمیل، شبکه‌های اجتماعی و فرم تماس.',
    values: {}, errors: {},
  });
});
router.post('/contact', formLimiter, (req, res) => {
  const v = validator(req.body);
  const name = v.string('name', 'نام', { min: 2, max: 100 });
  const email = v.email('email');
  const phone = v.phone('phone', 'شماره تماس', { required: false });
  const subject = v.string('subject', 'موضوع', { min: 2, max: 150, required: false });
  const body = v.string('body', 'متن پیام', { min: 10, max: 4000 });
  if (!v.ok()) {
    return res.status(400).render('public/contact', {
      title: 'تماس با ما | اسپارک لب', metaDescription: '', values: req.body, errors: v.errors,
    });
  }
  run('INSERT INTO contact_messages (name, email, phone, subject, body, created_at) VALUES (?,?,?,?,?,?)',
    name, email, phone, subject, body, now());
  audit(req, 'contact_message_created', { details: { email } });
  req.session.flash = { type: 'ok', text: 'پیام شما ثبت شد. تیم اسپارک لب در اولین فرصت پاسخ می‌دهد.' };
  res.redirect('/contact');
});

/* ---------- Static-ish pages managed in admin (about, terms, privacy...) ---------- */
router.get('/p/:slug', (req, res, next) => {
  const page = get('SELECT * FROM pages WHERE slug = ? AND is_active = 1', req.params.slug);
  if (!page) return next();
  res.render('public/page', {
    title: page.meta_title || `${page.title} | اسپارک لب`,
    metaDescription: page.meta_description || '',
    page,
    bodyHtml: sanitizeRich(page.body_html || ''),
  });
});

/* ---------- JSON-LD helpers are inlined in views ---------- */

module.exports = router;
