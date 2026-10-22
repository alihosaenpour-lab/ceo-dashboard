'use strict';
const express = require('express');
const { get } = require('../db');
const cart = require('../lib/cart');
const { apiLimiter } = require('../middleware/security');

const router = express.Router();

router.get('/', (req, res) => {
  const details = cart.cartDetails(req);
  res.render('public/cart', {
    title: 'سبد خرید | اسپارک لب',
    metaDescription: '',
    details,
  });
});

router.post('/add', apiLimiter, (req, res) => {
  const pid = parseInt(req.body.product_id, 10);
  const qty = Math.max(1, Math.min(9, parseInt(req.body.qty, 10) || 1));
  const p = get('SELECT id, title FROM products WHERE id = ? AND is_active = 1', pid);
  if (!p) {
    if (req.get('content-type')?.includes('json')) return res.status(404).json({ ok: false, error: 'محصول یافت نشد' });
    req.session.flash = { type: 'bad', text: 'محصول مورد نظر یافت نشد یا فعال نیست.' };
    return res.redirect('back' in res ? '/shop' : '/shop');
  }
  cart.addItem(req, pid, qty);
  if (req.get('content-type')?.includes('json') || req.get('x-requested-with') === 'fetch') {
    return res.json({ ok: true, count: cart.cartCount(req) });
  }
  req.session.flash = { type: 'ok', text: `«${p.title}» به سبد خرید اضافه شد.` };
  res.redirect(req.body.redirect || '/cart');
});

router.post('/update', apiLimiter, (req, res) => {
  const pid = parseInt(req.body.product_id, 10);
  const qty = parseInt(req.body.qty, 10);
  if (!Number.isInteger(pid) || !Number.isInteger(qty)) {
    req.session.flash = { type: 'bad', text: 'مقادیر نامعتبر.' };
    return res.redirect('/cart');
  }
  cart.setQty(req, pid, qty);
  req.session.flash = { type: 'ok', text: 'سبد خرید به‌روزرسانی شد.' };
  res.redirect('/cart');
});

router.post('/remove', apiLimiter, (req, res) => {
  const pid = parseInt(req.body.product_id, 10);
  cart.removeItem(req, pid);
  req.session.flash = { type: 'ok', text: 'محصول از سبد خرید حذف شد.' };
  res.redirect('/cart');
});

router.post('/coupon', apiLimiter, (req, res) => {
  const code = String(req.body.coupon_code || '').trim().slice(0, 50);
  const { items } = cart.readCart(req);
  if (!code) {
    cart.saveCart(req, items, null);
    req.session.flash = { type: 'ok', text: 'کد تخفیف حذف شد.' };
    return res.redirect('/cart');
  }
  // validate via cartDetails
  const details = cart.cartDetails(items, code);
  if (details.couponError) {
    req.session.flash = { type: 'bad', text: details.couponError };
    return res.redirect('/cart');
  }
  cart.saveCart(req, items, details.coupon.code);
  req.session.flash = { type: 'ok', text: `کد تخفیف «${details.coupon.code}» اعمال شد.` };
  res.redirect('/cart');
});

router.post('/clear', apiLimiter, (req, res) => {
  cart.clearCart(req);
  req.session.flash = { type: 'ok', text: 'سبد خرید خالی شد.' };
  res.redirect('/cart');
});

module.exports = router;
