'use strict';
/**
 * ZarinPal driver — real integration against ZarinPal PG v4 API.
 * Endpoints:
 *   production: https://api.zarinpal.com/pg/v4/payment/request.json | verify.json
 *   sandbox:    https://sandbox.zarinpal.com/pg/v4/payment/request.json | verify.json
 *   redirect:   https://www.zarinpal.com/pg/StartPay/{authority}  (sandbox: sandbox.zarinpal.com)
 *
 * The merchant id is stored encrypted in DB settings (or ZARINPAL_MERCHANT_ID env).
 * Verification is server-to-server: we call verify.json ourselves and only trust
 * its response (codes 100 = paid, 101 = already verified).
 */
const { getSetting } = require('../settings');

const TIMEOUT_MS = 20000;

function merchantConfig() {
  const merchantId = (getSetting('gateway.zarinpal.merchant_id', '') || process.env.ZARINPAL_MERCHANT_ID || '').trim();
  const mode = getSetting('gateway.zarinpal.mode', 'sandbox') === 'production' ? 'production' : 'sandbox';
  const apiBase = mode === 'production' ? 'https://api.zarinpal.com' : 'https://sandbox.zarinpal.com';
  const payBase = mode === 'production' ? 'https://www.zarinpal.com' : 'https://sandbox.zarinpal.com';
  return { merchantId, mode, apiBase, payBase };
}

async function callJson(url, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* keep null */ }
    return { httpStatus: res.status, json, text: text.slice(0, 2000) };
  } catch (e) {
    return { httpStatus: 0, json: null, text: `network-error: ${e.message}` };
  } finally { clearTimeout(t); }
}

/** ZarinPal expects amounts in IRR (Rial). Our store currency is Toman. */
function toRial(toman) { return Number(toman) * 10; }

async function paymentRequest({ order, origin }) {
  const { merchantId, apiBase, payBase } = merchantConfig();
  if (!merchantId) return { ok: false, error: 'شناسه پذیرنده زرین‌پال تنظیم نشده است.' };

  const callback = `${origin}/checkout/callback?gateway=zarinpal&order=${encodeURIComponent(order.order_no)}`;
  const body = {
    merchant_id: merchantId,
    amount: toRial(order.total),
    currency: 'IRT',
    callback_url: callback,
    description: `سفارش ${order.order_no} — اسپارک لب`,
    metadata: { email: order.buyer_email || '', mobile: order.buyer_phone || '', order_no: order.order_no },
  };
  const r = await callJson(`${apiBase}/pg/v4/payment/request.json`, body);
  const d = r.json?.data;
  if (r.json && r.json.status === 100 && d && d.authority) {
    return {
      ok: true,
      authority: d.authority,
      redirectUrl: `${payBase}/pg/StartPay/${d.authority}`,
      raw: r.json,
    };
  }
  const code = r.json?.errors?.code;
  const msg = r.json?.errors?.message || r.text || 'پاسخ نامعتبر از زرین‌پال';
  return { ok: false, error: `زرین‌پال خطا داد (کد ${code ?? r.httpStatus}): ${msg}`, raw: r.json || { text: r.text } };
}

async function verify({ order, payment, query }) {
  const { merchantId, apiBase } = merchantConfig();
  const authority = (query && query.Authority) || payment.authority;
  const zStatus = query && query.Status;

  if (!authority) return { ok: false, reason: 'شناسه تراکنش (Authority) در بازگشت از درگاه وجود ندارد.' };
  if (zStatus && zStatus !== 'OK') {
    return { ok: false, reason: 'کاربر پرداخت را در صفحه درگاه لغو کرد.', raw: { status: zStatus } };
  }

  const amountRial = toRial(order.total);
  const r = await callJson(`${apiBase}/pg/v4/payment/verify.json`, {
    merchant_id: merchantId, amount: amountRial, authority,
  });
  const d = r.json?.data;
  const code = r.json?.data?.code ?? r.json?.errors?.code;

  if (r.json && (code === 100) && d && Number(d.amount) === amountRial) {
    return { ok: true, refId: String(d.ref_id || ''), amount: order.total, raw: r.json };
  }
  if (r.json && code === 101) {
    // already verified at ZarinPal side — treat as success (idempotent)
    return { ok: true, refId: String(d?.ref_id || ''), amount: order.total, raw: r.json };
  }
  const msg = r.json?.errors?.message || r.text || 'تأیید ناموفق';
  return { ok: false, reason: `تأیید زرین‌پال ناموفق (کد ${code ?? r.httpStatus}): ${msg}`, raw: r.json || { text: r.text } };
}

async function healthCheck() {
  const { merchantId, apiBase, mode } = merchantConfig();
  if (!merchantId) return { ok: false, message: 'شناسه پذیرنده تنظیم نشده است.' };
  // A tiny probe: send an invalid request; a reachable API answers with a JSON error.
  const r = await callJson(`${apiBase}/pg/v4/payment/request.json`, { merchant_id: merchantId, amount: 0, callback_url: 'https://local.test/cb' });
  if (r.json) return { ok: true, message: `API زرین‌پال (${mode}) در دسترس است.` };
  return { ok: false, message: `عدم امکان برقراری ارتباط با API زرین‌پال (${mode}): ${r.text.slice(0, 120)}` };
}

module.exports = { paymentRequest, verify, healthCheck, merchantConfig };
