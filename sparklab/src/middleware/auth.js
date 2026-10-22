'use strict';
const { get } = require('../db');

function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.unreadNotifications = 0;
  if (req.session && req.session.userId) {
    const u = get('SELECT id, name, email, phone, role, is_active, created_at FROM users WHERE id = ?', req.session.userId);
    if (u && u.is_active) {
      req.user = u;
      res.locals.currentUser = u;
      const n = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', u.id);
      res.locals.unreadNotifications = n ? n.c : 0;
    } else {
      // user deleted/deactivated → kill session
      req.session.userId = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  if (req.path.startsWith('/admin') || req.originalUrl.startsWith('/admin')) {
    return res.redirect('/auth/login?next=/admin');
  }
  res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('public/error', {
        title: 'دسترسی ممنوع', code: 403,
        message: 'شما اجازه دسترسی به این بخش را ندارید.',
      });
    }
    next();
  };
}

module.exports = { loadUser, requireAuth, requireRole };
