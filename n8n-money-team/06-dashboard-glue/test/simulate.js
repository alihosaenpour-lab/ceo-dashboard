#!/usr/bin/env node
/**
 * شبیه‌ساز موتور n8n — همان فایل ورک‌فلو را «واقعاً» اجرا می‌کند.
 *
 * چه چیزی واقعی است:
 *   • کد گره‌های Code عیناً با همان $input / $() اجرا می‌شود
 *   • expressionها با همان سینتکس n8n ارزیابی می‌شوند
 *   • درخواست‌های HTTP واقعاً به mock CRM زده می‌شوند
 *   • منطق شرط‌های IF، انتظار Wait و خروجی RespondToWebhook اجرا می‌شود
 */
const fs = require('fs');
const path = require('path');

const WF_PATH = process.env.WF || '/home/user/ceo-dashboard/n8n-money-team/06-dashboard-glue/01-telegram-to-crm-delivery.json';
const wf = JSON.parse(fs.readFileSync(WF_PATH, 'utf8'));

const byName = new Map(wf.nodes.map(n => [n.name, n]));
const outputs = new Map();          // nodeName -> items[]
const trace = [];

// ---------------- expression engine ----------------
function evalInCtx(code, ctx) {
  const fn = new Function('$json', '$', '$input', '$env', '$now',
    `"use strict"; return (${code});`);
  return fn(ctx.$json, ctx.$, ctx.$input, process.env, new Date());
}

function resolve(value, ctx) {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('=')) return value;
  const tpl = value.slice(1);
  const single = tpl.match(/^\{\{([\s\S]*)\}\}$/);
  if (single) return evalInCtx(single[1].trim(), ctx);
  return tpl.replace(/\{\{([\s\S]*?)\}\}/g, (_, code) => {
    const v = evalInCtx(code.trim(), ctx);
    return (v === null || v === undefined) ? '' : String(v);
  });
}

const dollar = (name) => {
  const items = outputs.get(name) || [];
  return {
    first: () => items[0],
    last: () => items[items.length - 1],
    all: () => items,
    item: (i = 0) => items[i],
  };
};

function runCode(jsCode, inputItems, node) {
  const $input = { all: () => inputItems, first: () => inputItems[0], last: () => inputItems[inputItems.length - 1] };
  const fn = new Function('$input', '$', '$json', '$env',
    `"use strict";\n${jsCode}`);
  const res = fn($input, dollar, inputItems[0] ? inputItems[0].json : {}, process.env);
  if (!Array.isArray(res)) throw new Error(`گرهٔ Code باید آرایه برگرداند (${node.name})`);
  return res.map(r => (r && r.json !== undefined ? r : { json: r }));
}

// ---------------- node executors ----------------
async function execHttp(node, items) {
  const out = [];
  for (const item of items) {
    const p = node.parameters || {};
    const ctx = { $json: item.json, $: dollar, $input: { all: () => items } };
    const url = resolve(p.url, ctx);
    const method = (p.method || 'GET').toUpperCase();
    const headers = {};
    if (p.sendHeaders && p.headerParameters) {
      for (const h of p.headerParameters.parameters || []) headers[h.name] = String(resolve(h.value, ctx));
    }
    let body;
    if (p.sendBody && p.specifyBody === 'json') body = String(resolve(p.jsonBody, ctx));
    if (p.sendQuery && p.queryParameters) {
      const qs = new URLSearchParams();
      for (const q of p.queryParameters.parameters || []) qs.append(q.name, String(resolve(q.value, ctx)));
      const sep = url.includes('?') ? '&' : '?';
      const finalUrl = url + sep + qs.toString();
      out.push(await doFetch(finalUrl, method, headers, body, p, node));
      continue;
    }
    out.push(await doFetch(url, method, headers, body, p, node));
  }
  return out;
}

async function doFetch(url, method, headers, body, p, node) {
  const opts = { method, headers };
  if (body !== undefined) opts.body = body;
  if (!headers['Content-Type'] && body) headers['Content-Type'] = 'application/json';
  let statusCode = 0, rawBody = '', respHeaders = {};
  try {
    const r = await fetch(url, opts);
    statusCode = r.status;
    rawBody = await r.text();
    r.headers.forEach((v, k) => { respHeaders[k] = v; });
  } catch (e) {
    rawBody = JSON.stringify({ error: e.message });
    statusCode = 0;
  }
  const neverError = !!(p.options && p.options.response && p.options.response.response && p.options.response.response.neverError);
  const fullResponse = !!(p.options && p.options.response && p.options.response.response && p.options.response.response.fullResponse);

  trace.push(`   ↳ ${node.name} → ${method} ${url.replace(/^https?:\/\/[^/]+/, '')} ⇒ ${statusCode}`);
  if (statusCode === 0 && !neverError) throw new Error(`${node.name}: اتصال برقرار نشد (${url})`);
  if (statusCode >= 400 && !neverError) throw new Error(`${node.name}: HTTP ${statusCode} — ${rawBody.slice(0, 200)}`);

  let parsed = null;
  try { parsed = JSON.parse(rawBody); } catch (e) { parsed = rawBody; }
  return { json: fullResponse ? { body: parsed, headers: respHeaders, statusCode } : parsed };
}

function ifBranch(node, item) {
  const c = node.parameters.conditions;
  const ctx = { $json: item.json, $: dollar };
  const left = resolve(c.conditions[0].leftValue, ctx);
  const ops = c.conditions[0].operator;
  let truthy;
  if (ops.operation === 'true') truthy = Boolean(left);
  else if (ops.operation === 'false') truthy = !left;
  else if (ops.operation === 'equals') truthy = String(left) === String(resolve(c.conditions[0].rightValue, ctx));
  else if (ops.operation === 'notExists') truthy = left === undefined || left === null || left === '';
  else truthy = Boolean(left);
  return truthy ? 0 : 1;
}

// ---------------- walker ----------------
async function walk(nodeName, items, skipCheck) {
  if (!items || !items.length || skipCheck) return;
  const node = byName.get(nodeName);
  if (!node) throw new Error('گره پیدا نشد: ' + nodeName);
  const t = node.type.split('.').pop();

  if (t === 'stickyNote') return;

  let nextItems = [];

  if (t === 'code') {
    nextItems = runCode(node.parameters.jsCode, items, node);
    trace.push(`   • Code ${node.name} → ${nextItems.length} آیتم`);
  } else if (t === 'httpRequest') {
    nextItems = await execHttp(node, items);
  } else if (t === 'if') {
    const branch = ifBranch(node, items[0]);
    trace.push(`   • IF ${node.name} → شاخهٔ ${branch === 0 ? 'درست (true)' : 'نادرست (false)'}`);
    const conns = wf.connections[node.name]?.main?.[branch] || [];
    outputs.set(node.name, items);
    for (const c of conns) {
      const r = await walk(c.node, items);
      if (r && r.statusCode) return r;
    }
    return;
  } else if (t === 'wait') {
    const ms = (Number(node.parameters.amount) || 0) * (node.parameters.unit === 'minutes' ? 60000 : 1000);
    trace.push(`   • Wait ${node.name} → ${node.parameters.amount} ${node.parameters.unit || 'seconds'}`);
    await new Promise(r => setTimeout(r, ms));
    nextItems = items;
  } else if (t === 'respondWith') {
    const ctx = { $json: items[0].json, $: dollar };
    const bodyRaw = resolve(node.parameters.responseBody, ctx);
    let body = bodyRaw;
    try { body = JSON.parse(bodyRaw); } catch (e) { /* keep string */ }
    trace.push(`   • Respond ${node.name} → HTTP ${node.parameters.options.responseCode}`);
    return { statusCode: node.parameters.options.responseCode, body };
  } else {
    nextItems = items;
  }

  outputs.set(node.name, nextItems);
  const conns = wf.connections[node.name]?.main?.[0] || [];
  let respondResult = null;
  for (const c of conns) {
    const r = await walk(c.node, nextItems);
    if (r && r.statusCode) respondResult = r;
  }
  return respondResult;
}

async function callWebhook(body) {
  outputs.clear();
  trace.length = 0;
  const webhookNode = wf.nodes.find(n => n.type.endsWith('.webhook'));
  const item = {
    json: {
      headers: { 'content-type': 'application/json' },
      params: {}, query: {},
      body,
      webhookUrl: 'http://localhost:5678/webhook/' + webhookNode.parameters.path,
      executionMode: 'production',
    },
  };
  trace.push(`▶ ${webhookNode.name} ← POST /webhook/${webhookNode.parameters.path}`);
  return await walk(webhookNode.name, [item]);
}

module.exports = { callWebhook, getTrace: () => trace.slice() };

// ---------------- scenarios ----------------
if (require.main === module) {
  const scenarios = [
    { name: '۱) استعلام قیمت (مسیر کامل)', body: {
        update_id: 900001,
        message: { message_id: 55, from: { id: 700123456, is_bot: false, first_name: 'مریم', last_name: 'رضایی', username: 'maryam_r' },
        chat: { id: 700123456, type: 'private' }, text: 'سلام، قیمت بسته تولید محتوا چنده؟' } } },
    { name: '۲) همان آپدیت تکراری', body: {
        update_id: 900001,
        message: { message_id: 55, from: { id: 700123456, is_bot: false, first_name: 'مریم' },
        chat: { id: 700123456, type: 'private' }, text: 'سلام، قیمت بسته تولید محتوا چنده؟' } } },
    { name: '۳) پست خودِ کانال (نباید مشتری شود)', body: {
        update_id: 900002,
        channel_post: { message_id: 7, chat: { id: -1009999, title: 'کانال من', type: 'channel' }, text: 'تخفیف ویژه این هفته!' } } },
    { name: '۴) سؤال موجودی از مشتری جدید', body: {
        update_id: 900003,
        message: { message_id: 56, from: { id: 700777888, is_bot: false, first_name: 'حسین' },
        chat: { id: 700777888, type: 'private' }, text: 'سلام این بسته موجوده؟' } } },
  ];

  (async () => {
    let pass = 0, fail = 0;
    for (const s of scenarios) {
      console.log('\n' + '═'.repeat(78));
      console.log('🧪 سناریو ' + s.name);
      let result;
      try {
        result = await callWebhook(s.body);
      } catch (e) {
        console.log('   ✗ خطای اجرا:', e.message);
        fail++; continue;
      }
      for (const l of module.exports.getTrace()) console.log(l);
      console.log('   پاسخ نهایی:', JSON.stringify(result && result.body));
      const ok = result && result.statusCode;
      console.log(ok ? '   ✓ ورک‌فلو پاسخ داد' : '   ✗ بدون پاسخ!');
      ok ? pass++ : fail++;
    }
    console.log('\n' + '═'.repeat(78));
    console.log(`نتیجه: ${pass} سناریو موفق، ${fail} ناموفق`);
    process.exit(fail ? 1 : 0);
  })();
}
