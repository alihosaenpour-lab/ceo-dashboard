'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { get, all, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { jsonField, sanitizeRich, fmtDate } = require('../lib/helpers');
const downloads = require('../lib/downloads');
const { userNotifications, markAllRead } = require('../lib/notify');
const { validator } = require('../middleware/validate');
const { hashPassword, verifyPassword } = require('../lib/crypto');
const { audit, formLimiter, clientIp } = require('../middleware/security');
const config = require('../config');

const router = express.Router();
const now = () => new Date().toISOString();

router.use(requireAuth);

router.get('/', (req, res) => {
  const orders = all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 5', req.user.id);
  const projects = all('SELECT * FROM project_requests WHERE user_id = ? ORDER BY id DESC LIMIT 5', req.user.id);
  const grants = downloads.grantsForUser(req.user.id).filter((g) => !g.revoked && g.order_id && g.expires_at && new Date(g.expires_at) > new Date());
  const stats = {
    orders: get('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?', req.user.id).c,
    paidOrders: get(`SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status = 'paid'`, req.user.id).c,
    projects: get('SELECT COUNT(*) AS c FROM project_requests WHERE user_id = ?', req.user.id).c,
  };
  res.render('account/dashboard', { title: 'پنل حساب کاربری | اسپارک لب', metaDescription: '', orders, projects, grants, stats });
});

/* ---------- orders ---------- */
router.get('/orders', (req, res) => {
  const list = all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', req.user.id).map((o) => ({
    ...o, items: jsonField(o.items_json),
  }));
  res.render('account/orders', { title: 'سفارش‌های من | اسپارک لب', metaDescription: '', orders: list });
});

function orderView(req, res, orderNo, view) {
  const order = get('SELECT * FROM orders WHERE order_no = ? AND user_id = ?', orderNo, req.user.id);
  if (!order) {
    return res.status(404).render('public/error', { title: 'سفارش یافت نشد', code: 404, message: 'این سفارش در حساب شما وجود ندارد.' });
  }
  order.items = jsonField(order.items_json);
  const grants = downloads.grantsForOrder(order.id);
  const paymentsList = all('SELECT id, gateway, status, amount, ref_id, authority, fail_reason, created_at, verified_at FROM payments WHERE order_id = ? ORDER BY id DESC', order.id);
  res.render(view, {
    title: `سفارش ${order.order_no} | اسپارک لب`, metaDescription: '',
    order, grants, payments: paymentsList,
  });
}

router.get('/orders/:orderNo', (req, res) => orderView(req, res, req.params.orderNo, 'account/order-detail'));
router.get('/orders/:orderNo/invoice', (req, res) => orderView(req, res, req.params.orderNo, 'account/invoice'));

/* ---------- downloads (files are served from /download/:token) ---------- */
router.get('/downloads', (req, res) => {
  const grants = downloads.grantsForUser(req.user.id);
  res.render('account/downloads', { title: 'دانلودهای من | اسپارک لب', metaDescription: '', grants });
});

/* ---------- projects ---------- */
router.get('/projects', (req, res) => {
  const projects = all('SELECT * FROM project_requests WHERE user_id = ? ORDER BY id DESC', req.user.id);
  res.render('account/projects', { title: 'پروژه‌های من | اسپارک لب', metaDescription: '', projects });
});

router.get('/projects/:id', (req, res) => {
  const p = get('SELECT * FROM project_requests WHERE id = ? AND user_id = ?', parseInt(req.params.id, 10), req.user.id);
  if (!p) return res.status(404).render('public/error', { title: 'پروژه یافت نشد', code: 404, message: 'این پروژه در حساب شما وجود ندارد.' });
  p.attachments = jsonField(p.attachments_json);
  const messages = all(`SELECT * FROM project_messages WHERE project_id = ? AND (is_internal IS NULL OR 1=1) ORDER BY id`, p.id)
    .filter((m) => !m.is_internal);
  res.render('account/project-detail', { title: `پروژه ${p.ref_no} | اسپارک لب`, metaDescription: '', project: p, messages, errors: {} });
});

router.post('/projects/:id/message', formLimiter, (req, res) => {
  const p = get('SELECT * FROM project_requests WHERE id = ? AND user_id = ?', parseInt(req.params.id, 10), req.user.id);
  if (!p) return res.status(404).render('public/error', { title: 'پروژه یافت نشد', code: 404, message: 'پروژه یافت نشد.' });
  const v = validator(req.body);
  const body = v.string('body', 'متن پیام', { min: 2, max: 3000 });
  if (!v.ok()) {
    req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] };
    return res.redirect(`/account/projects/${p.id}`);
  }
  run(`INSERT INTO project_messages (project_id, sender_role, sender_id, body, created_at) VALUES (?,?,?,?,?)`,
    p.id, 'customer', req.user.id, body, now());
  run('UPDATE project_requests SET updated_at = ? WHERE id = ?', now(), p.id);
  audit(req, 'project_message_customer', { entity: 'project', entityId: p.id });
  req.session.flash = { type: 'ok', text: 'پیام شما ارسال شد.' };
  res.redirect(`/account/projects/${p.id}`);
});

/* with attachment */
router.post('/projects/:id/message-file', require('../lib/uploads').attachmentUpload.single('attachment'), formLimiter, (req, res) => {
  const p = get('SELECT * FROM project_requests WHERE id = ? AND user_id = ?', parseInt(req.params.id, 10), req.user.id);
  if (!p) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return res.status(404).render('public/error', { title: 'پروژه یافت نشد', code: 404, message: 'پروژه یافت نشد.' });
  }
  const v = validator(req.body);
  const body = v.string('body', 'متن پیام', { min: 1, max: 3000, required: !req.file });
  if (!v.ok() && !req.file) {
    req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] };
    return res.redirect(`/account/projects/${p.id}`);
  }
  run(`INSERT INTO project_messages (project_id, sender_role, sender_id, body, attachment_path, attachment_name, created_at) VALUES (?,?,?,?,?,?,?)`,
    p.id, 'customer', req.user.id, body || '(فایل پیوست)',
    req.file ? path.relative(config.storageDir, req.file.path) : null,
    req.file ? req.file.originalname.slice(0, 150) : null, now());
  audit(req, 'project_message_customer_file', { entity: 'project', entityId: p.id });
  req.session.flash = { type: 'ok', text: 'پیام و فایل شما ارسال شد.' };
  res.redirect(`/account/projects/${p.id}`);
});

/* ---------- notifications ---------- */
router.get('/notifications', (req, res) => {
  const items = userNotifications(req.user.id, 100);
  res.render('account/notifications', { title: 'اعلان‌ها | اسپارک لب', metaDescription: '', items });
});
router.post('/notifications/read', (req, res) => {
  markAllRead(req.user.id);
  res.redirect(req.body.back || '/account/notifications');
});

/* ---------- profile ---------- */
router.get('/profile', (req, res) => {
  const u = get('SELECT id, name, email, phone, created_at FROM users WHERE id = ?', req.user.id);
  res.render('account/profile', { title: 'تنظیمات حساب | اسپارک لب', metaDescription: '', profile: u, errors: {}, values: u });
});

router.post('/profile', formLimiter, (req, res) => {
  const v = validator(req.body);
  const name = v.string('name', 'نام و نام خانوادگی', { min: 3, max: 100 });
  const phone = v.phone('phone', 'شماره موبایل', { required: false });
  if (!v.ok()) {
    return res.status(400).render('account/profile', {
      title: 'تنظیمات حساب | اسپارک لب', metaDescription: '',
      profile: req.user, errors: v.errors, values: { ...req.user, ...req.body },
    });
  }
  run('UPDATE users SET name = ?, phone = ?, updated_at = ? WHERE id = ?', name, phone, now(), req.user.id);
  audit(req, 'profile_updated', { entity: 'user', entityId: req.user.id });
  req.session.flash = { type: 'ok', text: 'اطلاعات حساب به‌روزرسانی شد.' };
  res.redirect('/account/profile');
});

router.post('/password', formLimiter, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  const current = String(req.body.current_password || '');
  if (!verifyPassword(current, u.password_hash)) {
    req.session.flash = { type: 'bad', text: 'رمز عبور فعلی اشتباه است.' };
    return res.redirect('/account/profile');
  }
  const v = validator(req.body);
  const password = v.password('password', 'رمز عبور جدید', { min: 8 });
  const confirm = String(req.body.password2 || '');
  if (password && password !== confirm) v.errors.password2 = 'تکرار رمز مطابقت ندارد.';
  if (!v.ok()) {
    req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] };
    return res.redirect('/account/profile');
  }
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(password), now(), u.id);
  audit(req, 'password_changed', { entity: 'user', entityId: u.id });
  req.session.flash = { type: 'ok', text: 'رمز عبور تغییر کرد.' };
  res.redirect('/account/profile');
});

module.exports = router;
