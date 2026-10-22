'use strict';
const express = require('express');
const { get, all } = require('../../db');
const { requireRole } = require('../../middleware/auth');
const { jsonField } = require('../../lib/helpers');
const { gatewayStatus } = require('../../lib/payments');
const { mailStatus } = require('../../lib/notify');
const { audit } = require('../../middleware/security');

const router = express.Router();

router.use(requireRole('admin', 'staff'));
router.use((req, res, next) => {
  res.locals.adminSection = '';
  res.locals.isFullAdmin = req.user.role === 'admin';
  next();
});

/* ---------- dashboard ---------- */
router.get('/', (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const stats = {
    revenue30d: get(`SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE status='paid' AND paid_at >= ?`, monthAgo).s,
    orders30d: get(`SELECT COUNT(*) AS c FROM orders WHERE created_at >= ?`, monthAgo).c,
    paidOrders: get(`SELECT COUNT(*) AS c FROM orders WHERE status='paid'`).c,
    pendingOrders: get(`SELECT COUNT(*) AS c FROM orders WHERE status='pending'`).c,
    failedPayments: get(`SELECT COUNT(*) AS c FROM payments WHERE status='failed' AND created_at >= ?`, monthAgo).c,
    users: get('SELECT COUNT(*) AS c FROM users').c,
    newUsers30d: get(`SELECT COUNT(*) AS c FROM users WHERE created_at >= ?`, monthAgo).c,
    products: get('SELECT COUNT(*) AS c FROM products WHERE is_active=1').c,
    openProjects: get(`SELECT COUNT(*) AS c FROM project_requests WHERE status NOT IN ('completed','rejected','cancelled')`).c,
    newProjects7d: get(`SELECT COUNT(*) AS c FROM project_requests WHERE created_at >= ?`, new Date(Date.now() - 7 * 86400000).toISOString()).c,
    downloads: get('SELECT COUNT(*) AS c FROM download_logs').c,
    unreadMessages: get('SELECT COUNT(*) AS c FROM contact_messages WHERE is_read=0').c,
  };
  const recentOrders = all(`SELECT * FROM orders ORDER BY id DESC LIMIT 8`);
  const recentProjects = all(`SELECT * FROM project_requests ORDER BY id DESC LIMIT 6`);
  const bestsellers = all(`SELECT id, title, slug, sales_count, price, discount_price FROM products ORDER BY sales_count DESC, id DESC LIMIT 6`);
  // 14-day revenue series
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const d2 = new Date(d); d2.setDate(d2.getDate() + 1);
    const s = get(`SELECT COALESCE(SUM(total),0) AS s, COUNT(*) AS c FROM orders WHERE status='paid' AND paid_at >= ? AND paid_at < ?`,
      d.toISOString(), d2.toISOString());
    series.push({ date: d, label: d.toLocaleDateString('fa-IR', { month: 'numeric', day: 'numeric' }), revenue: s.s, count: s.c });
  }
  const gw = gatewayStatus();
  const mail = mailStatus();
  const recentAudit = all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10');
  res.render('admin/dashboard', {
    title: 'پیشخوان مدیریت | اسپارک لب', adminSection: 'dashboard',
    stats, recentOrders, recentProjects, bestsellers, series, gw, mail, recentAudit,
  });
});

/* ---------- sales report ---------- */
router.get('/reports', (req, res) => {
  const days = Math.min(180, Math.max(7, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const totals = get(`SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS orders FROM orders WHERE status='paid' AND paid_at >= ?`, since);
  const byGateway = all(`SELECT gateway, COUNT(*) AS c, COALESCE(SUM(total),0) AS s FROM orders WHERE status='paid' AND paid_at >= ? GROUP BY gateway`, since);
  const byProduct = all(`SELECT value AS items FROM orders WHERE status='paid' AND paid_at >= ?`, since)
    .flatMap((r) => jsonField(r.items));
  const productMap = {};
  for (const it of byProduct) {
    const k = it.product_id;
    productMap[k] = productMap[k] || { title: it.title, qty: 0, revenue: 0 };
    productMap[k].qty += it.qty || 1;
    productMap[k].revenue += it.line_total || 0;
  }
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const projectStats = get(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='received' THEN 1 ELSE 0 END) AS received,
      SUM(CASE WHEN status IN ('reviewing','estimating') THEN 1 ELSE 0 END) AS reviewing,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status IN ('delivered','completed') THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN estimate_amount IS NOT NULL AND status IN ('approved','in_progress','delivered','completed') THEN estimate_amount ELSE 0 END) AS pipeline_value
    FROM project_requests WHERE created_at >= ?`, since);
  res.render('admin/reports', {
    title: 'گزارش فروش | اسپارک لب', adminSection: 'reports',
    days, totals, byGateway, topProducts, projectStats,
  });
});

/* ---------- audit / security log ---------- */
router.get('/audit', requireRole('admin'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const per = 50;
  const total = get('SELECT COUNT(*) AS c FROM audit_logs').c;
  const rows = all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?', per, (page - 1) * per);
  res.render('admin/audit', {
    title: 'رویدادهای امنیتی | اسپارک لب', adminSection: 'audit',
    rows, page, pages: Math.max(1, Math.ceil(total / per)), total,
  });
});

router.use('/products', require('./products'));
router.use('/categories', require('./categories'));
router.use('/orders', require('./orders'));
router.use('/coupons', require('./coupons'));
router.use('/projects', require('./projects'));
router.use('/users', require('./users'));
router.use('/content', require('./content'));
router.use('/settings', requireRole('admin'), require('./settings'));

module.exports = router;
