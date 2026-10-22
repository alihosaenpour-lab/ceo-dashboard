'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { get, all, run, tx } = require('../../db');
const { validator, clean } = require('../../middleware/validate');
const { jsonField, parseList, uniqueSlug, toSlugAny, sanitizeRich } = require('../../lib/helpers');
const { imageUpload, productFileUpload, sha256File } = require('../../lib/uploads');
const { audit } = require('../../middleware/security');
const config = require('../../config');

const router = express.Router();
const NOW = () => new Date().toISOString();

function productForm(res, { values = {}, errors = {}, product = null }) {
  const categories = all('SELECT id, name FROM categories WHERE is_active = 1 ORDER BY sort_order, id');
  const files = product ? all('SELECT * FROM product_files WHERE product_id = ? ORDER BY id DESC', product.id) : [];
  res.status(errors && Object.keys(errors).length ? 400 : 200).render('admin/product-form', {
    title: product ? `ویرایش محصول: ${product.title}` : 'محصول جدید',
    adminSection: 'products', categories, product, files, values, errors,
  });
}

router.get('/', (req, res) => {
  const q = clean(req.query.q).slice(0, 100);
  const where = q ? 'WHERE p.title LIKE ?' : '';
  const params = q ? [`%${q}%`] : [];
  const products = all(
    `SELECT p.*, c.name AS category_name,
       (SELECT COUNT(*) FROM product_files f WHERE f.product_id = p.id AND f.is_active = 1) AS file_count
     FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where}
     ORDER BY p.id DESC`, ...params
  );
  res.render('admin/products', { title: 'مدیریت محصولات | اسپارک لب', adminSection: 'products', products, q });
});

router.get('/new', (req, res) => productForm(res, {}));

router.get('/:id(\\d+)/edit', (req, res) => {
  const product = get('SELECT * FROM products WHERE id = ?', parseInt(req.params.id, 10));
  if (!product) return res.status(404).send('not found');
  product.features = jsonField(product.features_json);
  product.faq = jsonField(product.faq_json);
  product.images = jsonField(product.images_json);
  productForm(res, { product, values: product });
});

function readForm(req, v, existingSlug) {
  const title = v.string('title', 'عنوان محصول', { min: 3, max: 200 });
  let slug = v.slug('slug', 'نشانی (slug)', { required: false });
  if (!slug && title) slug = toSlugAny(title) || `product-${Date.now().toString(36)}`;
  if (slug && slug !== existingSlug && get('SELECT id FROM products WHERE slug = ?', slug)) {
    v.errors.slug = 'این نشانی قبلاً استفاده شده است.';
  }
  let categoryId = null;
  if (clean(req.body.category_id)) {
    categoryId = v.int('category_id', 'دسته‌بندی', { min: 1 });
    if (categoryId && !get('SELECT id FROM categories WHERE id = ?', categoryId)) {
      v.errors.category_id = 'دسته‌بندی نامعتبر است.';
      categoryId = null;
    }
  }
  const summary = v.string('summary', 'خلاصه', { min: 5, max: 500, required: false });
  const description = sanitizeRich(String(req.body.description_html || ''));
  const features = parseList(req.body.features);
  const requirements = v.string('requirements_text', 'پیش‌نیازها', { min: 0, max: 1500, required: false });
  const compatibility = v.string('compatibility_text', 'سازگاری', { min: 0, max: 1500, required: false });
  const licenseType = v.enum('license_type', 'نوع مجوز', ['standard', 'extended', 'single-site', 'developer', 'saas'], { def: 'standard' });
  const licenseNote = v.string('license_note', 'توضیح مجوز', { min: 0, max: 500, required: false });
  const supportTerms = v.string('support_terms', 'شرایط پشتیبانی', { min: 0, max: 2000, required: false });
  const price = v.int('price', 'قیمت (تومان)', { min: 0, max: 10000000000 });
  const discountRaw = clean(req.body.discount_price);
  let discountPrice = null;
  if (discountRaw !== '' && discountRaw !== '0') {
    discountPrice = v.int('discount_price', 'قیمت با تخفیف', { min: 1, max: 10000000000 });
    if (discountPrice !== null && discountPrice >= price) v.errors.discount_price = 'قیمت با تخفیف باید کمتر از قیمت اصلی باشد.';
  }
  const version = v.string('version', 'نسخه', { min: 1, max: 30, required: false }) || '1.0.0';
  const demoUrl = v.url('demo_url', 'نشانی دمو', { required: false });
  const isFeatured = v.bool('is_featured');
  const isActive = v.bool('is_active');
  const faqQ = req.body.faq_q ? [].concat(req.body.faq_q) : [];
  const faqA = req.body.faq_a ? [].concat(req.body.faq_a) : [];
  const faq = faqQ.map((q, i) => ({ q: clean(q), a: clean(faqA[i] || '') })).filter((f) => f.q && f.a);

  return {
    title, slug, categoryId, summary, description, features, requirements, compatibility,
    licenseType, licenseNote, supportTerms, price, discountPrice, version, demoUrl,
    isFeatured, isActive, faq,
  };
}

router.post('/new', imageUpload.array('images', 6), (req, res) => {
  const v = validator(req.body);
  const f = readForm(req, v, null);
  if (!f.slug) {
    f.slug = uniqueSlug(toSlugAny(f.title) || `product-${Date.now().toString(36)}`,
      (s) => Boolean(get('SELECT id FROM products WHERE slug = ?', s)));
  }
  if (!v.ok()) {
    (req.files || []).forEach((file) => fs.rm(file.path, { force: true }, () => {}));
    return productForm(res, { values: req.body, errors: v.errors });
  }
  const images = (req.files || []).map((file) => `/media/${path.basename(file.path)}`);
  const id = run(
    `INSERT INTO products
     (category_id, title, slug, summary, description_html, features_json, requirements_text, compatibility_text,
      license_type, license_note, support_terms, faq_json, price, discount_price, version, images_json, cover_image,
      demo_url, has_demo_url, is_featured, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    f.categoryId, f.title, f.slug, f.summary, f.description, JSON.stringify(f.features), f.requirements,
    f.compatibility, f.licenseType, f.licenseNote, f.supportTerms, JSON.stringify(f.faq), f.price,
    f.discountPrice, f.version, JSON.stringify(images), images[0] || null,
    f.demoUrl || null, f.demoUrl ? 1 : 0, f.isFeatured, f.isActive, NOW()
  ).lastId;
  audit(req, 'product_created', { entity: 'product', entityId: id, details: { slug: f.slug } });
  req.session.flash = { type: 'ok', text: `محصول «${f.title}» ایجاد شد. فایل محصول را در صفحه ویرایش بارگذاری کنید.` };
  res.redirect(`/admin/products/${id}/edit`);
});

router.post('/:id(\\d+)/edit', imageUpload.array('images', 6), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const product = get('SELECT * FROM products WHERE id = ?', id);
  if (!product) return res.status(404).send('not found');
  const v = validator(req.body);
  const f = readForm(req, v, product.slug);
  if (!v.ok()) {
    (req.files || []).forEach((file) => fs.rm(file.path, { force: true }, () => {}));
    product.features = parseList(req.body.features);
    product.faq = [];
    product.images = jsonField(product.images_json);
    return productForm(res, { values: { ...product, ...req.body }, errors: v.errors, product });
  }
  const newImages = (req.files || []).map((file) => `/media/${path.basename(file.path)}`);
  const keepImages = [].concat(req.body.keep_images || []).filter((s) => String(s).startsWith('/media/'));
  const images = [...keepImages, ...newImages].slice(0, 8);
  const cover = clean(req.body.cover_image).startsWith('/media/') ? clean(req.body.cover_image) : (images[0] || product.cover_image);
  run(
    `UPDATE products SET category_id=?, title=?, slug=?, summary=?, description_html=?, features_json=?,
       requirements_text=?, compatibility_text=?, license_type=?, license_note=?, support_terms=?, faq_json=?,
       price=?, discount_price=?, version=?, images_json=?, cover_image=?, demo_url=?, has_demo_url=?,
       is_featured=?, is_active=?, updated_at=? WHERE id=?`,
    f.categoryId, f.title, f.slug, f.summary, f.description, JSON.stringify(f.features), f.requirements,
    f.compatibility, f.licenseType, f.licenseNote, f.supportTerms, JSON.stringify(f.faq), f.price,
    f.discountPrice, f.version, JSON.stringify(images), cover,
    f.demoUrl || null, f.demoUrl ? 1 : 0, f.isFeatured, f.isActive, NOW(), id
  );
  audit(req, 'product_updated', { entity: 'product', entityId: id });
  req.session.flash = { type: 'ok', text: 'محصول به‌روزرسانی شد.' };
  res.redirect(`/admin/products/${id}/edit`);
});

/* ---------- product files (versions, private storage) ---------- */
router.post('/:id(\\d+)/files', productFileUpload.single('file'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const product = get('SELECT * FROM products WHERE id = ?', id);
  if (!product) return res.status(404).send('not found');
  if (!req.file) {
    req.session.flash = { type: 'bad', text: 'فایلی دریافت نشد.' };
    return res.redirect(`/admin/products/${id}/edit`);
  }
  const version = clean(req.body.version).slice(0, 30) || product.version || '1.0.0';
  const label = clean(req.body.label).slice(0, 120);
  let sha = null;
  try { sha = await sha256File(req.file.path); } catch (_) {}
  const fid = run(
    `INSERT INTO product_files (product_id, version, label, original_name, stored_name, mime, size, sha256, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?)`,
    id, version, label, req.file.originalname.slice(0, 200), path.basename(req.file.path),
    req.file.mimetype || '', req.file.size, sha, NOW()
  ).lastId;
  audit(req, 'product_file_uploaded', { entity: 'product_file', entityId: fid, details: { product: id, size: req.file.size } });
  req.session.flash = { type: 'ok', text: `فایل نسخه ${version} بارگذاری شد (در فضای خصوصی نگهداری می‌شود).` };
  res.redirect(`/admin/products/${id}/edit`);
});

router.post('/files/:fid(\\d+)/deactivate', (req, res) => {
  const f = get('SELECT * FROM product_files WHERE id = ?', parseInt(req.params.fid, 10));
  if (!f) return res.status(404).send('not found');
  run('UPDATE product_files SET is_active = 0 WHERE id = ?', f.id);
  audit(req, 'product_file_deactivated', { entity: 'product_file', entityId: f.id });
  req.session.flash = { type: 'ok', text: 'فایل غیرفعال شد (لینک‌های دانلود قدیمی از کار می‌افتند).' };
  res.redirect(`/admin/products/${f.product_id}/edit`);
});

/* ---------- toggle / controlled delete ---------- */
router.post('/:id(\\d+)/toggle', (req, res) => {
  const p = get('SELECT * FROM products WHERE id = ?', parseInt(req.params.id, 10));
  if (!p) return res.status(404).send('not found');
  run('UPDATE products SET is_active = ?, updated_at = ? WHERE id = ?', p.is_active ? 0 : 1, NOW(), p.id);
  audit(req, 'product_toggled', { entity: 'product', entityId: p.id, details: { active: !p.is_active } });
  req.session.flash = { type: 'ok', text: p.is_active ? 'محصول غیرفعال شد.' : 'محصول فعال شد.' };
  res.redirect('/admin/products');
});

router.post('/:id(\\d+)/delete', (req, res) => {
  if (req.user.role !== 'admin') {
    req.session.flash = { type: 'bad', text: 'حذف محصول فقط با نقش مدیر ممکن است.' };
    return res.redirect('/admin/products');
  }
  const p = get('SELECT * FROM products WHERE id = ?', parseInt(req.params.id, 10));
  if (!p) return res.status(404).send('not found');
  const sold = get(`SELECT COUNT(*) AS c FROM orders WHERE status='paid' AND items_json LIKE ?`, `%"product_id":${p.id}%`).c;
  if (sold > 0) {
    run('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?', NOW(), p.id);
    audit(req, 'product_soft_deleted', { entity: 'product', entityId: p.id });
    req.session.flash = { type: 'ok', text: 'این محصول سابقه فروش دارد؛ برای حفظ سوابق سفارش‌ها به‌جای حذف، غیرفعال شد (حذف کنترل‌شده).' };
    return res.redirect('/admin/products');
  }
  const files = all('SELECT stored_name FROM product_files WHERE product_id = ?', p.id);
  tx(() => { run('DELETE FROM products WHERE id = ?', p.id); });
  for (const f of files) fs.rm(path.join(config.privateFilesDir, f.stored_name), { force: true }, () => {});
  audit(req, 'product_deleted', { entity: 'product', entityId: p.id });
  req.session.flash = { type: 'ok', text: 'محصول و فایل‌های آن حذف شدند.' };
  res.redirect('/admin/products');
});

module.exports = router;
