'use strict';
const crypto = require('crypto');

/** Synchronizer-token CSRF protection for session-based forms/AJAX. */
function csrf(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  }
  res.locals.csrfToken = req.session.csrfToken;

  const safe = ['GET', 'HEAD', 'OPTIONS'];
  if (safe.includes(req.method)) return next();

  const sent =
    (req.body && (req.body._csrf || req.body.csrf_token)) ||
    req.get('X-CSRF-Token') ||
    (req.query && req.query._csrf);

  const expected = req.session.csrfToken;
  const a = Buffer.from(String(sent || ''));
  const b = Buffer.from(String(expected || ''));
  if (!sent || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('public/error', {
      title: 'خطای امنیتی', code: 403,
      message: 'توکن اعتبارسنجی درخواست نامعتبر یا منقضی است. لطفاً صفحه را تازه کنید و دوباره تلاش کنید.',
    });
  }
  next();
}

module.exports = csrf;
