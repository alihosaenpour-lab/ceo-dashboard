#!/usr/bin/env node
/**
 * Mock ceo-dashboard API — دقیقاً همان قرارداد docs/INTEGRATION-API.md و docs/API-CRM.md
 * برای تست واقعی ورک‌فلوی n8n بدون نیاز به Postgres.
 *
 * شبیه‌سازی می‌کند:
 *  - وبهوک تلگرام (سکرت + idempotency + ساخت مشتری/پیام/لید)
 *  - ایجنت داخلی CRM که ۳ ثانیه بعد پاسخ را به‌عنوان پیام OUTBOUND ذخیره می‌کند
 *  - لاگین JWT، خواندن پیام‌ها، ارسال تلگرام، افزودن برچسب
 */
const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.MOCK_PORT || 3000);
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'test_secret_123';
const CEO_PHONE = process.env.CEO_PHONE || '09120000000';
const CEO_PASSWORD = process.env.CEO_PASSWORD || 'test1234';
const AGENT_DELAY_MS = Number(process.env.AGENT_DELAY_MS || 3000);
const LOG = process.env.MOCK_LOG || '/tmp/mock-crm-requests.jsonl';

const customers = new Map();     // customerId -> {id, name, phone, status}
const messages = [];             // {id, customerId, channel, direction, content, metadata, createdAt}
const seenUpdates = new Map();   // update_id -> response
const tagLog = [];
const sendLog = [];

let seq = 0;
const id = (p) => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}`;

function log(entry) {
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({ __raw: d }); } });
  });
}

/** ایجنت داخلی CRM: بعد از تأخیر، پاسخ فروش را ذخیره می‌کند (ولی ارسال نمی‌کند) */
function runInternalAgent(customerId, text) {
  setTimeout(() => {
    const t = String(text || '').toLowerCase();
    let reply;
    if (t.includes('قیمت') || t.includes('price') || t.includes('هزینه')) {
      reply = `سلام 🙂 ممنون از پیام شما. قیمت بستهٔ حرفه‌ای ما ۱۲٬۵۰۰٬۰۰۰ تومان است (شامل ۲۰ پست + ۸ ریلز + ۴ مقالهٔ سئو در ماه). اگر امروز تصمیم بگیرید، ۱۰٪ تخفیف اولین ماه را دارید. نام و شماره‌تان را بفرستید تا همین امروز شروع کنیم.`;
    } else if (t.includes('موجود') || t.includes('stock')) {
      reply = `سلام 🌱 بله موجود است. تعداد محدودی از این بسته در این ماه باقی مانده. بفرمایید کدام بسته را می‌خواهید تا برایتان رزرو کنم؟`;
    } else {
      reply = `سلام 👋 پیامتان رسید. ما در تولید محتوا، مدیریت شبکه‌های اجتماعی و جذب مشتری کمک می‌کنیم. برای اینکه دقیق راهنمایی کنم، بفرمایید دنبال چه خدمتی هستید (محتوا / اینستاگرام / جذب لید)؟`;
    }
    const m = {
      id: id('msg'), customerId, channel: 'TELEGRAM', direction: 'OUTBOUND',
      content: reply, text: reply, status: 'PROCESSED',
      metadata: { via: 'agent', intent: 'PRICE_INQUIRY', llmProvider: 'mock-deterministic' },
      createdAt: new Date().toISOString(),
    };
    messages.push(m);
    const c = customers.get(customerId);
    if (c) c.status = 'LEAD';
    log({ event: 'AGENT_REPLIED', customerId, messageId: m.id, chars: reply.length });
    console.log(`[agent] پاسخ برای ${customerId} ساخته شد (${reply.length} کاراکتر) — ولی ارسال نشد`);
  }, AGENT_DELAY_MS);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const body = await readBody(req);
  log({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), body,
        auth: req.headers.authorization ? 'Bearer …' : null,
        secret: req.headers['x-telegram-bot-api-secret-token'] || null });

  // ---------- POST /api/integrations/telegram/webhook ----------
  if (req.method === 'POST' && p === '/api/integrations/telegram/webhook') {
    const hdr = req.headers['x-telegram-bot-api-secret-token'];
    if (!hdr) return json(res, 401, { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Missing Telegram secret' } });
    if (hdr !== SECRET) return json(res, 401, { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid Telegram secret' } });

    const update_id = body.update_id;
    if (update_id === undefined || update_id === null) {
      return json(res, 400, { success: false, error: { code: 'INVALID_PAYLOAD', message: 'Missing update_id' } });
    }
    if (seenUpdates.has(String(update_id))) {
      return json(res, 200, { success: true, duplicate: true, requestId: 'req_' + seq });
    }

    const msg = body.message || body.edited_message || body.channel_post;
    if (!msg) {
      seenUpdates.set(String(update_id), { noMessage: true });
      return json(res, 200, { success: true, received: true, noMessage: true, requestId: 'req_' + seq });
    }

    const from = msg.from || msg.chat;
    const extId = String(from.id);
    let customer = [...customers.values()].find(c => c.externalId === extId);
    if (!customer) {
      customer = {
        id: id('cus'), externalId: extId, name: [from.first_name, from.last_name].filter(Boolean).join(' ') || 'کاربر تلگرام',
        phone: `0999${String(1000000 + customers.size).slice(-7)}`, status: 'NEW',
        notes: `ساخته شده از تلگرام - externalId ${extId} - username ${from.username || ''}`,
      };
      customers.set(customer.id, customer);
      log({ event: 'CUSTOMER_CREATED', customerId: customer.id, name: customer.name, source: 'TELEGRAM' });
    }

    const text = msg.text || msg.caption || (msg.photo ? '[photo]' : '[message]');
    messages.push({ id: id('msg'), customerId: customer.id, channel: 'TELEGRAM', direction: 'INBOUND',
                    content: text, text, status: 'RECEIVED', metadata: { update_id: String(update_id) },
                    createdAt: new Date().toISOString() });

    const t = String(text).toLowerCase();
    const hot = t.includes('قیمت') || t.includes('price') || t.includes('هزینه') ||
                t.includes('موجود') || t.includes('stock') || t.includes('موجودی') ||
                t.includes('محصول') || t.includes('خرید') || t.includes('سفارش') || t.includes('product');
    let leadId = null;
    if (hot) {
      leadId = id('lead');
      customer.status = 'LEAD';
      log({ event: 'LEAD_CREATED', customerId: customer.id, leadId, intent: text.slice(0, 60) });
    }

    runInternalAgent(customer.id, text);

    const payload = { success: true, received: true, customerId: customer.id,
                      messageId: messages[messages.length - 1].id, leadId, requestId: 'req_' + seq };
    seenUpdates.set(String(update_id), payload);
    console.log(`[crm] پیام از ${customer.name} دریافت شد → مشتری ${customer.id}${leadId ? ' + لید' : ''}`);
    return json(res, 200, payload);
  }

  // ---------- POST /api/auth/login ----------
  if (req.method === 'POST' && p === '/api/auth/login') {
    const phone = String(body.phone || '').replace(/\D/g, '').slice(-11);
    if (phone !== CEO_PHONE || String(body.password || '') !== CEO_PASSWORD) {
      return json(res, 401, { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'شماره یا رمز اشتباه است' } });
    }
    return json(res, 200, { ok: true, success: true, token: 'mock.jwt.token.' + Date.now().toString(36), role: 'CEO' });
  }

  // ---------- GET /api/customers/:id/messages ----------
  let m = p.match(/^\/api\/customers\/([^/]+)\/messages$/);
  if (req.method === 'GET' && m) {
    if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
      return json(res, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }
    const cid = m[1];
    const limit = Math.min(50, parseInt(url.searchParams.get('limit')) || 20);
    const list = messages.filter(x => x.customerId === cid)
                         .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                         .slice(0, limit);
    return json(res, 200, { success: true, messages: list, pagination: { page: 1, limit, total: list.length, pages: 1 } });
  }

  // ---------- POST /api/customers/:id/tags ----------
  m = p.match(/^\/api\/customers\/([^/]+)\/tags$/);
  if (req.method === 'POST' && m) {
    if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
      return json(res, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }
    tagLog.push({ customerId: m[1], name: body.name });
    console.log(`[crm] برچسب «${body.name}» روی مشتری ${m[1]} ثبت شد`);
    return json(res, 201, { success: true, tag: { id: id('tag'), name: body.name } });
  }

  // ---------- POST /api/integrations/telegram/send ----------
  if (req.method === 'POST' && p === '/api/integrations/telegram/send') {
    if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
      return json(res, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }
    if (!body.text) return json(res, 400, { success: false, error: { code: 'INVALID_INPUT', message: 'text لازم است' } });
    const providerMessageId = `tg_${Date.now().toString(36)}`;
    sendLog.push({ to: body.customerId || body.chatId, text: body.text, providerMessageId });
    console.log(`\n📤 پیام به مشتری ${body.customerId} در تلگرام ارسال شد:\n   "${String(body.text).slice(0, 90)}…"\n`);
    return json(res, 200, { success: true, sent: true, providerMessageId, message: { id: id('msg'), direction: 'OUTBOUND' } });
  }

  // ---------- GET /api/integrations/status ----------
  if (req.method === 'GET' && p === '/api/integrations/status') {
    return json(res, 200, { success: true, integrations: { telegram: { status: 'CONNECTED' } } });
  }

  // ---------- debug ----------
  if (req.method === 'GET' && p === '/__debug') {
    return json(res, 200, { customers: [...customers.values()], messages, tags: tagLog, sent: sendLog });
  }

  return json(res, 404, { success: false, error: { code: 'NOT_FOUND', message: p } });
});

fs.writeFileSync(LOG, '');
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🧪 Mock ceo-dashboard روی http://0.0.0.0:${PORT}`);
  console.log(`   secret=${SECRET}  ceo=${CEO_PHONE}/${CEO_PASSWORD}  agentDelay=${AGENT_DELAY_MS}ms`);
  console.log(`   log=${LOG}\n`);
});
