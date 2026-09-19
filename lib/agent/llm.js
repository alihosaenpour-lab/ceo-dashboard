/**
 * LLM Provider — Professional abstraction for Agent Brain
 * Supports: OpenAI, Anthropic, Mock (deterministic fallback)
 * Uses BusinessSetting/Integration credentials if env missing
 * Never logs prompt content with PII — only hashes
 */
const crypto = require('crypto');

async function getLLMConfig(prisma) {
  // Try env first, then DB BusinessSetting
  let provider = process.env.LLM_PROVIDER || process.env.OPENAI_PROVIDER || 'mock';
  let apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY || null;
  let model = process.env.LLM_MODEL || 'gpt-4o-mini';
  let baseUrl = process.env.LLM_BASE_URL || null;

  // Fallback to DB if prisma provided
  if (prisma && !apiKey) {
    try {
      const row = await prisma.businessSetting.findUnique({ where: { key: 'ai.llm' } });
      if (row && row.value) {
        const v = row.value;
        provider = v.provider || provider;
        apiKey = v.apiKey || v.api_key || apiKey;
        model = v.model || model;
        baseUrl = v.baseUrl || v.base_url || baseUrl;
      }
    } catch (_) {}
    // Also check Integration with provider OPENAI
    try {
      const integ = await prisma.integration.findUnique({ where: { provider: 'OPENAI' } });
      if (integ && integ.credentialsEncrypted) {
        const { decrypt } = require('../encryption');
        const creds = decrypt(integ.credentialsEncrypted);
        if (creds && creds.apiKey) {
          provider = 'openai';
          apiKey = creds.apiKey;
          model = creds.model || model;
        }
      }
    } catch (_) {}
  }

  // Auto-detect from key prefix
  if (apiKey && apiKey.startsWith('sk-ant-')) provider = 'anthropic';
  else if (apiKey && apiKey.startsWith('sk-')) provider = 'openai';

  if (!apiKey) provider = 'mock';
  return { provider, apiKey, model, baseUrl };
}

function hashPrompt(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, 12);
}

// --- Mock LLM — deterministic, professional, no hallucination ---
function mockLLM({ system, user, context }) {
  const text = (user || '').toLowerCase();
  const ctx = context || {};
  // Intent detection — deterministic
  const isPrice = /قیمت|price|هزینه|چند/.test(text);
  const isStock = /موجود|stock|انبار|موجودی/.test(text);
  const isOrder = /سفارش|خرید|order|سبد/.test(text);
  const isSupport = /پشتیبانی|مرجوع|خراب|آسیب|support|complain/.test(text);
  const isGreeting = /سلام|hello|hi|درود/.test(text);

  let reply = '';
  let intent = 'general';
  let tools = [];
  let scoreDelta = 0;

  if (isPrice) {
    intent = 'price_inquiry';
    reply = `سلام ${ctx.customerName || 'عزیز'}! قیمت محصول مورد نظر ${isStock ? 'به‌روز و موجود است' : ''} — برای قیمت دقیق بفرمایید کدام محصول مد نظرتان است؟ محصول و تعداد را بگویید تا فاکتور بسازم.`;
    tools = ['customer.search', 'inventory.check'];
    scoreDelta = 20;
  } else if (isOrder) {
    intent = 'purchase_intent';
    reply = `عالیه! سفارش شما را ثبت می‌کنم — لطفاً محصول و تعداد را بفرمایید تا موجودی را چک و فاکتور ایجاد کنم.`;
    tools = ['inventory.check', 'order.create'];
    scoreDelta = 30;
  } else if (isStock) {
    intent = 'stock_inquiry';
    reply = `موجودی را همین الان چک کردم — ${ctx.productName ? `محصول ${ctx.productName} موجود است` : 'موجودی محصولات به‌روز است'} — بفرمایید کدام محصول را می‌خواهید؟`;
    tools = ['inventory.check'];
    scoreDelta = 10;
  } else if (isSupport) {
    intent = 'support';
    reply = `متأسفم که مشکلی پیش آمده — لطفاً شماره سفارش و عکس محصول را بفرستید تا تیم پشتیبانی فوراً بررسی کند و تا 24 ساعت پاسخ دهیم.`;
    tools = ['order.get'];
    scoreDelta = 5;
  } else if (isGreeting) {
    intent = 'greeting';
    reply = `سلام ${ctx.customerName || 'عزیز'}! به آرشیا مارکت خوش آمدید 🌟 چطور می‌تونم کمکتون کنم؟ (قیمت، موجودی، سفارش، پشتیبانی)`;
  } else {
    reply = `ممنون از پیام شما! ${ctx.brandName || 'آرشیا مارکت'} در خدمت شماست — بفرمایید نیازتان چیست؟ (سفارش، قیمت، موجودی، پشتیبانی)`;
  }

  // Professional mock also returns structured JSON like real LLM would
  return {
    provider: 'mock',
    model: 'mock-deterministic-v1',
    reply,
    intent,
    entities: {
      hasPriceInquiry: isPrice,
      hasStockInquiry: isStock,
      hasProductInquiry: isOrder || isPrice,
      isSupport,
    },
    suggestedTools: tools,
    scoreDelta,
    usage: { promptTokens: Math.ceil((system + user).length / 4), completionTokens: Math.ceil(reply.length / 4) },
    latencyMs: 12,
    raw: { mock: true, hash: hashPrompt(user) },
  };
}

// --- OpenAI Chat Completions ---
async function callOpenAI({ apiKey, model, baseUrl, system, user, tools }) {
  const url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions';
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_tokens: 600,
  };
  // Tool definitions if provided (optional)
  if (tools && tools.length) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } },
    }));
    body.tool_choice = 'auto';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`OpenAI ${res.status}: ${txt.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content || '';
  // Try to parse JSON if model returned structured
  let parsed = null;
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch (_) {}
  return {
    provider: 'openai',
    model,
    reply: parsed?.reply || content,
    intent: parsed?.intent || 'general',
    entities: parsed?.entities || {},
    suggestedTools: parsed?.suggestedTools || [],
    scoreDelta: parsed?.scoreDelta || 0,
    usage: data.usage || {},
    latencyMs: null,
    raw: data,
  };
}

// --- Anthropic ---
async function callAnthropic({ apiKey, model, system, user }) {
  const url = 'https://api.anthropic.com/v1/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-3-haiku-20240307',
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Anthropic ${res.status}: ${txt.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const content = data.content?.[0]?.text || '';
  let parsed = null;
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch (_) {}
  return {
    provider: 'anthropic',
    model,
    reply: parsed?.reply || content,
    intent: parsed?.intent || 'general',
    entities: parsed?.entities || {},
    suggestedTools: parsed?.suggestedTools || [],
    scoreDelta: parsed?.scoreDelta || 0,
    usage: data.usage || {},
    raw: data,
  };
}

async function callLLM({ prisma, system, user, context, tools }) {
  const cfg = await getLLMConfig(prisma);
  const start = Date.now();
  let result;
  try {
    if (cfg.provider === 'openai') {
      result = await callOpenAI({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl, system, user, tools });
    } else if (cfg.provider === 'anthropic') {
      result = await callAnthropic({ apiKey: cfg.apiKey, model: cfg.model, system, user });
    } else {
      result = mockLLM({ system, user, context });
    }
    result.latencyMs = result.latencyMs || Date.now() - start;
    result.config = { provider: cfg.provider, model: cfg.model, hash: hashPrompt(system + user) };
    return result;
  } catch (e) {
    // Fallback to mock on provider failure — never break automation (DEGRADED)
    console.warn('[LLM_FALLBACK_MOCK]', e.message);
    const mock = mockLLM({ system, user, context });
    mock.fallbackFrom = cfg.provider;
    mock.fallbackError = e.message.slice(0, 200);
    mock.latencyMs = Date.now() - start;
    return mock;
  }
}

module.exports = { callLLM, getLLMConfig, mockLLM, hashPrompt };
