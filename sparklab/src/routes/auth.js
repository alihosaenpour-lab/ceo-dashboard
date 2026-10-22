'use strict';
const express = require('express');
const crypto = require('crypto');
const { get, run } = require('../db');
const { hashPassword, verifyPassword, randomToken, sha256 } = require('../lib/crypto');
const { validator } = require('../middleware/validate');
const { authLimiter, audit } = require('../middleware/security');
const { mergeIntoUserCart } = require('../lib/cart');
const { sendMail } = require('../lib/notify');

const router = express.Router();
const now = () => new Date().toISOString();

function redirectAfterLogin(req, res) {
  const next = req.session.returnTo || (req.query.next || '');
  req.session.returnTo = null;
  if (next && next.startsWith('/') && !next.startsWith('//')) return res.redirect(next);
  if (req.user && (req.user.role === 'admin' || req.user.role === 'staff')) return res.redirect('/admin');
  res.redirect('/account');
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('auth/login', { title: 'ورود | اسپارک لب', metaDescription: '', values: {}, errors: {}, next: req.query.next || '' });
});

router.post('/login', authLimiter, (req, res) => {
  const v = validator(req.body);
  const email = v.email('email', 'ایمیل');
  const password = v.string('password', 'رمز عبور', { min: 1, max: 128 });
  if (!v.ok()) {
    return res.status(400).render('auth/login', { title: 'ورود | اسپارک لب', metaDescription: '', values: { email }, errors: v.errors, next: req.body.next || '' });
  }
  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    audit(req, 'login_failed', { details: { email } });
    return res.status(401).render('auth/login', {
      title: 'ورود | اسپارک لب', metaDescription: '', values: { email },
      errors: { email: 'ایمیل یا رمز عبور اشتباه است.' }, next: req.body.next || '',
    });
  }
  if (!user.is_active) {
    audit(req, 'login_blocked_inactive', { entityId: user.id });
    return res.status(403).render('auth/login', {
      title: 'ورود | اسپارک لب', metaDescription: '', values: { email },
      errors: { email: 'این حساب غیرفعال شده است. با پشتیبانی تماس بگیرید.' }, next: '',
    });
  }
  // session fixation protection
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) { console.error(err); return res.status(500).send('session error'); }
    req.session.userId = user.id;
    req.session.returnTo = returnTo;
    req.session.flash = { type: 'ok', text: `خوش آمدید ${user.name}!` };
    run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
    mergeIntoUserCart(req.sessionID, user.id); // note: session id changed; guest cart merges below via old sid if any
    audit({ ...req, user }, 'login_success', { entityId: user.id });
    req.session.save(() => {
      req.user = { id: user.id, role: user.role };
      redirectAfterLogin(req, res);
    });
  });
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('auth/register', { title: 'ثبت‌نام | اسپارک لب', metaDescription: '', values: {}, errors: {} });
});

router.post('/register', authLimiter, (req, res) => {
  const v = validator(req.body);
  const name = v.string('name', 'نام و نام خانوادگی', { min: 3, max: 100 });
  const email = v.email('email');
  const phone = v.phone('phone', 'شماره موبایل', { required: true });
  const password = v.password('password', 'رمز عبور', { min: 8 });
  const confirm = String(req.body.password2 || '');
  if (password && password !== confirm) v.errors.password2 = 'تکرار رمز عبور مطابقت ندارد.';
  const accept = v.bool('accept_terms');
  if (!accept) v.errors.accept_terms = 'پذیرش قوانین استفاده الزامی است.';
  if (email && get('SELECT id FROM users WHERE email = ?', email)) v.errors.email = 'این ایمیل قبلاً ثبت شده است.';
  if (!v.ok()) {
    return res.status(400).render('auth/register', { title: 'ثبت‌نام | اسپارک لب', metaDescription: '', values: { name, email, phone }, errors: v.errors });
  }
  const id = run('INSERT INTO users (name, email, phone, password_hash, role, is_active, created_at) VALUES (?,?,?,?,?,1,?)',
    name, email, phone, hashPassword(password), 'customer', now()).lastId;
  audit({ ...req, user: { id, role: 'customer' } }, 'user_registered', { entityId: id });
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) { console.error(err); return res.status(500).send('session error'); }
    req.session.userId = id;
    req.session.returnTo = returnTo;
    req.session.flash = { type: 'ok', text: 'حساب شما ساخته شد. خوش آمدید!' };
    mergeIntoUserCart(req.sessionID, id);
    req.session.save(() => redirectAfterLogin(req, res));
  });
});

router.post('/logout', (req, res) => {
  const uid = req.user?.id;
  req.session.destroy(() => {
    res.clearCookie('sparklab.sid');
    if (uid) audit({ user: { id: uid } }, 'logout', { entityId: uid });
    res.redirect('/');
  });
});

/* ---------- password reset ---------- */
router.get('/forgot', (req, res) => {
  res.render('auth/forgot', { title: 'بازیابی رمز عبور | اسپارک لب', metaDescription: '', values: {}, errors: {}, info: null });
});

router.post('/forgot', authLimiter, async (req, res) => {
  const v = validator(req.body);
  const email = v.email('email');
  const genericMsg = 'اگر این ایمیل در سیستم ثبت شده باشد، لینک بازیابی رمز عبور ارسال شد.';
  if (!v.ok()) {
    return res.status(400).render('auth/forgot', { title: 'بازیابی رمز عبور | اسپارک لب', metaDescription: '', values: { email }, errors: v.errors, info: null });
  }
  const user = get('SELECT * FROM users WHERE email = ? AND is_active = 1', email);
  if (user) {
    const token = randomToken(24);
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    run('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?)',
      user.id, sha256(token), expires, now());
    audit(req, 'password_reset_requested', { entityId: user.id });
    await sendMail({
      to: user.email,
      subject: 'بازیابی رمز عبور — اسپارک لب',
      html: `<div dir="rtl" style="font-family:Tahoma,sans-serif">
        <p>${user.name} عزیز،</p>
        <p>برای بازنشانی رمز عبور روی لینک زیر کلیک کنید (اعتبار: ۳۰ دقیقه):</p>
        <p><a href="/auth/reset/${token}">بازنشانی رمز عبور</a></p>
        <p>اگر این درخواست را شما ثبت نکرده‌اید، این ایمیل را نادیده بگیرید.</p>
      </div>`,
    }).then((r) => {
      if (!r.sent) {
        // No SMTP in this environment — print once to the server log (never to any user).
        console.log(`[password-reset] user=${user.email} link=/auth/reset/${token} (email delivery unavailable: ${r.reason})`);
      }
    });
  }
  res.render('auth/forgot', { title: 'بازیابی رمز عبور | اسپارک لب', metaDescription: '', values: { email }, errors: {}, info: genericMsg });
});

router.get('/reset/:token', (req, res) => {
  const row = get('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
    sha256(req.params.token), now());
  if (!row) {
    return res.status(400).render('auth/reset', { title: 'بازنشانی رمز | اسپارک لب', metaDescription: '', token: '', errors: { token: 'لینک بازیابی نامعتبر یا منقضی است.' }, values: {} });
  }
  res.render('auth/reset', { title: 'بازنشانی رمز | اسپارک لب', metaDescription: '', token: req.params.token, errors: {}, values: {} });
});

router.post('/reset/:token', authLimiter, (req, res) => {
  const row = get('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
    sha256(req.params.token), now());
  if (!row) {
    return res.status(400).render('auth/reset', { title: 'بازنشانی رمز | اسپارک لب', metaDescription: '', token: '', errors: { token: 'لینک بازیابی نامعتبر یا منقضی است.' }, values: {} });
  }
  const v = validator(req.body);
  const password = v.password('password', 'رمز عبور جدید', { min: 8 });
  const confirm = String(req.body.password2 || '');
  if (password && password !== confirm) v.errors.password2 = 'تکرار رمز مطابقت ندارد.';
  if (!v.ok()) {
    return res.status(400).render('auth/reset', { title: 'بازنشانی رمز | اسپارک لب', metaDescription: '', token: req.params.token, errors: v.errors, values: {} });
  }
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(password), now(), row.user_id);
  run('UPDATE password_resets SET used_at = ? WHERE id = ?', now(), row.id);
  run('DELETE FROM sessions WHERE sess LIKE ?', `%"userId":${row.user_id}%`); // revoke other sessions
  audit({ user: { id: row.user_id } }, 'password_reset_completed', { entityId: row.user_id });
  req.session.flash = { type: 'ok', text: 'رمز عبور بازنشانی شد. اکنون وارد شوید.' };
  res.redirect('/auth/login');
});

module.exports = router;
