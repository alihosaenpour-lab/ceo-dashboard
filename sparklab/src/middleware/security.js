'use strict';
const rateLimit = require('express-rate-limit');
const { run } = require('../db');

const now = () => new Date().toISOString();

function clientIp(req) {
  return (req.ip || req.connection?.remoteAddress || 'unknown').toString().slice(0, 64);
}

/** Security event / audit trail */
function audit(req, action, meta = {}) {
  try {
    run(
      'INSERT INTO audit_logs (actor_id, actor_role, action, entity, entity_id, ip, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?)',
      req?.user?.id ?? meta.actorId ?? null,
      req?.user?.role ?? meta.actorRole ?? (req ? 'guest' : 'system'),
      action,
      meta.entity ?? null,
      meta.entityId != null ? String(meta.entityId) : null,
      req ? clientIp(req) : (meta.ip ?? null),
      JSON.stringify(meta.details ?? {}),
      now()
    );
  } catch (_) { /* never break the request because of logging */ }
}

function limiter(windowMs, max, message) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      audit(req, 'rate_limit_hit', { details: { path: req.path } });
      if (req.accepts('html')) {
        return res.status(429).render('public/error', {
          title: 'تعداد درخواست بیش از حد', code: 429,
          message: message || 'تعداد درخواست‌های شما از این بخش بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
        });
      }
      res.status(429).json({ error: message || 'too many requests' });
    },
  });
}

module.exports = {
  audit,
  clientIp,
  authLimiter: limiter(10 * 60 * 1000, 20, 'تلاش‌های بیش از حد برای ورود/ثبت‌نام. ۱۰ دقیقه صبر کنید.'),
  checkoutLimiter: limiter(10 * 60 * 1000, 30, 'تعداد درخواست ثبت سفارش بیش از حد است.'),
  formLimiter: limiter(10 * 60 * 1000, 15, 'تعداد ارسال فرم بیش از حد است. کمی بعد دوباره تلاش کنید.'),
  downloadLimiter: limiter(60 * 60 * 1000, 100, 'تعداد دانلود بیش از حد مجاز است.'),
  apiLimiter: limiter(60 * 1000, 120),
};
