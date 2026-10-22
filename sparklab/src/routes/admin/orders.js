'use strict';
const express = require('express');
const { get, all, run } = require('../../db');
const { jsonField } = require('../../lib/helpers');
const { audit } = require('../../middleware/security');
const { setOrderStatus } = require('../../lib/orders');
const downloads = require('../../lib/downloads');

const router = express.Router();
const NOW = () => new Date().toISOString();

router.get('/', (req, res) => {
  const status = ['pending', 'paid', 'failed', 'cancelled', 'refunded'].includes(req.query.status) ? req.query.status : '';
  const q = String(req.query.q || '').trim().slice(0, 100);
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (q) { where.push('(order_no LIKE ? OR buyer_email LIKE ? OR buyer_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const orders = all(
    `SELECT o.*, u.name AS account_name FROM orders o LEFT JOIN users u ON u.id = o.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 200`, ...params
  ).map((o) => ({ ...o, items: jsonField(o.items_json) }));
  const counts = {
    all: get('SELECT COUNT(*) AS c FROM orders').c,
    pending: get(`SELECT COUNT(*) AS c FROM orders WHERE status='pending'`).c,
    paid: get(`SELECT COUNT(*) AS c FROM orders WHERE status='paid'`).c,
    failed: get(`SELECT COUNT(*) AS c FROM orders WHERE status='failed'`).c,
    refunded: get(`SELECT COUNT(*) AS c FROM orders WHERE status='refunded'`).c,
  };
  res.render('admin/orders', { title: 'سفارش‌ها | اسپارک لب', adminSection: 'orders', orders, status, q, counts });
});

router.get('/:orderNo', (req, res) => {
  const order = get('SELECT * FROM orders WHERE order_no = ?', req.params.orderNo);
  if (!order) return res.status(404).send('not found');
  order.items = jsonField(order.items_json);
  const user = order.user_id ? get('SELECT id, name, email, phone, role FROM users WHERE id = ?', order.user_id) : null;
  const payments = all('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC', order.id);
  const grants = downloads.grantsForOrder(order.id);
  const logs = all(
    `SELECT l.*, g.product_id FROM download_logs l JOIN download_grants g ON g.id = l.grant_id
     WHERE g.order_id = ? ORDER BY l.id DESC LIMIT 30`, order.id
  );
  res.render('admin/order-detail', { title: `سفارش ${order.order_no} | اسپارک لب`, adminSection: 'orders', order, user, payments, grants, logs });
});

router.post('/:orderNo/status', (req, res) => {
  const order = get('SELECT * FROM orders WHERE order_no = ?', req.params.orderNo);
  if (!order) return res.status(404).send('not found');
  const newStatus = String(req.body.status || '');
  const note = String(req.body.note || '').slice(0, 300);
  if (newStatus === 'paid') {
    req.session.flash = { type: 'bad', text: 'پرداخت‌شده کردن دستی سفارش مجاز نیست؛ وضعیت paid فقط پس از تأیید سمت سرور توسط درگاه تنظیم می‌شود.' };
    return res.redirect(`/admin/orders/${order.order_no}`);
  }
  const r = setOrderStatus(order, newStatus, req, note ? `[admin:${req.user.id}] ${note}` : `[admin:${req.user.id}]`);
  if (!r.ok) {
    req.session.flash = { type: 'bad', text: r.reason || 'تغییر وضعیت ممکن نیست.' };
    return res.redirect(`/admin/orders/${order.order_no}`);
  }
  audit(req, 'order_status_changed', { entity: 'order', entityId: order.id, details: { from: order.status, to: newStatus, note } });
  req.session.flash = { type: 'ok', text: 'وضعیت سفارش به‌روزرسانی شد.' };
  res.redirect(`/admin/orders/${order.order_no}`);
});

/* regenerate a download grant for a paid order (support action) */
router.post('/grants/:grantId(\\d+)/regenerate', (req, res) => {
  const g = get('SELECT * FROM download_grants WHERE id = ?', parseInt(req.params.grantId, 10));
  if (!g) return res.status(404).send('not found');
  const order = get('SELECT * FROM orders WHERE id = ?', g.order_id);
  if (!order || order.status !== 'paid') {
    req.session.flash = { type: 'bad', text: 'فقط برای سفارش پرداخت‌شده می‌توان لینک دانلود صادر کرد.' };
    return res.redirect(`/admin/orders/${order ? order.order_no : ''}`);
  }
  downloads.regenerateGrant(g.id);
  audit(req, 'download_grant_regenerated', { entity: 'grant', entityId: g.id });
  req.session.flash = { type: 'ok', text: 'لینک دانلود تازه صادر شد.' };
  res.redirect(`/admin/orders/${order.order_no}`);
});

module.exports = router;
