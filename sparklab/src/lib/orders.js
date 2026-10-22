'use strict';
/** Order lifecycle: creation, finalization after verified payment, notifications. */
const { get, run, tx } = require('../db');
const { notify } = require('./notify');
const downloads = require('./downloads');
const { statusLabel } = require('./helpers');

const now = () => new Date().toISOString();

function genOrderNo() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rnd = String(Math.floor(Math.random() * 900000) + 100000);
  return `SL-${stamp}-${rnd}`;
}

function genInvoiceNo() {
  return `INV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
}

/**
 * Create order from validated cart details.
 * Snapshot of items/prices is stored on the order (never trust the client later).
 */
function createOrder({ userId, buyer, details }) {
  if (!details.lines.length) {
    const e = new Error('سبد خرید خالی است.'); e.code = 'EMPTY_CART'; throw e;
  }
  const items = details.lines.map((l) => ({
    product_id: l.product.id,
    title: l.product.title,
    slug: l.product.slug,
    version: l.product.version,
    license_type: l.product.license_type,
    unit_price: l.unit,
    qty: l.qty,
    line_total: l.lineTotal,
  }));
  return tx(() => {
    const orderNo = genOrderNo();
    const id = run(
      `INSERT INTO orders
       (order_no, invoice_no, user_id, buyer_name, buyer_email, buyer_phone, items_json,
        subtotal, discount_total, total, currency, coupon_code, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
      orderNo, genInvoiceNo(), userId || null, buyer.name, buyer.email, buyer.phone || null,
      JSON.stringify(items), details.subtotal, details.discountTotal, details.total,
      details.currency || 'تومان', details.coupon ? details.coupon.code : null, now()
    ).lastId;
    if (details.coupon) {
      run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', details.coupon.id);
    }
    const order = get('SELECT * FROM orders WHERE id = ?', id);
    if (userId) {
      notify(userId, 'order', `سفارش ${orderNo} ثبت شد`,
        'سفارش شما ثبت شد و در انتظار پرداخت است.', `/account/orders/${orderNo}`);
    }
    return order;
  });
}

/** Called after payments.verifyPayment returned ok. Creates grants + notifications + counters. */
function finalizePaidOrder(order, { test = false } = {}) {
  tx(() => {
    downloads.createGrantsForOrder(order);
    const items = JSON.parse(order.items_json || '[]');
    for (const it of items) {
      run('UPDATE products SET sales_count = sales_count + ? WHERE id = ?', it.qty || 1, it.product_id);
    }
  });
  if (order.user_id) {
    notify(order.user_id, 'order_paid',
      `پرداخت سفارش ${order.order_no} تأیید شد${test ? ' (آزمایشی)' : ''}`,
      'پرداخت شما تأیید شد. فایل‌های محصول در بخش دانلودهای پنل حساب در دسترس است.',
      `/account/orders/${order.order_no}`);
  }
}

function setOrderStatus(order, newStatus, req, note) {
  const allowed = ['pending', 'paid', 'failed', 'cancelled', 'refunded'];
  if (!allowed.includes(newStatus)) return { ok: false, reason: 'وضعیت نامعتبر' };
  if (order.status === newStatus) return { ok: true, changed: false };
  // Refund/cancel of a paid order is allowed for admin; re-opening paid → pending is forbidden
  if (order.status === 'paid' && newStatus === 'pending') return { ok: false, reason: 'امکان بازگرداندن سفارش پرداخت‌شده به حالت در انتظار وجود ندارد.' };
  if (order.status !== 'pending' && newStatus === 'paid') {
    return { ok: false, reason: 'فقط سفارش در انتظار پرداخت از مسیر تأیید درگاه قابل پرداخت‌شدن است.' };
  }
  run('UPDATE orders SET status = ?, notes = COALESCE(notes || ?, ?) WHERE id = ?',
    newStatus, note ? `\n[${now()}] ${note}` : '', note ? `\n[${now()}] ${note}` : null, order.id);
  if (newStatus === 'refunded' || newStatus === 'cancelled') {
    run('UPDATE download_grants SET revoked = 1 WHERE order_id = ?', order.id);
  }
  if (order.user_id) {
    notify(order.user_id, 'order_status',
      `وضعیت سفارش ${order.order_no} تغییر کرد`,
      `وضعیت سفارش شما به «${statusLabel(newStatus)}» تغییر یافت.${note ? ' یادداشت: ' + note : ''}`,
      `/account/orders/${order.order_no}`);
  }
  return { ok: true, changed: true };
}

function projectStatusFlow() {
  return ['received', 'reviewing', 'estimating', 'approved', 'in_progress', 'delivered', 'completed'];
}

function canTransition(from, to) {
  const flow = projectStatusFlow();
  if (to === 'rejected' || to === 'cancelled') return ['received', 'reviewing', 'estimating', 'approved'].includes(from);
  const i = flow.indexOf(from); const j = flow.indexOf(to);
  if (i === -1 || j === -1) return false;
  return j === i + 1 || j === i; // forward by one step (or re-save same)
}

module.exports = { createOrder, finalizePaidOrder, setOrderStatus, projectStatusFlow, canTransition, genOrderNo };
