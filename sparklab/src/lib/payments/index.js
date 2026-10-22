'use strict';
/**
 * Payment gateway abstraction.
 *
 * Design rules (enforced here):
 *  - An order is marked paid ONLY after server-side verification succeeds
 *    (verifyPayment call to the gateway OR signed single-use callback for the test gateway).
 *  - Amount, order id and gateway authority are checked; double-verify is idempotent
 *    (a UNIQUE partial index forbids two successful payments per order).
 *  - No secret is ever exposed to the client; merchant IDs live in DB (encrypted) / env.
 */
const { get, run, tx } = require('../../db');
const { getSetting } = require('../settings');
const { signPayload, verifySignedPayload, randomToken } = require('../crypto');
const zarinpal = require('./zarinpal');
const testGateway = require('./testgateway');

const now = () => new Date().toISOString();

const GATEWAYS = { zarinpal, test: testGateway };

function activeGatewayKey() {
  return getSetting('gateway.active', 'none');
}

/** Human-readable connection status shown in admin panel & checkout */
function gatewayStatus() {
  const key = activeGatewayKey();
  if (key === 'zarinpal') {
    const merchant = getSetting('gateway.zarinpal.merchant_id', '');
    const mode = getSetting('gateway.zarinpal.mode', 'sandbox');
    if (!merchant || merchant.length < 10) {
      return { key, connected: false, label: 'زرین‌پال', detail: 'شناسه پذیرنده (Merchant ID) تنظیم نشده — اتصال ناقص است.' };
    }
    return {
      key, connected: true, label: 'زرین‌پال',
      detail: mode === 'production' ? 'اتصال به درگاه عملیاتی زرین‌پال' : 'اتصال به محیط سندباکس زرین‌پال',
      mode,
    };
  }
  if (key === 'test') {
    return {
      key, connected: true, label: 'درگاه آزمایشی (محلی)',
      detail: 'درگاه تست داخلی — فقط برای آزمایش چرخه سفارش. پول واقعی جابه‌جا نمی‌شود و تراکنش‌ها با برچسب «آزمایشی» ثبت می‌شوند.',
      test: true,
    };
  }
  return { key: 'none', connected: false, label: 'هیچ', detail: 'هیچ درگاه پرداختی پیکربندی نشده است. خرید تا اتصال درگاه واقعی ممکن نیست.' };
}

function gatewayByKey(key) { return GATEWAYS[key] || null; }

/** Create payment request → returns redirect URL (or error). */
async function initiatePayment({ order, req, origin }) {
  const status = gatewayStatus();
  if (!status.connected) {
    const err = new Error('درگاه پرداخت متصل نیست');
    err.code = 'GATEWAY_NOT_CONFIGURED';
    throw err;
  }
  const gw = gatewayByKey(status.key);
  const paymentId = run(
    `INSERT INTO payments (order_id, gateway, authority, status, amount, request_json, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    order.id, status.key, null, 'initiated', order.total, null, now()
  ).lastId;

  const result = await gw.paymentRequest({ order, paymentId, origin, req });
  if (!result.ok) {
    run(`UPDATE payments SET status='failed', fail_reason=?, verify_json=? WHERE id=?`,
      result.error || 'خطای نامشخص', JSON.stringify(result.raw || {}), paymentId);
    const err = new Error(result.error || 'خطا در اتصال به درگاه پرداخت');
    err.code = 'GATEWAY_REQUEST_FAILED';
    err.raw = result.raw;
    throw err;
  }
  run(`UPDATE payments SET status='pending', authority=?, request_json=? WHERE id=?`,
    result.authority || null, JSON.stringify(result.raw || {}), paymentId);
  return { paymentId, redirectUrl: result.redirectUrl, authority: result.authority };
}

/**
 * Server-side verification. Called from the callback route.
 * Returns { ok, order, reason }. Guarantees:
 *  - payment belongs to this order, is not already successful
 *  - verified amount equals the order total
 *  - order flips to 'paid' exactly once (transaction + unique index)
 */
async function verifyPayment({ order, req, query }) {
  const status = gatewayStatus();
  const gw = gatewayByKey(status.key);
  if (!gw) return { ok: false, reason: 'درگاه فعال یافت نشد.' };

  const payment = get(
    `SELECT * FROM payments WHERE order_id = ? AND status IN ('initiated','pending') ORDER BY id DESC LIMIT 1`,
    order.id
  );
  if (!payment) {
    // already succeeded earlier?
    const done = get(`SELECT * FROM payments WHERE order_id=? AND status='success'`, order.id);
    if (done) return { ok: true, order: get('SELECT * FROM orders WHERE id=?', order.id), already: true };
    return { ok: false, reason: 'تراکنش قابل تأییدی برای این سفارش یافت نشد.' };
  }

  const result = await gw.verify({ order, payment, req, query });
  if (!result.ok) {
    run(`UPDATE payments SET status='failed', fail_reason=?, verify_json=? WHERE id=?`,
      result.reason || 'تأیید ناموفق', JSON.stringify(result.raw || {}), payment.id);
    run(`UPDATE orders SET status='failed' WHERE id=? AND status='pending'`, order.id);
    return { ok: false, reason: result.reason || 'پرداخت توسط درگاه تأیید نشد.', raw: result.raw };
  }

  // amount check — never trust the callback amount alone
  const verifiedAmount = Number(result.amount ?? order.total);
  if (verifiedAmount !== Number(order.total)) {
    run(`UPDATE payments SET status='failed', fail_reason=?, verify_json=? WHERE id=?`,
      'مغایرت مبلغ تأییدشده با مبلغ سفارش', JSON.stringify(result.raw || {}), payment.id);
    run(`UPDATE orders SET status='failed' WHERE id=? AND status='pending'`, order.id);
    return { ok: false, reason: 'مبلغ پرداختی با مبلغ سفارش مطابقت ندارد.' };
  }

  try {
    tx(() => {
      run(`UPDATE payments SET status='success', ref_id=?, amount=?, verify_json=?, verified_at=? WHERE id=?`,
        result.refId || null, verifiedAmount, JSON.stringify(result.raw || {}), now(), payment.id);
      const r = run(`UPDATE orders SET status='paid', paid_at=?, gateway=?, payment_ref=? WHERE id=? AND status='pending'`,
        now(), status.key, result.refId || null, order.id);
      if (r.changes !== 1) {
        // order was already paid/cancelled concurrently → refuse double finalization
        throw Object.assign(new Error('order-not-finalizable'), { benign: true });
      }
    });
  } catch (e) {
    if (e.benign) {
      return { ok: true, order: get('SELECT * FROM orders WHERE id=?', order.id), already: true };
    }
    if (String(e.message || '').includes('UNIQUE')) {
      // unique success index: already verified by a concurrent callback
      return { ok: true, order: get('SELECT * FROM orders WHERE id=?', order.id), already: true };
    }
    run(`UPDATE payments SET status='failed', fail_reason=? WHERE id=?`, 'خطای داخلی در ثبت پرداخت', payment.id);
    return { ok: false, reason: 'خطای داخلی در نهایی‌سازی پرداخت.' };
  }

  const fresh = get('SELECT * FROM orders WHERE id=?', order.id);
  return { ok: true, order: fresh, refId: result.refId, test: Boolean(status.test) };
}

function signedCallbackState(payload) { return signPayload(payload); }
function readSignedCallbackState(token) { return verifySignedPayload(token); }
function newAuthority() { return randomToken(16); }

module.exports = {
  initiatePayment, verifyPayment, gatewayStatus, activeGatewayKey,
  signedCallbackState, readSignedCallbackState, newAuthority, GATEWAYS,
};
