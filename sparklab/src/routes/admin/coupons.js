'use strict';
const express = require('express');
const { get, all, run } = require('../../db');
const { validator, clean } = require('../../middleware/validate');
const { audit } = require('../../middleware/security');

const router = express.Router();
const NOW = () => new Date().toISOString();

function list(res, { errors = {}, values = {} } = {}) {
  const coupons = all('SELECT * FROM coupons ORDER BY id DESC');
  res.status(Object.keys(errors).length ? 400 : 200).render('admin/coupons', {
    title: 'کدهای تخفیف | اسپارک لب', adminSection: 'coupons', coupons, errors, values,
  });
}

router.get('/', (req, res) => list(res));

router.post('/new', (req, res) => {
  const v = validator(req.body);
  const code = clean(req.body.code).toUpperCase().replace(/[^A-Z0-9\-_]/g, '').slice(0, 30);
  if (!code || code.length < 3) v.errors.code = 'کد تخفیف باید حداقل ۳ نویسه انگلیسی/عدد باشد.';
  if (code && get('SELECT id FROM coupons WHERE code = ?', code)) v.errors.code = 'این کد قبلاً ثبت شده است.';
  const type = v.enum('type', 'نوع تخفیف', ['percent', 'fixed']);
  const value = v.int('value', 'مقدار تخفیف', { min: 1, max: type === 'percent' ? 100 : 10000000000 });
  if (type === 'percent' && value > 100) v.errors.value = 'تخفیف درصدی نمی‌تواند بیش از ۱۰۰ باشد.';
  const minTotal = v.int('min_total', 'حداقل مبلغ سفارش', { min: 0, required: false });
  const maxDiscountRaw = clean(req.body.max_discount);
  const maxDiscount = maxDiscountRaw === '' ? null : v.int('max_discount', 'سقف تخفیف', { min: 1 });
  const maxUsesRaw = clean(req.body.max_uses);
  const maxUses = maxUsesRaw === '' ? null : v.int('max_uses', 'سقف استفاده', { min: 1 });
  const expiresRaw = clean(req.body.expires_at);
  let expiresAt = null;
  if (expiresRaw) {
    const d = new Date(expiresRaw);
    if (isNaN(d.getTime())) v.errors.expires_at = 'تاریخ انقضا معتبر نیست.';
    else expiresAt = d.toISOString();
  }
  if (!v.ok()) return list(res, { errors: v.errors, values: req.body });
  const id = run(
    `INSERT INTO coupons (code, type, value, min_total, max_discount, max_uses, expires_at, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    code, type, value, minTotal, maxDiscount, maxUses, expiresAt, 1, NOW()
  ).lastId;
  audit(req, 'coupon_created', { entity: 'coupon', entityId: id, details: { code } });
  req.session.flash = { type: 'ok', text: `کد تخفیف ${code} ساخته شد.` };
  res.redirect('/admin/coupons');
});

router.post('/:id(\\d+)/toggle', (req, res) => {
  const c = get('SELECT * FROM coupons WHERE id = ?', parseInt(req.params.id, 10));
  if (!c) return res.status(404).send('not found');
  run('UPDATE coupons SET is_active = ? WHERE id = ?', c.is_active ? 0 : 1, c.id);
  audit(req, 'coupon_toggled', { entity: 'coupon', entityId: c.id });
  req.session.flash = { type: 'ok', text: c.is_active ? 'کد غیرفعال شد.' : 'کد فعال شد.' };
  res.redirect('/admin/coupons');
});

router.post('/:id(\\d+)/delete', (req, res) => {
  if (req.user.role !== 'admin') {
    req.session.flash = { type: 'bad', text: 'حذف کد تخفیف فقط با نقش مدیر ممکن است.' };
    return res.redirect('/admin/coupons');
  }
  const c = get('SELECT * FROM coupons WHERE id = ?', parseInt(req.params.id, 10));
  if (!c) return res.status(404).send('not found');
  if (c.used_count > 0) {
    run('UPDATE coupons SET is_active = 0 WHERE id = ?', c.id);
    req.session.flash = { type: 'ok', text: 'این کد سابقه استفاده دارد؛ غیرفعال شد (حذف کنترل‌شده).' };
    audit(req, 'coupon_soft_deleted', { entity: 'coupon', entityId: c.id });
    return res.redirect('/admin/coupons');
  }
  run('DELETE FROM coupons WHERE id = ?', c.id);
  audit(req, 'coupon_deleted', { entity: 'coupon', entityId: c.id });
  req.session.flash = { type: 'ok', text: 'کد تخفیف حذف شد.' };
  res.redirect('/admin/coupons');
});

module.exports = router;
