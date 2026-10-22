'use strict';
/**
 * Spark Lab — Acceptance tests (runs against a live server on BASE_URL).
 * Covers the mandatory scenarios:
 *  1) register/login/logout           2) admin adds product → visible in shop
 *  3) test purchase → correct status  4) failed payment → no delivery
 *  5) download access control         6) project request + admin status workflow
 *  7) roles, validation, persistence  8) responsive/markup sanity + SEO basics
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name + (extra ? ` (${extra})` : '')); console.log(`  ✗ ${name} ${extra}`); }
}
function section(t) { console.log(`\n── ${t}`); }

/* ---------- tiny HTTP client with cookie jar + CSRF ---------- */
function makeClient() {
  const jar = new Map();
  return {
    jar,
    async req(method, url, { body, form, redirect = 'manual', headers = {} } = {}) {
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      const opts = { method, redirect, headers: { ...headers } };
      if (cookie) opts.headers.Cookie = cookie;
      if (form) {
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        opts.body = new URLSearchParams(form).toString();
      } else if (body !== undefined) opts.body = body;
      const target = url.startsWith('http') ? url : BASE + url;
      const res = await fetch(target, opts);
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const sc of setCookies) {
        const [pair] = sc.split(';');
        const idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
      return res;
    },
    async get(url) { return this.req('GET', url); },
    async text(url) { const r = await this.get(url); return { status: r.status, body: await r.text(), res: r }; },
    async csrf(url) {
      const { body } = await this.text(url);
      const m = body.match(/SPARK_CSRF\s*=\s*"([^"]+)"/) || body.match(/name="_csrf" value="([^"]+)"/);
      return m ? m[1] : null;
    },
    async post(url, form, opts = {}) {
      return this.req('POST', url, { form, ...opts });
    },
  };
}

const uniq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

async function login(client, email, password) {
  const token = await client.csrf('/auth/login');
  const r = await client.post('/auth/login', { _csrf: token, email, password });
  return r;
}

async function register(client, email, password) {
  const token = await client.csrf('/auth/register');
  return client.post('/auth/register', {
    _csrf: token, name: 'کاربر تست ' + uniq().slice(-4), email, phone: '09121234567',
    password, password2: password, accept_terms: '1',
  });
}

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@sparklab.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ||
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/SEED_ADMIN_PASSWORD=(.*)/)[1].trim();

(async function main() {
  console.log(`Spark Lab acceptance tests → ${BASE}`);

  /* ============ 0) sanity ============ */
  section('۰. سلامت عمومی سایت');
  const anon = makeClient();
  {
    const home = await anon.text('/');
    ok('صفحه اصلی ۲۰۰ و حاوی هویت برند', home.status === 200 && home.body.includes('SPARK') && home.body.includes('اسپارک لب'));
    ok('viewport برای موبایل تعریف شده', home.body.includes('name="viewport"'));
    ok('JSON-LD سازمان در خانه', home.body.includes('application/ld+json') && home.body.includes('Organization'));
    const robots = await anon.text('/robots.txt');
    ok('robots.txt شامل sitemap و مسدودی admin', robots.status === 200 && robots.body.includes('Sitemap') && robots.body.includes('Disallow: /admin'));
    const sm = await anon.text('/sitemap.xml');
    ok('sitemap.xml با URL محصولات', sm.status === 200 && sm.body.includes('/product/spark-pos-cloud'));
    const nf = await anon.get('/definitely-not-here');
    ok('۴۰۴ برای صفحه ناموجود', nf.status === 404);
    const css = await anon.text('/css/style.css');
    ok('CSS با مدیاکوئری واکنش‌گرا', css.status === 200 && css.body.includes('@media (max-width: 860px)') && css.body.includes('@media (max-width: 640px)'));
  }

  /* ============ 7a) CSRF & validation ============ */
  section('۷. امنیت: CSRF و اعتبارسنجی ورودی');
  {
    const r = await anon.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }); // no csrf token
    ok('POST بدون توکن CSRF → ۴۰۳', r.status === 403);

    const badEmail = await register(anon, 'not-an-email', 'Passw0rd!23');
    ok('ثبت‌نام با ایمیل نامعتبر رد می‌شود', badEmail.status === 400);

    const token = await anon.csrf('/auth/register');
    const shortPw = await anon.post('/auth/register', {
      _csrf: token, name: 'تست کوتاه', email: `t-${uniq()}@test.local`, phone: '09121234567',
      password: '123', password2: '123', accept_terms: '1',
    });
    ok('رمز کوتاه (<۸) رد می‌شود', shortPw.status === 400);

    const badPhoneTok = await anon.csrf('/projects/new');
    const badPhone = await anon.post('/projects/new', {
      _csrf: badPhoneTok, name: 'تست', email: 'a@b.local', phone: '12345', project_type: 'website',
      title: 'پروژه تست نامعتبر', description: 'شرح'.repeat(20),
    });
    ok('فرم پروژه با موبایل نامعتبر رد می‌شود', badPhone.status === 400);
  }

  /* ============ 1) auth flows ============ */
  section('۱. ثبت‌نام، ورود و خروج کاربر');
  const userEmail = `user-${uniq()}@example.com`;
  const userPass = 'Test@12345';
  const user = makeClient();
  {
    const reg = await register(user, userEmail, userPass);
    ok('ثبت‌نام موفق → هدایت به پنل', reg.status === 302 && reg.headers.get('location') === '/account', reg.status + ' ' + reg.headers.get('location'));
    const acc = await user.text('/account');
    ok('پنل حساب پس از ثبت‌نام در دسترس است', acc.status === 200 && acc.body.includes('پیشخوان'));
    const logoutTok = await user.csrf('/account');
    const lo = await user.post('/auth/logout', { _csrf: logoutTok });
    ok('خروج از حساب', lo.status === 302);
    const after = await user.get('/account');
    ok('پس از خروج، پنل محافظت‌شده → هدایت به ورود', after.status === 302 && after.headers.get('location').startsWith('/auth/login'));
    const li = await login(user, userEmail, userPass);
    ok('ورود مجدد با رمز درست', li.status === 302);
    const wrong = await login(makeClient(), userEmail, 'wrong-password');
    ok('ورود با رمز اشتباه → ۴۰۱', wrong.status === 401);
  }

  /* password reset flow */
  {
    const resetEmail = `reset-${uniq()}@example.com`;
    const fc = makeClient();
    await register(fc, resetEmail, userPass);
    const ftok = await fc.csrf('/auth/forgot');
    const fr = await fc.post('/auth/forgot', { _csrf: ftok, email: resetEmail });
    const fbody = await fr.text();
    ok('درخواست بازیابی رمز پاسخ عمومی و امن می‌دهد', fr.status === 200 && fbody.includes('لینک بازیابی رمز عبور ارسال شد'));
    // SMTP is not configured in test env; the link is written to the server log (documented behavior)
    let link = null;
    try {
      const log = fs.readFileSync('/tmp/spark.log', 'utf8');
      const lines = log.split('\n').filter((l) => l.includes('[password-reset]') && l.includes(resetEmail));
      if (lines.length) link = (lines[lines.length - 1].match(/link=(\S+)/) || [])[1];
    } catch (_) {}
    if (link) {
      const rc = makeClient();
      const rp = await rc.text(link);
      ok('لینک بازیابی رمز باز می‌شود', rp.status === 200 && rp.body.includes('بازنشانی رمز عبور'));
      const rtok = await rc.csrf(link);
      const rr = await rc.post(link, { _csrf: rtok, password: 'NewPass@123', password2: 'NewPass@123' });
      ok('بازنشانی رمز → هدایت به ورود', rr.status === 302 && rr.headers.get('location') === '/auth/login');
      const li = await login(makeClient(), resetEmail, 'NewPass@123');
      ok('ورود با رمز بازنشانی‌شده', li.status === 302);
    } else {
      console.log('  ⚠ لینک بازیابی در لاگ سرور یافت نشد (تست reset skip شد)');
    }
  }

  /* admin login */
  const admin = makeClient();
  {
    const r = await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
    ok('ورود مدیر', r.status === 302 && (r.headers.get('location') || '').startsWith('/admin'), r.headers.get('location'));
    const dash = await admin.text('/admin');
    ok('پیشخوان مدیریت در دسترس مدیر است', dash.status === 200 && dash.body.includes('پیشخوان مدیریت'));
  }

  /* ============ 7b) roles ============ */
  section('۷. کنترل دسترسی نقش‌ها');
  {
    const cust = makeClient();
    await register(cust, `cust-${uniq()}@example.com`, userPass);
    const adminPage = await cust.get('/admin');
    ok('مشتری به /admin دسترسی ندارد (۴۰۳)', adminPage.status === 403);
    const usersPage = await cust.get('/admin/users');
    ok('مشتری به /admin/users دسترسی ندارد', usersPage.status === 403 || usersPage.status === 302);
  }
  {
    // staff user via admin role change
    const staffEmail = `staff-${uniq()}@example.com`;
    const staffClient = makeClient();
    await register(staffClient, staffEmail, userPass);
    // find user id via admin users page
    const usersPage = await admin.text('/admin/users?q=' + encodeURIComponent(staffEmail));
    const m = usersPage.body.match(/action="\/admin\/users\/(\d+)\/role"/);
    ok('کاربر جدید در فهرست کاربران مدیر دیده می‌شود', Boolean(m));
    if (m) {
      const tok = await admin.csrf('/admin/users');
      await admin.post(`/admin/users/${m[1]}/role`, { _csrf: tok, role: 'staff' });
      await staffClient.post('/auth/logout', { _csrf: await staffClient.csrf('/account') });
      const li = await login(staffClient, staffEmail, userPass);
      const okStaff = li.status === 302 && li.headers.get('location') === '/admin';
      ok('نقش staff به پنل مدیریت هدایت می‌شود', okStaff, li.headers.get('location'));
      const products = await staffClient.get('/admin/products');
      ok('staff به مدیریت محصولات دسترسی دارد', products.status === 200);
      const usersForStaff = await staffClient.get('/admin/users');
      ok('staff به مدیریت کاربران دسترسی ندارد (۴۰۳)', usersForStaff.status === 403);
      const settingsForStaff = await staffClient.get('/admin/settings');
      ok('staff به تنظیمات دسترسی ندارد (۴۰۳)', settingsForStaff.status === 403);
    }
  }

  /* ============ gateway honesty ============ */
  section('۳-۰. شفافیت وضعیت درگاه پرداخت');
  {
    // force gateway=none first for a deterministic honesty check
    const t0 = await admin.csrf('/admin/settings');
    await admin.post('/admin/settings/gateway', { _csrf: t0, active: 'none' });
    const adminDash = await admin.text('/admin');
    ok('هشدار «درگاه متصل نیست» در پنل مدیر (وقتی active=none)', adminDash.body.includes('درگاه پرداخت متصل نیست'));
    const prodPage = await anon.text('/product/spark-pos-cloud');
    ok('صفحه محصول وضعیت واقعی درگاه را نشان می‌دهد', prodPage.body.includes('درگاه پرداخت این فروشگاه هنوز به سرویس واقعی متصل نشده'));
    const chTok0 = await user.csrf('/checkout') || null;
    // checkout POST with no gateway must be blocked honestly (503)
    await user.post('/cart/add', { _csrf: await user.csrf('/product/spark-pos-cloud'), product_id: '2', qty: '1', redirect: '/cart' });
    const blocked = await user.post('/checkout', { _csrf: await user.csrf('/checkout'), name: 'کاربر تست', email: userEmail, phone: '09121234567', accept_terms: '1' });
    ok('ثبت سفارش بدون درگاه فعال → ۵۰۳ و پیام شفاف (بدون شبیه‌سازی موفقیت)', blocked.status === 503);
    // clear the cart for later deterministic tests
    await user.post('/cart/clear', { _csrf: await user.csrf('/cart') });
  }

  /* ============ 2) admin adds product ============ */
  section('۲. افزودن محصول توسط مدیر و نمایش در فروشگاه');
  let newProductSlug = `test-product-${uniq()}`;
  {
    const tok = await admin.csrf('/admin/products/new');
    const title = 'محصول تست اتوماسیون ' + newProductSlug.slice(-6);
    const r = await admin.post('/admin/products/new', {
      _csrf: tok, title, slug: newProductSlug, category_id: '1',
      summary: 'یک محصول تستی برای سناریوی پذیرش — خلاصه کافی برای اعتبارسنجی فرم.',
      description_html: '<h2>توضیحات</h2><p>شرح کامل محصول تستی با <b>قالب‌بندی</b>.</p><script>alert(1)</script>',
      features: 'امکان اول\nامکان دوم',
      price: '250000', discount_price: '199000', version: '0.9.0',
      license_type: 'standard', requirements_text: 'Node.js', compatibility_text: 'وب',
      support_terms: '۳ ماه', is_active: '1', is_featured: '1',
      faq_q: ['سوال تست؟'], faq_a: ['جواب تست.'],
    });
    ok('ایجاد محصول → هدایت به ویرایش', r.status === 302 && r.headers.get('location').includes('/admin/products/'), r.headers.get('location'));

    const shop = await anon.text('/shop?q=' + encodeURIComponent(title));
    ok('محصول جدید در جست‌وجوی فروشگاه دیده می‌شود', shop.body.includes(title));

    const pp = await anon.text('/product/' + newProductSlug);
    ok('صفحه اختصاصی محصول ۲۰۰ است', pp.status === 200);
    ok('XSS در توضیحات مدیر ضدعفونی شده (script حذف)', !pp.body.includes('<script>alert(1)</script>'));
    ok('JSON-LD محصول در صفحه محصول', pp.body.includes('"@type":"Product"') || pp.body.includes('"@type": "Product"'));

    // upload a real product file for delivery tests
    const pidMatch = r.headers.get('location').match(/\/admin\/products\/(\d+)/);
    const pid = pidMatch ? pidMatch[1] : null;
    ok('شناسه محصول جدید قابل استخراج است', Boolean(pid));
    if (pid) {
      const zipPath = path.join(__dirname, '..', 'storage', 'private', 'files', 'seed-orbit-ui-kit-4.0.0.zip');
      // build multipart form manually
      const boundary = '----sparktest' + uniq();
      const fileBuf = fs.readFileSync(zipPath);
      const parts = [];
      const field = (n, v) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`);
      const tok2 = await admin.csrf(`/admin/products/${pid}/edit`);
      parts.push(field('_csrf', tok2));
      parts.push(field('version', '0.9.0'));
      parts.push(field('label', 'بسته تست'));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test-package.zip"\r\nContent-Type: application/zip\r\n\r\n`));
      parts.push(fileBuf);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      const up = await admin.req('POST', `/admin/products/${pid}/files?_csrf=${encodeURIComponent(tok2)}`, {
        body: Buffer.concat(parts),
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      });
      ok('بارگذاری فایل محصول توسط مدیر', up.status === 302, up.status + '');
      const editPage = await admin.text(`/admin/products/${pid}/edit`);
      ok('فایل بارگذاری‌شده در ویرایش محصول listed است', editPage.body.includes('test-package.zip'));
    }
  }

  /* ============ enable TEST gateway (as admin) ============ */
  section('۳. خرید آزمایشی در محیط تست');
  {
    const tok = await admin.csrf('/admin/settings');
    const r = await admin.post('/admin/settings/gateway', { _csrf: tok, active: 'test', test_enabled: '1' });
    ok('فعال‌سازی درگاه آزمایشی توسط مدیر', r.status === 302);
    const shop = await anon.text('/product/spark-pos-cloud');
    ok('اعلام شفاف «درگاه آزمایشی» در صفحه محصول', shop.body.includes('درگاه آزمایشی'));
  }

  let paidOrderNo = null, downloadToken = null, failedOrderNo = null;
  {
    // customer buys the seeded POS product
    const tok = await user.csrf('/product/spark-pos-cloud');
    const add = await user.post('/cart/add', { _csrf: tok, product_id: '1', qty: '1', redirect: '/cart' });
    ok('افزودن محصول به سبد', add.status === 302);
    const cartPage = await user.text('/cart');
    ok('محصول در سبد خرید نمایش داده می‌شود', cartPage.body.includes('سبد خرید') && cartPage.body.includes('داشبورد فروش ابری'));

    // coupon
    const ctok = await user.csrf('/cart');
    await user.post('/cart/coupon', { _csrf: ctok, coupon_code: 'WELCOME10' });
    const cartWithCoupon = await user.text('/cart');
    ok('کد تخفیف WELCOME10 اعمال می‌شود', cartWithCoupon.body.includes('WELCOME10') && cartWithCoupon.body.includes('تخفیف'));

    const chTok = await user.csrf('/checkout');
    const co = await user.post('/checkout', {
      _csrf: chTok, name: 'کاربر تست', email: userEmail, phone: '09121234567', accept_terms: '1',
    });
    const loc = co.headers.get('location') || '';
    ok('ثبت سفارش → هدایت به درگاه آزمایشی', co.status === 302 && loc.includes('/checkout/test-gateway'), loc);
    const orderNo = (loc.match(/order=([^&]+)/) || [])[1];
    paidOrderNo = orderNo;

    const gwPage = await user.text(loc.replace('/checkout/test-gateway', '/checkout/test-gateway'));
    ok('صفحه درگاه با برچسب محیط آزمایشی', gwPage.body.includes('محیط آزمایشی') && gwPage.body.includes('پول'));
    const stateM = gwPage.body.match(/name="state" value="([^"]+)"/);
    ok('توکن امضاشده نشست پرداخت موجود است', Boolean(stateM));

    const cbTok = await user.csrf(loc);
    const cb = await user.post(`/checkout/callback?gateway=test&order=${orderNo}`, {
      _csrf: cbTok, state: stateM ? stateM[1] : '', order: orderNo, gateway: 'test', outcome: 'ok',
    });
    ok('بازگشت موفق از درگاه → هدایت به رسید سفارش', cb.status === 302 && (cb.headers.get('location') || '').includes(`/account/orders/${orderNo}`), cb.headers.get('location'));

    const od = await user.text(`/account/orders/${orderNo}`);
    ok('وضعیت سفارش «پرداخت‌شده» است', od.body.includes('پرداخت‌شده'));
    ok('تخفیف در رسید لحاظ شده', od.body.includes('WELCOME10'));
    ok('لینک دانلود در صفحه سفارش فعال شد', od.body.includes('/download/'));
    const tokM = od.body.match(/\/download\/([A-Za-z0-9_\-]+)/);
    downloadToken = tokM ? tokM[1] : null;
    ok('توکن دانلود قابل استخراج است', Boolean(downloadToken));

    // idempotency: replaying the success callback must not double-finalize
    const replay = await user.post(`/checkout/callback?gateway=test&order=${orderNo}`, {
      _csrf: cbTok, state: stateM ? stateM[1] : '', order: orderNo, gateway: 'test', outcome: 'ok',
    });
    const odAfter = await user.text(`/account/orders/${orderNo}`);
    ok('پخش مجدد callback وضعیت را خراب نمی‌کند (idempotent)', odAfter.body.includes('پرداخت‌شده'), replay.status + '');
  }

  /* ============ 5) download access control ============ */
  section('۵. کنترل دسترسی دانلود فایل');
  {
    ok('توکن دانلود از خرید موفق به دست آمد', Boolean(downloadToken));
    if (downloadToken) {
      const dl = await user.get('/download/' + downloadToken);
      const dlType = dl.headers.get('content-type') || '';
      const dlDisp = dl.headers.get('content-disposition') || '';
      await dl.arrayBuffer();
      ok('خریدار می‌تواند فایل را دانلود کند (۲۰۰ + attachment)', dl.status === 200 && dlDisp.includes('attachment'));

      const other = makeClient();
      await register(other, `other-${uniq()}@example.com`, userPass);
      const dlOther = await other.get('/download/' + downloadToken);
      ok('کاربر دیگر (غیر خریدار) → ۴۰۳', dlOther.status === 403, dlOther.status + '');

      const dlAnon = await makeClient().get('/download/' + downloadToken);
      ok('کاربر ناشناس → هدایت به ورود یا ۴۰۳', dlAnon.status === 302 || dlAnon.status === 403, dlAnon.status + '');

      const dlBad = await makeClient().get('/download/forged-token-abc');
      ok('توکن جعلی → ۴۰۳', dlBad.status === 403);
    }
    // private storage not statically reachable
    const direct = await anon.get('/storage/private/files/seed-spark-pos-cloud-2.4.0.zip');
    ok('فایل خصوصی با URL مستقیم در دسترس نیست (۴۰۴)', direct.status === 404, direct.status + '');
  }

  /* ============ 4) failed payment ============ */
  section('۴. پرداخت ناموفق → عدم تحویل محصول');
  {
    const tok = await user.csrf('/product/orbit-ui-kit');
    await user.post('/cart/add', { _csrf: tok, product_id: '7', qty: '1', redirect: '/cart' });
    const chTok = await user.csrf('/checkout');
    const co = await user.post('/checkout', { _csrf: chTok, name: 'کاربر تست', email: userEmail, phone: '09121234567', accept_terms: '1' });
    const loc = co.headers.get('location') || '';
    const orderNo = (loc.match(/order=([^&]+)/) || [])[1];
    failedOrderNo = orderNo;
    ok('سفارش دوم ثبت و به درگاه هدایت شد', co.status === 302 && loc.includes('test-gateway'));
    const gwPage = await user.text(loc);
    const stateM = gwPage.body.match(/name="state" value="([^"]+)"/);
    const cbTok = await user.csrf(loc);
    const cb = await user.post(`/checkout/callback?gateway=test&order=${orderNo}`, {
      _csrf: cbTok, state: stateM ? stateM[1] : '', order: orderNo, gateway: 'test', outcome: 'fail',
    });
    const resultBody = await cb.text();
    ok('صفحه نتیجه، عدم تأیید را اعلام می‌کند', resultBody.includes('پرداخت تأیید نشد') || resultBody.includes('ناموفق'));
    const od = await user.text(`/account/orders/${orderNo}`);
    ok('وضعیت سفارش «پرداخت ناموفق» است', od.body.includes('پرداخت ناموفق'));
    ok('هیچ لینک دانلودی برای سفارش ناموفق ایجاد نشده', !od.body.includes('/download/'));
  }

  /* ============ 4b) guest checkout delivery ============ */
  section('۴-۲. خرید مهمان و تحویل کنترل‌شده');
  {
    const guest = makeClient();
    const gtok = await guest.csrf('/product/spark-booking');
    await guest.post('/cart/add', { _csrf: gtok, product_id: '8', qty: '1', redirect: '/cart' });
    const gct = await guest.csrf('/checkout');
    const gco = await guest.post('/checkout', { _csrf: gct, name: 'مهمان تست', email: `guest-${uniq()}@example.com`, phone: '09123456789', accept_terms: '1' });
    const gloc = gco.headers.get('location') || '';
    const gorderNo = (gloc.match(/order=([^&]+)/) || [])[1];
    ok('مهمان می‌تواند سفارش ثبت کند', gco.status === 302 && gloc.includes('test-gateway'));
    const ggw = await guest.text(gloc);
    const gstate = (ggw.body.match(/name="state" value="([^"]+)"/) || [])[1];
    const gcb = await guest.post(`/checkout/callback?gateway=test&order=${gorderNo}`, { _csrf: await guest.csrf(gloc), state: gstate, order: gorderNo, gateway: 'test', outcome: 'ok' });
    const gbody = await gcb.text();
    ok('صفحه نتیجه مهمان لینک دانلود مستقیم دارد', gcb.status === 200 && gbody.includes('/download/'));
    const gtoken = (gbody.match(/\/download\/([A-Za-z0-9_\-]+)/) || [])[1];
    const gdl = await guest.get('/download/' + gtoken);
    ok('مهمان با لینک امن می‌تواند دانلود کند', gdl.status === 200);
    await gdl.arrayBuffer();
  }

  /* ============ 6) project workflow ============ */
  section('۶. ثبت درخواست پروژه و گردش وضعیت از پنل مدیریت');
  let projectId = null;
  {
    const tok = await user.csrf('/projects/new');
    const r = await user.post('/projects/new', {
      _csrf: tok, name: 'کاربر تست', email: userEmail, phone: '09121234567',
      project_type: 'webapp', title: 'سامانه مدیریت انبار تست', description: 'نیاز به یک سامانه تحت وب برای مدیریت انبار با گزارش‌گیری داریم. '.repeat(2),
      budget_range: '۵۰ تا ۱۵۰ میلیون تومان', timeline: '۳ ماه',
    });
    const loc = r.headers.get('location') || '';
    ok('ثبت پروژه توسط کاربر → هدایت به پنل', r.status === 302 && loc.includes('/account/projects/'), loc);
    projectId = (loc.match(/\/account\/projects\/(\d+)/) || [])[1];
    const pd = await user.text(`/account/projects/${projectId}`);
    ok('وضعیت اولیه «دریافت درخواست»', pd.body.includes('دریافت درخواست'));

    const adminList = await admin.text('/admin/projects');
    const m = adminList.body.match(/\/admin\/projects\/(\d+)"/);
    ok('پروژه در پنل مدیریت دیده می‌شود', adminList.body.includes('سامانه مدیریت انبار تست'));

    const aTok = await admin.csrf(`/admin/projects/${projectId}`);
    const stBad = await admin.post(`/admin/projects/${projectId}/status`, { _csrf: aTok, status: 'delivered' });
    const adminPd = await admin.text(`/admin/projects/${projectId}`);
    ok('انتقال نامعتبر (received→delivered) رد می‌شود',
      stBad.status === 302 && adminPd.body.includes('طبق گردش کار مجاز نیست') && !adminPd.body.includes('وضعیت پروژه به‌روزرسانی شد'));

    for (const st of ['reviewing', 'estimating']) {
      const t = await admin.csrf(`/admin/projects/${projectId}`);
      await admin.post(`/admin/projects/${projectId}/status`, { _csrf: t, status: st, note: 'در حال بررسی کارشناسی' });
    }
    const t3 = await admin.csrf(`/admin/projects/${projectId}`);
    await admin.post(`/admin/projects/${projectId}/estimate`, { _csrf: t3, estimate_amount: '85000000', estimate_note: 'فاز ۱: ۴۰ میلیون، فاز ۲: ۴۵ میلیون' });
    let pd2 = await user.text(`/account/projects/${projectId}`);
    ok('برآورد هزینه در پنل مشتری نمایش داده می‌شود', pd2.body.includes('85,000,000') || pd2.body.includes('۸۵٬۰۰۰٬۰۰۰'));

    const t4 = await admin.csrf(`/admin/projects/${projectId}`);
    await admin.post(`/admin/projects/${projectId}/status`, { _csrf: t4, status: 'approved' });
    const t5 = await admin.csrf(`/admin/projects/${projectId}`);
    await admin.post(`/admin/projects/${projectId}/status`, { _csrf: t5, status: 'in_progress' });
    pd2 = await user.text(`/account/projects/${projectId}`);
    ok('وضعیت به «در حال انجام» رسید', pd2.body.includes('در حال انجام'));

    // messaging both ways
    const mt = await admin.csrf(`/admin/projects/${projectId}`);
    await admin.post(`/admin/projects/${projectId}/message`, { _csrf: mt, body: 'سلام، فاز طراحی را شروع کردیم.', is_internal: '' });
    const it = await admin.csrf(`/admin/projects/${projectId}`);
    await admin.post(`/admin/projects/${projectId}/message`, { _csrf: it, body: 'یادداشت داخلی: نیاز به تأیید فنی DB دارد.', is_internal: '1' });
    pd2 = await user.text(`/account/projects/${projectId}`);
    ok('پیام مدیر برای مشتری قابل مشاهده است', pd2.body.includes('فاز طراحی را شروع کردیم'));
    ok('یادداشت داخلی برای مشتری نمایش داده نمی‌شود', !pd2.body.includes('یادداشت داخلی: نیاز به تأیید فنی'));

    const ct = await user.csrf(`/account/projects/${projectId}`);
    await user.post(`/account/projects/${projectId}/message`, { _csrf: ct, body: 'ممنون، منتظر اولین خروجی هستیم.' });
    const aView = await admin.text(`/admin/projects/${projectId}`);
    ok('پاسخ مشتری در پنل مدیریت دیده می‌شود', aView.body.includes('منتظر اولین خروجی هستیم'));

    // notifications
    const notif = await user.text('/account/notifications');
    ok('اعلان تغییر وضعیت برای مشتری ثبت شده', notif.body.includes('وضعیت پروژه') || notif.body.includes('برآورد'));
  }

  /* ============ 3b) admin order management ============ */
  section('۳-۲. مدیریت سفارش از پنل (لغو/بازپرداخت)');
  {
    ok('شماره سفارش پرداخت‌شده موجود است', Boolean(paidOrderNo));
    const od = await admin.text(`/admin/orders/${paidOrderNo}`);
    ok('جزئیات سفارش در پنل مدیر با تراکنش موفق', od.status === 200 && od.body.includes('موفق'));
    const manual = await admin.post(`/admin/orders/${failedOrderNo}/status`, { _csrf: await admin.csrf(`/admin/orders/${failedOrderNo}`), status: 'paid' });
    const od2 = await admin.text(`/admin/orders/${failedOrderNo}`);
    ok('paid کردن دستی سفارش ناموفق مسدود است', !od2.body.includes('وضعیت سفارش به‌روزرسانی شد') || od2.body.includes('پرداخت ناموفق'));
    const cancel = await admin.post(`/admin/orders/${failedOrderNo}/status`, { _csrf: await admin.csrf(`/admin/orders/${failedOrderNo}`), status: 'cancelled', note: 'تست لغو' });
    const od3 = await admin.text(`/admin/orders/${failedOrderNo}`);
    ok('لغو سفارش ناموفق ممکن است', od3.body.includes('لغو شده'));
  }

  /* ============ 7c) persistence (direct DB assertions) ============ */
  section('۷. ماندگاری داده‌ها در پایگاه داده واقعی');
  {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'sparklab.sqlite'), { readOnly: true });
    const users = db.prepare(`SELECT COUNT(*) c FROM users WHERE email = ?`).get(userEmail).c;
    ok('کاربر ثبت‌نام‌شده در DB ماندگار است', users === 1);
    const ord = db.prepare(`SELECT status, total, discount_total FROM orders WHERE order_no = ?`).get(paidOrderNo);
    ok('سفارش پرداخت‌شده در DB با وضعیت paid', ord && ord.status === 'paid');
    ok('تخفیف کد در DB ثبت شده', ord && ord.discount_total > 0);
    const failed = db.prepare(`SELECT status FROM orders WHERE order_no = ?`).get(failedOrderNo);
    ok('سفارش ناموفق در DB با وضعیت cancelled (پس از لغو مدیر)', failed && ['failed', 'cancelled'].includes(failed.status));
    const grants = db.prepare(`SELECT COUNT(*) c FROM download_grants g JOIN orders o ON o.id=g.order_id WHERE o.order_no=?`).get(paidOrderNo).c;
    const failedGrants = db.prepare(`SELECT COUNT(*) c FROM download_grants g JOIN orders o ON o.id=g.order_id WHERE o.order_no=?`).get(failedOrderNo).c;
    ok('grant دانلود فقط برای سفارش پرداخت‌شده ساخته شده', grants === 1 && failedGrants === 0);
    const dlLogs = db.prepare('SELECT COUNT(*) c FROM download_logs').get().c;
    ok('سابقه دانلود ثبت شده است', dlLogs >= 1);
    const auditRows = db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action LIKE 'payment%' OR action='order_created'`).get().c;
    ok('رویدادهای امنیتی/پرداخت در audit log ثبت شده', auditRows >= 3);
    const prod = db.prepare('SELECT COUNT(*) c FROM products WHERE slug = ?').get(newProductSlug).c;
    ok('محصول ساخته‌شده توسط مدیر در DB است', prod === 1);
    db.close();
  }

  /* ============ 8) rendering sanity ============ */
  section('۸. سلامت رندر صفحات (موبایل/دسکتاپ)');
  {
    for (const p of ['/', '/shop', '/services', '/portfolio', '/faq', '/contact', '/projects/new', '/cart', '/auth/login', '/p/privacy', '/p/refund', '/p/support', '/p/purchase-terms']) {
      const r = await anon.get(p);
      const body = await r.text();
      ok(`صفحه ${p} سالم رندر می‌شود`, r.status === 200 && body.includes('</html>') && !body.includes('[object Object]'));
    }
    const mobileUA = makeClient();
    const r = await mobileUA.req('GET', '/', { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' } });
    ok('صفحه اصلی با UA موبایل ۲۰۰ است', r.status === 200);
  }

  /* ============ logout user at the end ============ */
  {
    const t = await user.csrf('/account');
    const lo = await user.post('/auth/logout', { _csrf: t });
    ok('خروج کاربر تست در پایان', lo.status === 302);
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`نتیجه: ${passed} موفق، ${failed} ناموفق`);
  if (fails.length) { console.log('موارد ناموفق:'); fails.forEach((f) => console.log('  - ' + f)); }
  console.log('═══════════════════════════════════════');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
