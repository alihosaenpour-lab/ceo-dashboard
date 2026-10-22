'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const config = require('./src/config');
const SqliteSessionStore = require('./src/lib/sessionStore');
const { loadUser } = require('./src/middleware/auth');
const csrf = require('./src/middleware/csrf');
const { getSetting, siteSettings } = require('./src/lib/settings');
const { cartCount } = require('./src/lib/cart');
const helpers = require('./src/lib/helpers');
const { gatewayStatus } = require('./src/lib/payments');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'object-src': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

/* ---------- sessions ---------- */
app.use(session({
  name: 'sparklab.sid',
  store: new SqliteSessionStore(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd && process.env.FORCE_SECURE_COOKIE === '1',
    maxAge: 7 * 24 * 3600 * 1000,
  },
}));
setInterval(() => SqliteSessionStore.prune(), 30 * 60 * 1000).unref();

/* ---------- views ---------- */
app.set('view engine', 'ejs');
app.set('views', path.join(config.root, 'views'));

/* ---------- static ---------- */
app.use(express.static(path.join(config.root, 'public'), {
  maxAge: '7d',
  setHeaders: (res, p) => {
    if (p.endsWith('.svg')) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  },
}));
// admin-uploaded public images (product covers, banners)
app.use('/media', express.static(config.publicUploadsDir, { maxAge: '1d', fallthrough: true }));

/* ---------- locals + csrf ---------- */
app.use(loadUser);

app.use((req, res, next) => {
  res.locals.settings = siteSettings();
  res.locals.footerPages = (() => {
    try { return require('./src/db').all('SELECT slug, title FROM pages WHERE is_active = 1 AND show_in_footer = 1 ORDER BY sort_order'); }
    catch (_) { return []; }
  })();
  res.locals.cartCount = (() => { try { return cartCount(req); } catch (_) { return 0; } })();
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.h = helpers;
  res.locals.flash = null;
  if (req.session && req.session.flash) {
    res.locals.flash = req.session.flash;
    req.session.flash = null;
  }
  res.locals.gateway = (() => { try { return gatewayStatus(); } catch (_) { return { key: 'none', connected: false, label: '—', detail: '' }; } })();
  next();
});

app.use(csrf);

/* ---------- robots / sitemap ---------- */
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nDisallow: /checkout\nSitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const { all } = require('./src/db');
  const base = `${req.protocol}://${req.get('host')}`;
  const products = all('SELECT slug, updated_at, created_at FROM products WHERE is_active = 1');
  const cats = all('SELECT slug FROM categories WHERE is_active = 1');
  const pages = all('SELECT slug FROM pages WHERE is_active = 1');
  const portfolio = all('SELECT slug FROM portfolio_items WHERE is_active = 1');
  const urls = [
    { loc: '/', pri: '1.0' }, { loc: '/shop', pri: '0.9' }, { loc: '/services', pri: '0.9' },
    { loc: '/portfolio', pri: '0.8' }, { loc: '/projects/new', pri: '0.8' }, { loc: '/faq', pri: '0.6' },
    { loc: '/contact', pri: '0.6' },
    ...cats.map((c) => ({ loc: `/shop?category=${c.slug}`, pri: '0.7' })),
    ...products.map((p) => ({ loc: `/product/${p.slug}`, pri: '0.8', mod: p.updated_at || p.created_at })),
    ...pages.map((p) => ({ loc: `/p/${p.slug}`, pri: '0.5' })),
    ...portfolio.map((p) => ({ loc: `/portfolio/${p.slug}`, pri: '0.6' })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${base}${u.loc}</loc>${u.mod ? `<lastmod>${new Date(u.mod).toISOString()}</lastmod>` : ''}<priority>${u.pri}</priority></url>`).join('\n') +
    `\n</urlset>`;
  res.type('application/xml').send(xml);
});

/* ---------- routes ---------- */
app.use('/', require('./src/routes/public'));
app.use('/auth', require('./src/routes/auth'));
app.use('/cart', require('./src/routes/cart'));
app.use('/checkout', require('./src/routes/checkout'));
app.use('/account', require('./src/routes/account'));
app.use('/projects', require('./src/routes/projects'));
app.use('/download', require('./src/routes/download'));
app.use('/admin', require('./src/routes/admin'));

/* ---------- 404 / errors ---------- */
app.use((req, res) => {
  res.status(404).render('public/error', {
    title: 'صفحه یافت نشد', code: 404,
    message: 'صفحه‌ای که به دنبال آن هستید وجود ندارد یا منتقل شده است.',
  });
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', err);
  const safeRender = (status, data) => {
    try {
      res.locals.settings = res.locals.settings || siteSettings();
      res.locals.currentPath = res.locals.currentPath || req.path;
      res.locals.csrfToken = res.locals.csrfToken || (req.session && req.session.csrfToken) || '';
      res.locals.flash = res.locals.flash || null;
      res.locals.cartCount = res.locals.cartCount || 0;
      res.locals.currentUser = res.locals.currentUser || null;
      res.locals.unreadNotifications = 0;
      res.locals.h = res.locals.h || helpers;
      res.locals.footerPages = res.locals.footerPages || [];
      res.locals.gateway = res.locals.gateway || { key: 'none', connected: false, label: '—', detail: '' };
      res.status(status).render('public/error', data);
    } catch (_) {
      res.status(status).type('html').send('<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>خطا</title></head><body style="font-family:Tahoma;background:#070b14;color:#e2e8f0;padding:3rem;text-align:center"><h1>' + status + '</h1><p>خطای داخلی رخ داد.</p><a href="/" style="color:#22d3ee">بازگشت به صفحه اصلی</a></body></html>');
    }
  };
  if (err && err.type === 'entity.parse.failed') {
    return safeRender(400, { title: 'درخواست نامعتبر', code: 400, message: 'بدنه درخواست قابل پردازش نیست.' });
  }
  if (err && /نوع فایل|مجاز نیست|حجم فایل/.test(err.message || '')) {
    return safeRender(400, { title: 'فایل نامعتبر', code: 400, message: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return safeRender(400, { title: 'حجم فایل بیش از حد', code: 400, message: 'حجم فایل ارسالی بیش از حد مجاز است.' });
  }
  const code = err.status || err.statusCode || 500;
  safeRender(code, {
    title: 'خطای سرور', code,
    message: config.isProd ? 'خطای داخلی رخ داد. لطفاً دوباره تلاش کنید.' : String(err.message || err),
  });
});

/* ---------- start ---------- */
if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log(`Spark Lab running at http://${config.host}:${config.port} (env=${config.env})`);
    if (config.sessionSecretGenerated) {
      console.warn('⚠ SESSION_SECRET در .env تنظیم نشده — یک کلید موقت تولید شد. نشست‌ها پس از ری‌استارت بی‌اعتبار می‌شوند.');
    }
    const gw = gatewayStatus();
    console.log(`Payment gateway: ${gw.label} — ${gw.detail}`);
  });
}

module.exports = app;
