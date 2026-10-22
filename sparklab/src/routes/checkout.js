'use strict';
const express = require('express');
const { get, run } = require('../db');
const cart = require('../lib/cart');
const orders = require('../lib/orders');
const payments = require('../lib/payments');
const { validator } = require('../middleware/validate');
const { checkoutLimiter, audit, clientIp } = require('../middleware/security');
const { getSetting } = require('../lib/settings');

const router = express.Router();

function originOf(req) {
  const cfgUrl = require('../config').publicUrl;
  if (cfgUrl) return cfgUrl;
  return `${req.protocol}://${req.get('host')}`;
}

function findOrder(orderNo, user) {
  const order = get('SELECT * FROM orders WHERE order_no = ?', orderNo);
  if (!order) return null;
  // ownership: registered owner OR exact session-issued order (guest checkout uses session guard below)
  if (order.user_id) {
    if (!user || user.id !== order.user_id) return undefined; // forbidden
  }
  return order;
}

/* ---------- checkout page ---------- */
router.get('/', (req, res) => {
  const details = cart.cartDetails(req);
  if (!details.lines.length) {
    req.session.flash = { type: 'bad', text: 'سبد خرید خالی است.' };
    return res.redirect('/shop');
  }
  const gw = payments.gatewayStatus();
  res.render('public/checkout', {
    title: 'تکمیل سفارش و پرداخت | اسپارک لب',
    metaDescription: '',
    details, gw,
    values: {
      name: req.user?.name || '', email: req.user?.email || '', phone: req.user?.phone || '',
    },
    errors: {},
  });
});

/* ---------- create order + redirect to gateway ---------- */
router.post('/', checkoutLimiter, async (req, res) => {
  const details = cart.cartDetails(req); // recomputed server-side from DB
  if (!details.lines.length) {
    req.session.flash = { type: 'bad', text: 'سبد خرید خالی است.' };
    return res.redirect('/shop');
  }
  const gw = payments.gatewayStatus();
  if (!gw.connected) {
    return res.status(503).render('public/error', {
      title: 'درگاه پرداخت متصل نیست', code: 503,
      message: 'در حال حاضر هیچ درگاه پرداخت فعالی روی این فروشگاه پیکربندی نشده است و امکان تکمیل خرید وجود ندارد. این وضعیت تا اتصال درگاه واقعی (مانند زرین‌پال) به‌صورت شفاف اعلام می‌شود و هیچ پرداختی شبیه‌سازی نمی‌گردد.',
    });
  }
  const v = validator(req.body);
  const name = v.string('name', 'نام و نام خانوادگی', { min: 3, max: 100 });
  const email = v.email('email');
  const phone = v.phone('phone', 'شماره موبایل', { required: true });
  const accept = v.bool('accept_terms');
  if (!accept) v.errors.accept_terms = 'پذیرش شرایط خرید الزامی است.';
  if (!v.ok()) {
    return res.status(400).render('public/checkout', {
      title: 'تکمیل سفارش و پرداخت | اسپارک لب', metaDescription: '',
      details, gw, values: { name, email, phone }, errors: v.errors,
    });
  }

  let order;
  try {
    order = orders.createOrder({
      userId: req.user?.id || null,
      buyer: { name, email, phone },
      details,
    });
  } catch (e) {
    req.session.flash = { type: 'bad', text: e.message || 'ثبت سفارش ناموفق بود.' };
    return res.redirect('/cart');
  }
  // keep the cart until payment outcome is known? Spec: cart cleared on order creation.
  cart.clearCart(req);
  audit(req, 'order_created', { entity: 'order', entityId: order.id, details: { order_no: order.order_no, total: order.total, gateway: gw.key } });

  try {
    const init = await payments.initiatePayment({ order, req, origin: originOf(req) });
    if (!req.user) {
      // guest checkout: remember the pending order in session so the result page can be shown
      req.session.guestOrder = order.order_no;
    }
    res.redirect(init.redirectUrl);
  } catch (e) {
    audit(req, 'payment_init_failed', { entity: 'order', entityId: order.id, details: { code: e.code, message: e.message } });
    run('UPDATE orders SET status = ?, notes = ? WHERE id = ? AND status = ?',
      'failed', `خطای اتصال به درگاه: ${e.message}`.slice(0, 500), order.id, 'pending');
    res.status(502).render('public/error', {
      title: 'خطا در اتصال به درگاه پرداخت', code: 502,
      message: `${e.message} — سفارش شما با کد ${order.order_no} ثبت شد اما اتصال به درگاه برقرار نشد. مبلغی کسر نشده است. وضعیت سفارش «پرداخت ناموفق» ثبت شد؛ می‌توانید دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.`,
    });
  }
});

/* ---------- local TEST gateway page (clearly labelled) ---------- */
router.get('/test-gateway', (req, res) => {
  const state = String(req.query.state || '');
  const payload = payments.readSignedCallbackState(state);
  if (!payload) {
    return res.status(400).render('public/error', { title: 'نشست پرداخت نامعتبر', code: 400, message: 'نشست درگاه آزمایشی نامعتبر است. فرآیند پرداخت را از ابتدا آغاز کنید.' });
  }
  const order = get('SELECT * FROM orders WHERE id = ? AND status = ?', payload.oid, 'pending');
  if (!order || order.order_no !== payload.ono || order.total !== payload.amt) {
    return res.status(400).render('public/error', { title: 'سفارش نامعتبر', code: 400, message: 'سفارش مرتبط با این نشست پرداخت یافت نشد یا قبلاً تعیین تکلیف شده است.' });
  }
  res.render('public/test-gateway', {
    title: 'درگاه آزمایشی | اسپارک لب',
    metaDescription: '',
    state, order,
  });
});

/* ---------- callback ---------- */
router.all('/callback', checkoutLimiter, async (req, res) => {
  const orderNo = String(req.query.order || req.body?.order || '');
  const gwParam = String(req.query.gateway || req.body?.gateway || '');
  const order = get('SELECT * FROM orders WHERE order_no = ?', orderNo);
  if (!order) {
    return res.status(404).render('public/error', { title: 'سفارش یافت نشد', code: 404, message: 'سفارشی با این شناسه وجود ندارد.' });
  }
  const gw = payments.gatewayStatus();
  if (gwParam && gwParam !== gw.key) {
    return res.status(400).render('public/error', { title: 'درگاه نامعتبر', code: 400, message: 'بازگشت از درگاهی انجام شده که اکنون فعال نیست.' });
  }

  // Ownership guard for viewing the result: owner, or the guest who created it in this session,
  // or (post-redirect from bank) the same browser session that started checkout.
  const isOwner = (req.user && order.user_id === req.user.id) ||
    (!order.user_id && req.session.guestOrder === order.order_no);

  const result = await payments.verifyPayment({ order, req, query: req.method === 'GET' ? req.query : req.body });
  audit(req, result.ok ? 'payment_verified_success' : 'payment_verified_failed', {
    entity: 'order', entityId: order.id,
    details: { order_no: order.order_no, reason: result.reason || null, already: !!result.already, test: !!result.test },
  });

  if (result.ok) {
    if (!result.already) orders.finalizePaidOrder(result.order, { test: result.test });
    if (req.session.guestOrder === order.order_no) {
      req.session.guestPaid = req.session.guestPaid || [];
      req.session.guestPaid.push(order.order_no);
    }
    req.session.flash = { type: 'ok', text: `پرداخت سفارش ${order.order_no} با موفقیت تأیید شد.` };
    if (isOwner && req.user) return res.redirect(`/account/orders/${order.order_no}?paid=1`);
    // guest owner: show result page with direct (still controlled) download links
    const guestGrants = isOwner ? require('../lib/downloads').grantsForOrder(result.order.id) : [];
    return res.render('public/checkout-result', {
      title: 'نتیجه پرداخت | اسپارک لب', metaDescription: '',
      ok: true, order: result.order, test: Boolean(result.test), isOwner, grants: guestGrants,
    });
  }

  req.session.flash = { type: 'bad', text: `پرداخت سفارش ${order.order_no} تأیید نشد: ${result.reason || 'خطای نامشخص'}` };
  res.render('public/checkout-result', {
    title: 'نتیجه پرداخت | اسپارک لب', metaDescription: '',
    ok: false, order: get('SELECT * FROM orders WHERE id = ?', order.id),
    reason: result.reason, test: false, isOwner,
  });
});

/* ---------- order status re-check (client polling after redirect issues) ---------- */
router.get('/status/:orderNo', (req, res) => {
  const order = findOrder(req.params.orderNo, req.user);
  if (!order) return res.status(404).json({ ok: false, error: 'not found' });
  if (order === undefined) return res.status(403).json({ ok: false, error: 'forbidden' });
  if (!order.user_id && req.session.guestOrder !== order.order_no) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  res.json({ ok: true, order_no: order.order_no, status: order.status, paid_at: order.paid_at });
});

module.exports = router;
