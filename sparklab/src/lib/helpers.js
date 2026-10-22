'use strict';
/** Shared helpers: money/date formatting (fa-IR), JSON fields, sanitization. */
const sanitizeHtml = require('sanitize-html');

const fmtMoney = (n) => Number(n || 0).toLocaleString('fa-IR');
const fmtMoneyEn = (n) => Number(n || 0).toLocaleString('en-US');

function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: opts.time === false ? undefined : '2-digit',
      minute: opts.time === false ? undefined : '2-digit',
      timeZone: 'Asia/Tehran',
    }).format(new Date(iso));
  } catch (_) { return String(iso).slice(0, 10); }
}

function fmtDateShort(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tehran' }).format(new Date(iso));
  } catch (_) { return ''; }
}

function jsonField(v, fallback = []) {
  if (!v) return fallback;
  try { const p = JSON.parse(v); return p ?? fallback; } catch (_) { return fallback; }
}

function parseList(raw) {
  // textarea lines / JSON array → string[]
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.map(String).filter(Boolean);
  } catch (_) { /* fall through */ }
  return String(raw).split('\n').map((s) => s.trim()).filter(Boolean);
}

const SANITIZE_OPTS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img', 'h1', 'h2', 'figure', 'figcaption', 'span', 'div', 'ul', 'ol', 's', 'hr',
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    span: ['class'], div: ['class'], a: ['href', 'name', 'target', 'rel', 'class'],
    h1: ['class'], h2: ['class'], h3: ['class'], p: ['class'], ul: ['class'], ol: ['class'], li: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  disallowedTagsMode: 'discard',
};

function sanitizeRich(html) {
  return sanitizeHtml(String(html || ''), SANITIZE_OPTS);
}

function statusLabel(s) {
  const map = {
    // orders
    pending: 'در انتظار پرداخت', paid: 'پرداخت‌شده', failed: 'پرداخت ناموفق',
    cancelled: 'لغو شده', refunded: 'بازپرداخت شده',
    // projects
    received: 'دریافت درخواست', reviewing: 'بررسی اولیه', estimating: 'برآورد هزینه',
    approved: 'تأیید شده', in_progress: 'در حال انجام', delivered: 'تحویل شده',
    completed: 'تکمیل شده', rejected: 'رد شده',
  };
  return map[s] || s;
}

function statusClass(s) {
  const map = {
    paid: 'ok', completed: 'ok', delivered: 'ok', success: 'ok', approved: 'ok',
    pending: 'warn', received: 'info', reviewing: 'info', estimating: 'info',
    in_progress: 'info', initiated: 'info',
    failed: 'bad', cancelled: 'bad', rejected: 'bad', refunded: 'warn',
  };
  return map[s] || 'muted';
}

function percentOff(price, discount) {
  if (!price || !discount || discount >= price) return 0;
  return Math.round(((price - discount) / price) * 100);
}

function uniqueSlug(base, existsFn) {
  let slug = base;
  let i = 2;
  while (existsFn(slug)) { slug = `${base}-${i}`; i += 1; }
  return slug;
}

function toSlugAny(input) {
  // For Persian titles without a latin slug: fall back to a transliteration-free id slug
  const s = String(input || '').toLowerCase().trim()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || null;
}

module.exports = {
  fmtMoney, fmtMoneyEn, fmtDate, fmtDateShort, jsonField, parseList,
  sanitizeRich, statusLabel, statusClass, percentOff, uniqueSlug, toSlugAny,
};
