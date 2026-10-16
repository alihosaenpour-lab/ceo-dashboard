#!/usr/bin/env node
/**
 *  چک‌کنندهٔ راه‌اندازی — با یک دستور بفهم چه چیزی کار می‌کند و چه چیزی نه.
 *
 *  اجرا:
 *      node check.js
 *      node check.js --telegram=7712345678:AAH... --openai=sk-...
 *      node check.js --n8n=http://localhost:5678
 *
 *  این برنامه هیچ چیزی را تغییر نمی‌دهد — فقط نگاه می‌کند و می‌گوید چه کار کنی.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- آرگومان‌ها ----------
const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)=?(.*)$/);
  if (m) args[m[1]] = m[2];
}

const N8N_URL = (args.n8n || process.env.N8N_URL || 'http://localhost:5678').replace(/\/$/, '');
let TELEGRAM = args.telegram || process.env.TELEGRAM_BOT_TOKEN || '';
let OPENAI = args.openai || process.env.OPENAI_API_KEY || '';
const TEAM_DIR = path.resolve(__dirname);

// اگر توکن‌ها داده نشده‌اند، از فایل‌های کنارشان بخوان
function readEnvFile(p) {
  try {
    const out = {};
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch (e) { return {}; }
}

const repoRoot = path.resolve(TEAM_DIR, '..');
const candidates = [
  path.join(repoRoot, '.env'),
  path.join(TEAM_DIR, '.env'),
  path.join(os.homedir(), 'n8n-ceo', '.env'),
  path.join(os.homedir(), '.n8n', '.env'),
];
for (const c of candidates) {
  const env = readEnvFile(c);
  if (!TELEGRAM && env.TELEGRAM_BOT_TOKEN) TELEGRAM = env.TELEGRAM_BOT_TOKEN;
  if (!OPENAI && env.OPENAI_API_KEY) OPENAI = env.OPENAI_API_KEY;
}

// ---------- نمایش ----------
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const ok   = (s) => console.log(`  ${C.green}✅${C.reset} ${s}`);
const bad  = (s) => console.log(`  ${C.red}❌${C.reset} ${s}`);
const warn = (s) => console.log(`  ${C.yellow}⚠️${C.reset}  ${s}`);
const info = (s) => console.log(`  ${C.dim}   ${s}${C.reset}`);
const head = (s) => console.log(`\n${C.bold}${C.cyan}${s}${C.reset}`);

const fixes = [];
function fix(text) { fixes.push(text); }

// ---------- ابزار شبکه با تایم‌اوت ----------
async function get(url, opts = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* نه JSON */ }
    return { status: r.status, ok: r.ok, json, text };
  } catch (e) {
    return { status: 0, ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally { clearTimeout(t); }
}

// ---------- شروع ----------
console.log(`\n${C.bold}${C.magenta}🔍 بررسی راه‌اندازی تیم پول‌ساز n8n${C.reset}`);
console.log(`${C.dim}   ${new Date().toLocaleString('fa-IR')}${C.reset}`);

(async () => {

  // ============ ۱) فایل‌های ورک‌فلو ============
  head('۱) فایل‌های ورک‌فلو');
  const squads = ['01-content-factory', '02-instagram-social', '03-telegram', '04-leads-sales', '05-money-ops', '06-dashboard-glue'];
  let totalFiles = 0;
  for (const s of squads) {
    const dir = path.join(TEAM_DIR, s);
    if (!fs.existsSync(dir)) { bad(`پوشهٔ ${s} پیدا نشد`); continue; }
    const jsons = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    totalFiles += jsons.length;
    ok(`${s}  —  ${jsons.length} فایل`);
  }
  if (totalFiles) info(`مجموع: ${totalFiles} ورک‌فلو آماده در ${TEAM_DIR}`);

  // ============ ۲) n8n ============
  head('۲) سرور n8n');
  const health = await get(`${N8N_URL}/healthz`);
  if (health.ok && /ok/i.test(health.text || '')) {
    ok(`n8n در ${N8N_URL} در حال اجراست`);
  } else if (health.status) {
    warn(`n8n جواب داد ولی وضعیت عجیب است (کد ${health.status}) — احتمالاً صفحهٔ ورود است`);
    info(`${N8N_URL} را در مرورگر باز کن و ببین وارد می‌شوی`);
  } else {
    bad(`n8n در ${N8N_URL} در دسترس نیست`);
    info(health.error === 'timeout' ? 'پاسخی نداد (تایم‌اوت)' : `خطا: ${health.error || 'ناشناخته'}`);
    fix('n8n اجرا نیست. در ویندوز فایل setup.bat را دوباره اجرا کن، یا در پوشهٔ نصب دستور npx n8n را بزن.');
  }

  // ============ ۳) تلگرام ============
  head('۳) ربات تلگرام');
  if (!TELEGRAM) {
    warn('توکن ربات تلگرام پیدا نشد');
    info('اگر ربات ساخته‌ای، اینطور تست کن:');
    info('  node check.js --telegram=<توکن-از-BotFather>');
    fix('ربات تلگرام نساخته‌ای. برو در تلگرام سراغ @BotFather → بزن /newbot → اسم بده → توکن را بگیر.');
  } else {
    const shown = TELEGRAM.slice(0, 10) + '…';
    const me = await get(`https://api.telegram.org/bot${TELEGRAM}/getMe`);
    if (me.ok && me.json && me.json.ok) {
      const b = me.json.result;
      ok(`ربات سالم است: @${b.username}  (${b.first_name})`);
      info(`توکن: ${shown}`);

      const wh = await get(`https://api.telegram.org/bot${TELEGRAM}/getWebhookInfo`);
      if (wh.ok && wh.json && wh.json.ok) {
        const w = wh.json.result;
        if (w.url) {
          ok(`وبهوک ثبت شده: ${w.url}`);
          if (w.last_error_message) {
            bad(`آخرین خطای تلگرام: ${w.last_error_message}`);
            info(`تعداد خطا: ${w.last_error_date ? new Date(w.last_error_date * 1000).toLocaleString('fa-IR') : '—'}`);
            fix('وبهوک خطا می‌دهد: آدرس WEBHOOK_URL در n8n باید همان آدرسی باشد که تلگرام می‌بیند (HTTPS عمومی). و ورک‌فلو باید Active باشد.');
          } else {
            ok('هیچ خطای وبهوکی ثبت نشده — عالی');
          }
          if (w.pending_update_count > 0) warn(`${w.pending_update_count} پیام معطل مانده (n8n جواب نمی‌دهد؟)`);
        } else {
          warn('وبهوک ثبت نشده — یعنی هنوز ورک‌فلوی تلگرام را Active نکرده‌ای');
          fix('ورک‌فلو را در n8n باز کن و دکمهٔ Active (بالا-راست) را روشن کن. n8n خودش وبهوک را ثبت می‌کند.');
        }
      }
    } else if (me.status === 401 || (me.json && me.json.error_code === 401)) {
      bad('توکن ربات معتبر نیست (تلگرام گفت Unauthorized)');
      fix('توکن اشتباه است. در تلگرام @BotFather → /mybots → رباتت → API Token را دوباره بگیر.');
    } else {
      bad(`نتوانستم با تلگرام ارتباط بگیرم (${me.error || me.status})`);
      info('اگر در ایران هستی ممکن است api.telegram.org مستقیم در دسترس نباشد یا اینترنت قطع باشد.');
      fix('اگر اینترنت/فیلتر مشکل دارد، دسترسی به api.telegram.org را از سرور یا با ابزار مناسب برقرار کن.');
    }
  }

  // ============ ۴) OpenAI ============
  head('۴) کلید هوش مصنوعی (OpenAI یا سازگار)');
  if (!OPENAI) {
    warn('کلید OpenAI پیدا نشد (این کلید برای تولید محتوا لازم است)');
    fix('کلید OpenAI نداری؟ در n8n → Credentials → Add → OpenAI بساز. اگر دسترسی نداری، هر سرویس سازگار با OpenAI کار می‌کند — فقط فیلد Base URL را عوض کن.');
  } else {
    const base = (args.openaiBase || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const r = await get(`${base}/models`, { headers: { Authorization: `Bearer ${OPENAI}` } });
    if (r.ok) {
      const n = r.json && Array.isArray(r.json.data) ? r.json.data.length : 0;
      ok(`کلید کار می‌کند — ${n} مدل در دسترس (${base})`);
    } else if (r.status === 401) {
      bad('کلید معتبر نیست (۴۰۱)');
      fix('کلید OpenAI اشتباه یا منقضی است. در platform.openai.com یک کلید تازه بساز.');
    } else if (r.status === 429) {
      warn('کلید درست است ولی سهمیه/اعتبار تمام شده (۴۲۹)');
      fix('اعتبار حساب OpenAI را شارژ کن، یا از سرویس دیگری استفاده کن.');
    } else {
      warn(`نتوانستم کلید را بررسی کنم (${r.error || r.status})`);
      info(`اگر Base URL دیگری داری: node check.js --openai=... --openaiBase=https://...`);
    }
  }

  // ============ ۵) اینستاگرام (اختیاری) ============
  head('۵) اینستاگرام (اختیاری — بعداً هم می‌شود)');
  const igToken = args.instagram || process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!igToken) {
    info('اگر اینستاگرام را وصل نکرده‌ای، مشکلی نیست. با تلگرام شروع کن.');
    info('برای وصل کردنش: بخش ۴ فایل START-HERE.md را بخوان.');
  } else {
    const r = await get(`https://graph.facebook.com/v21.0/me?access_token=${igToken}`);
    if (r.ok && r.json && r.json.id) {
      ok(`توکن متا کار می‌کند (id: ${r.json.id})`);
      const pages = await get(`https://graph.facebook.com/v21.0/me/accounts?access_token=${igToken}`);
      if (pages.ok && pages.json && pages.json.data && pages.json.data.length) {
        ok(`${pages.json.data.length} صفحهٔ فیسبوک متصل پیدا شد`);
        for (const pg of pages.json.data.slice(0, 3)) info(`• ${pg.name}  (${pg.id})`);
      } else {
        warn('هیچ صفحهٔ فیسبوکی پیدا نشد — اینستاگرام بیزینس باید به یک صفحه وصل باشد');
      }
    } else {
      bad('توکن متا کار نمی‌کند');
      info('توکن متا معمولاً فقط ۱ ساعت عمر می‌کند!');
      fix('به توکن بلندمدت (۶۰ روزه) تبدیلش کن، وگرنه هر ساعت قطع می‌شود.');
    }
  }

  // ============ جمع‌بندی ============
  head('📋 جمع‌بندی و کارهای بعدی');
  if (!fixes.length) {
    console.log(`  ${C.green}${C.bold}🎉 همه چیز آماده است! به ربات تلگرام خودت پیام بده و ببین جواب می‌دهد.${C.reset}`);
  } else {
    console.log(`  ${C.yellow}${fixes.length} کار باقی مانده:${C.reset}\n`);
    fixes.forEach((f, i) => console.log(`  ${C.bold}${i + 1}.${C.reset} ${f}\n`));
  }

  console.log(`${C.dim}  ─────────────────────────────────────────${C.reset}`);
  console.log(`${C.dim}  راهنمای کامل گام‌به‌گام: n8n-money-team/START-HERE.md${C.reset}`);
  console.log(`${C.dim}  بررسی مجدد:  node check.js${C.reset}\n`);
})();
