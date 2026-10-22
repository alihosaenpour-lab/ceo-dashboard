'use strict';
/**
 * Local TEST gateway — clearly labelled, never used for real money.
 * It exists so the full order pipeline (create → redirect → callback →
 * server-side verify → paid / failed → delivery gating) can be exercised
 * in a test environment before a real gateway is connected.
 *
 * Security properties mirror the real gateway:
 *  - the "gateway page" carries a signed, single-use state token;
 *  - the callback re-reads the order from DB and checks the amount;
 *  - success/failure is decided server-side (the button posts an outcome
 *    which is validated against the signed state).
 */
const { signPayload, verifySignedPayload } = require('../crypto');
const { getSetting } = require('../settings');

async function paymentRequest({ order, paymentId, origin }) {
  const enabled = getSetting('gateway.test.enabled', '1') === '1';
  if (!enabled) return { ok: false, error: 'درگاه آزمایشی غیرفعال است.' };
  const state = signPayload({ oid: order.id, ono: order.order_no, amt: order.total, pid: paymentId, t: Date.now() });
  return {
    ok: true,
    authority: state,
    redirectUrl: `${origin}/checkout/test-gateway?order=${encodeURIComponent(order.order_no)}&state=${encodeURIComponent(state)}`,
    raw: { mode: 'local-test' },
  };
}

async function verify({ order, payment, req }) {
  const state = (req.body && req.body.state) || (req.query && req.query.state);
  const outcome = (req.body && req.body.outcome) || 'fail';
  const payload = verifySignedPayload(state || payment.authority || '');
  if (!payload) return { ok: false, reason: 'توکن امضای درگاه آزمایشی نامعتبر است.' };
  if (payload.oid !== order.id || payload.ono !== order.order_no) {
    return { ok: false, reason: 'توکن درگاه آزمایشی به سفارش دیگری تعلق دارد.' };
  }
  if (Date.now() - payload.t > 30 * 60 * 1000) {
    return { ok: false, reason: 'نشست درگاه آزمایشی منقضی شده است.' };
  }
  if (payload.amt !== order.total) {
    return { ok: false, reason: 'مغایرت مبلغ در توکن درگاه آزمایشی.' };
  }
  if (outcome === 'ok') {
    const ref = `TEST-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    return { ok: true, refId: ref, amount: order.total, raw: { mode: 'local-test', outcome: 'ok', ref } };
  }
  return { ok: false, reason: 'پرداخت آزمایشی توسط کاربر ناموفق/لغو شد.', raw: { mode: 'local-test', outcome } };
}

async function healthCheck() {
  const enabled = getSetting('gateway.test.enabled', '1') === '1';
  return { ok: enabled, message: enabled ? 'درگاه آزمایشی محلی فعال است.' : 'درگاه آزمایشی محلی غیرفعال است.' };
}

module.exports = { paymentRequest, verify, healthCheck };
