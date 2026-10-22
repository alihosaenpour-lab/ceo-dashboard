'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { get, all, run } = require('../../db');
const { validator, clean } = require('../../middleware/validate');
const { sanitizeRich, parseList, jsonField, toSlugAny, uniqueSlug } = require('../../lib/helpers');
const { imageUpload } = require('../../lib/uploads');
const { audit } = require('../../middleware/security');
const config = require('../../config');

const router = express.Router();
const NOW = () => new Date().toISOString();

/* ================= pages ================= */
router.get('/pages', (req, res) => {
  const pages = all('SELECT * FROM pages ORDER BY sort_order, id');
  res.render('admin/pages', { title: 'مدیریت صفحات | اسپارک لب', adminSection: 'content', pages });
});

router.get('/pages/:id(\\d+)/edit', (req, res) => {
  const page = get('SELECT * FROM pages WHERE id = ?', parseInt(req.params.id, 10));
  if (!page) return res.status(404).send('not found');
  res.render('admin/page-form', { title: `ویرایش صفحه: ${page.title}`, adminSection: 'content', page, values: page, errors: {} });
});

router.post('/pages/:id(\\d+)/edit', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const page = get('SELECT * FROM pages WHERE id = ?', id);
  if (!page) return res.status(404).send('not found');
  const v = validator(req.body);
  const title = v.string('title', 'عنوان', { min: 2, max: 200 });
  const body = sanitizeRich(String(req.body.body_html || ''));
  const metaTitle = v.string('meta_title', 'عنوان سئو', { min: 0, max: 120, required: false });
  const metaDescription = v.string('meta_description', 'توضیحات سئو', { min: 0, max: 300, required: false });
  const showInFooter = v.bool('show_in_footer');
  const isActive = v.bool('is_active');
  if (!v.ok()) return res.status(400).render('admin/page-form', { title: 'ویرایش صفحه', adminSection: 'content', page, values: req.body, errors: v.errors });
  run('UPDATE pages SET title=?, body_html=?, meta_title=?, meta_description=?, show_in_footer=?, is_active=?, updated_at=? WHERE id=?',
    title, body, metaTitle, metaDescription, showInFooter ? 1 : 0, isActive ? 1 : 0, NOW(), id);
  audit(req, 'page_updated', { entity: 'page', entityId: id });
  req.session.flash = { type: 'ok', text: 'صفحه ذخیره شد.' };
  res.redirect('/admin/content/pages');
});

router.post('/pages/new', (req, res) => {
  const v = validator(req.body);
  const title = v.string('title', 'عنوان', { min: 2, max: 200 });
  let slug = v.slug('slug', 'نشانی', { required: false });
  if (!slug) slug = toSlugAny(title) || `page-${Date.now().toString(36)}`;
  if (get('SELECT id FROM pages WHERE slug = ?', slug)) v.errors.slug = 'این نشانی قبلاً استفاده شده است.';
  if (!v.ok()) {
    req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] };
    return res.redirect('/admin/content/pages');
  }
  const id = run('INSERT INTO pages (slug, title, body_html, is_active, updated_at) VALUES (?,?,?,?,?)',
    slug, title, sanitizeRich(String(req.body.body_html || '')), 1, NOW()).lastId;
  audit(req, 'page_created', { entity: 'page', entityId: id });
  req.session.flash = { type: 'ok', text: 'صفحه جدید ساخته شد.' };
  res.redirect(`/admin/content/pages/${id}/edit`);
});

/* ================= portfolio ================= */
router.get('/portfolio', (req, res) => {
  const items = all('SELECT * FROM portfolio_items ORDER BY sort_order, id DESC');
  res.render('admin/portfolio', { title: 'نمونه‌کارها | اسپارک لب', adminSection: 'content', items });
});

router.get('/portfolio/:id(\\d+)/edit', (req, res) => {
  const item = get('SELECT * FROM portfolio_items WHERE id = ?', parseInt(req.params.id, 10));
  if (!item) return res.status(404).send('not found');
  item.features = jsonField(item.features_json);
  item.tech = jsonField(item.tech_json);
  res.render('admin/portfolio-form', { title: `ویرایش نمونه‌کار: ${item.title}`, adminSection: 'content', item, values: item, errors: {} });
});

router.post('/portfolio/new', imageUpload.single('cover'), (req, res) => {
  const v = validator(req.body);
  const title = v.string('title', 'عنوان', { min: 3, max: 200 });
  let slug = v.slug('slug', 'نشانی', { required: false }) || toSlugAny(title) || `work-${Date.now().toString(36)}`;
  if (get('SELECT id FROM portfolio_items WHERE slug = ?', slug)) v.errors.slug = 'نشانی تکراری است.';
  if (!v.ok()) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] };
    return res.redirect('/admin/content/portfolio');
  }
  const cover = req.file ? `/media/${path.basename(req.file.path)}` : null;
  const id = run(
    `INSERT INTO portfolio_items (title, slug, summary, cover_image, is_active, created_at)
     VALUES (?,?,?,?,1,?)`,
    title, uniqueSlug(slug, (s) => Boolean(get('SELECT id FROM portfolio_items WHERE slug = ?', s))),
    clean(req.body.summary).slice(0, 500), cover, NOW()
  ).lastId;
  audit(req, 'portfolio_created', { entity: 'portfolio', entityId: id });
  req.session.flash = { type: 'ok', text: 'نمونه‌کار ساخته شد — جزئیات را کامل کنید.' };
  res.redirect(`/admin/content/portfolio/${id}/edit`);
});

router.post('/portfolio/:id(\\d+)/edit', imageUpload.single('cover'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = get('SELECT * FROM portfolio_items WHERE id = ?', id);
  if (!item) return res.status(404).send('not found');
  const v = validator(req.body);
  const title = v.string('title', 'عنوان', { min: 3, max: 200 });
  const clientLabel = v.string('client_label', 'کارفرما', { min: 0, max: 120, required: false });
  const summary = v.string('summary', 'خلاصه', { min: 0, max: 500, required: false });
  const problemText = v.string('problem_text', 'مسئله', { min: 0, max: 4000, required: false });
  const solutionText = v.string('solution_text', 'راه‌حل', { min: 0, max: 4000, required: false });
  const resultMetric = v.string('result_metric', 'دستاورد', { min: 0, max: 200, required: false });
  const url = v.url('url', 'نشانی پروژه', { required: false });
  const features = parseList(req.body.features);
  const tech = parseList(req.body.tech);
  if (!v.ok()) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    item.features = features; item.tech = tech;
    return res.status(400).render('admin/portfolio-form', { title: 'ویرایش نمونه‌کار', adminSection: 'content', item, values: { ...item, ...req.body }, errors: v.errors });
  }
  const cover = req.file ? `/media/${path.basename(req.file.path)}` : item.cover_image;
  run(
    `UPDATE portfolio_items SET title=?, client_label=?, summary=?, problem_text=?, solution_text=?, result_metric=?,
     url=?, features_json=?, tech_json=?, cover_image=?, is_active=?, sort_order=? WHERE id=?`,
    title, clientLabel, summary, problemText, solutionText, resultMetric, url || null,
    JSON.stringify(features), JSON.stringify(tech), cover,
    v.bool('is_active') ? 1 : 0, parseInt(clean(req.body.sort_order), 10) || 0, id
  );
  audit(req, 'portfolio_updated', { entity: 'portfolio', entityId: id });
  req.session.flash = { type: 'ok', text: 'نمونه‌کار به‌روزرسانی شد.' };
  res.redirect(`/admin/content/portfolio/${id}/edit`);
});

router.post('/portfolio/:id(\\d+)/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  run('DELETE FROM portfolio_items WHERE id = ?', id);
  audit(req, 'portfolio_deleted', { entity: 'portfolio', entityId: id });
  req.session.flash = { type: 'ok', text: 'نمونه‌کار حذف شد.' };
  res.redirect('/admin/content/portfolio');
});

/* ================= banners ================= */
router.get('/banners', (req, res) => {
  const banners = all('SELECT * FROM banners ORDER BY sort_order, id');
  res.render('admin/banners', { title: 'بنرها | اسپارک لب', adminSection: 'content', banners });
});

router.post('/banners/new', imageUpload.single('image'), (req, res) => {
  const v = validator(req.body);
  const title = v.string('title', 'عنوان بنر', { min: 2, max: 200 });
  if (!v.ok()) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] };
    return res.redirect('/admin/content/banners');
  }
  run(`INSERT INTO banners (title, subtitle, cta_text, cta_url, image, is_active, sort_order, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    title, clean(req.body.subtitle).slice(0, 400), clean(req.body.cta_text).slice(0, 60),
    clean(req.body.cta_url).slice(0, 300), req.file ? `/media/${path.basename(req.file.path)}` : null,
    v.bool('is_active') ? 1 : 0, parseInt(clean(req.body.sort_order), 10) || 0, NOW());
  audit(req, 'banner_created', { entity: 'banner' });
  req.session.flash = { type: 'ok', text: 'بنر اضافه شد.' };
  res.redirect('/admin/content/banners');
});

router.post('/banners/:id(\\d+)/edit', imageUpload.single('image'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = get('SELECT * FROM banners WHERE id = ?', id);
  if (!b) return res.status(404).send('not found');
  run(`UPDATE banners SET title=?, subtitle=?, cta_text=?, cta_url=?, image=?, is_active=?, sort_order=? WHERE id=?`,
    clean(req.body.title).slice(0, 200) || b.title, clean(req.body.subtitle).slice(0, 400),
    clean(req.body.cta_text).slice(0, 60), clean(req.body.cta_url).slice(0, 300),
    req.file ? `/media/${path.basename(req.file.path)}` : b.image,
    req.body.is_active ? 1 : 0, parseInt(clean(req.body.sort_order), 10) || b.sort_order, id);
  audit(req, 'banner_updated', { entity: 'banner', entityId: id });
  req.session.flash = { type: 'ok', text: 'بنر به‌روزرسانی شد.' };
  res.redirect('/admin/content/banners');
});

router.post('/banners/:id(\\d+)/delete', (req, res) => {
  run('DELETE FROM banners WHERE id = ?', parseInt(req.params.id, 10));
  audit(req, 'banner_deleted', { entity: 'banner', entityId: req.params.id });
  req.session.flash = { type: 'ok', text: 'بنر حذف شد.' };
  res.redirect('/admin/content/banners');
});

/* ================= faqs ================= */
router.get('/faqs', (req, res) => {
  const faqs = all('SELECT * FROM faqs ORDER BY group_name, sort_order, id');
  res.render('admin/faqs', { title: 'پرسش‌های متداول | اسپارک لب', adminSection: 'content', faqs });
});

router.post('/faqs/new', (req, res) => {
  const v = validator(req.body);
  const question = v.string('question', 'پرسش', { min: 5, max: 300 });
  const answer = v.string('answer', 'پاسخ', { min: 5, max: 4000 });
  const group = v.string('group_name', 'گروه', { min: 1, max: 60, required: false }) || 'عمومی';
  if (!v.ok()) { req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] }; return res.redirect('/admin/content/faqs'); }
  run('INSERT INTO faqs (question, answer, group_name, sort_order, is_active, created_at) VALUES (?,?,?,?,1,?)',
    question, answer, group, parseInt(clean(req.body.sort_order), 10) || 0, NOW());
  audit(req, 'faq_created', { entity: 'faq' });
  req.session.flash = { type: 'ok', text: 'پرسش اضافه شد.' };
  res.redirect('/admin/content/faqs');
});

router.post('/faqs/:id(\\d+)/edit', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const f = get('SELECT * FROM faqs WHERE id = ?', id);
  if (!f) return res.status(404).send('not found');
  run('UPDATE faqs SET question=?, answer=?, group_name=?, sort_order=?, is_active=? WHERE id=?',
    clean(req.body.question).slice(0, 300) || f.question,
    clean(req.body.answer).slice(0, 4000) || f.answer,
    clean(req.body.group_name).slice(0, 60) || f.group_name,
    parseInt(clean(req.body.sort_order), 10) || f.sort_order,
    req.body.is_active ? 1 : 0, id);
  audit(req, 'faq_updated', { entity: 'faq', entityId: id });
  req.session.flash = { type: 'ok', text: 'پرسش به‌روزرسانی شد.' };
  res.redirect('/admin/content/faqs');
});

router.post('/faqs/:id(\\d+)/delete', (req, res) => {
  run('DELETE FROM faqs WHERE id = ?', parseInt(req.params.id, 10));
  audit(req, 'faq_deleted', { entity: 'faq', entityId: req.params.id });
  req.session.flash = { type: 'ok', text: 'پرسش حذف شد.' };
  res.redirect('/admin/content/faqs');
});

/* ================= contact messages ================= */
router.get('/messages', (req, res) => {
  const messages = all('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200');
  res.render('admin/messages', { title: 'پیام‌های تماس | اسپارک لب', adminSection: 'content', messages });
});
router.post('/messages/:id(\\d+)/read', (req, res) => {
  run('UPDATE contact_messages SET is_read = 1 WHERE id = ?', parseInt(req.params.id, 10));
  res.redirect('/admin/content/messages');
});
router.post('/messages/:id(\\d+)/delete', (req, res) => {
  run('DELETE FROM contact_messages WHERE id = ?', parseInt(req.params.id, 10));
  audit(req, 'contact_message_deleted', { entity: 'message', entityId: req.params.id });
  res.redirect('/admin/content/messages');
});

module.exports = router;
