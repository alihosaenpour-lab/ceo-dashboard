'use strict';
const express = require('express');
const { get, all, run } = require('../../db');
const { validator, clean } = require('../../middleware/validate');
const { toSlugAny, uniqueSlug } = require('../../lib/helpers');
const { audit } = require('../../middleware/security');

const router = express.Router();
const NOW = () => new Date().toISOString();

router.get('/', (req, res) => {
  const categories = all(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
     FROM categories c ORDER BY c.sort_order, c.id`
  );
  res.render('admin/categories', { title: 'دسته‌بندی‌ها | اسپارک لب', adminSection: 'categories', categories, errors: {}, values: {} });
});

router.post('/new', (req, res) => {
  const v = validator(req.body);
  const name = v.string('name', 'نام دسته‌بندی', { min: 2, max: 80 });
  let slug = v.slug('slug', 'نشانی', { required: false });
  if (!slug && name) slug = toSlugAny(name) || `cat-${Date.now().toString(36)}`;
  if (slug && get('SELECT id FROM categories WHERE slug = ?', slug)) v.errors.slug = 'این نشانی قبلاً ثبت شده است.';
  const description = v.string('description', 'توضیحات', { min: 0, max: 500, required: false });
  const icon = v.string('icon', 'آیکون', { min: 0, max: 40, required: false });
  const sortOrder = v.int('sort_order', 'ترتیب', { min: 0, max: 999, required: false });
  if (!v.ok()) {
    const categories = all('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY c.sort_order, c.id');
    return res.status(400).render('admin/categories', { title: 'دسته‌بندی‌ها | اسپارک لب', adminSection: 'categories', categories, errors: v.errors, values: req.body });
  }
  slug = uniqueSlug(slug, (s) => Boolean(get('SELECT id FROM categories WHERE slug = ?', s)));
  const id = run('INSERT INTO categories (name, slug, description, icon, sort_order, is_active, created_at) VALUES (?,?,?,?,?,1,?)',
    name, slug, description, icon, sortOrder, NOW()).lastId;
  audit(req, 'category_created', { entity: 'category', entityId: id });
  req.session.flash = { type: 'ok', text: 'دسته‌بندی اضافه شد.' };
  res.redirect('/admin/categories');
});

router.post('/:id(\\d+)/edit', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = get('SELECT * FROM categories WHERE id = ?', id);
  if (!c) return res.status(404).send('not found');
  const name = clean(req.body.name).slice(2, 80) || c.name;
  const description = clean(req.body.description).slice(0, 500);
  const icon = clean(req.body.icon).slice(0, 40);
  const sortOrder = parseInt(clean(req.body.sort_order), 10) || 0;
  const isActive = req.body.is_active ? 1 : 0;
  run('UPDATE categories SET name=?, description=?, icon=?, sort_order=?, is_active=? WHERE id=?',
    clean(req.body.name).slice(0, 80) || c.name, description, icon, sortOrder, isActive, id);
  audit(req, 'category_updated', { entity: 'category', entityId: id });
  req.session.flash = { type: 'ok', text: 'دسته‌بندی به‌روزرسانی شد.' };
  res.redirect('/admin/categories');
});

router.post('/:id(\\d+)/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const used = get('SELECT COUNT(*) AS c FROM products WHERE category_id = ?', id).c;
  if (used > 0) {
    run('UPDATE categories SET is_active = 0 WHERE id = ?', id);
    req.session.flash = { type: 'ok', text: `این دسته‌بندی ${used} محصول دارد؛ حذف نشد و فقط غیرفعال شد (حذف کنترل‌شده).` };
    audit(req, 'category_soft_deleted', { entity: 'category', entityId: id });
    return res.redirect('/admin/categories');
  }
  run('DELETE FROM categories WHERE id = ?', id);
  audit(req, 'category_deleted', { entity: 'category', entityId: id });
  req.session.flash = { type: 'ok', text: 'دسته‌بندی حذف شد.' };
  res.redirect('/admin/categories');
});

module.exports = router;
