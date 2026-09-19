/**
 * Agent Memory — builds compact context for LLM
 * Pulls: customer 360 (lastSeen, status, tags), last 10 messages, last 3 orders, last 3 leads, brand settings, product of interest
 * Keeps under ~1500 tokens, PII masked in logs, never leaks to prompt without need
 */
const crypto = require('crypto');

function maskForLog(str) {
  if (!str) return str;
  return String(str).slice(0, 2) + '***' + String(str).slice(-2);
}

async function buildAgentContext(prisma, { customerId, channel, externalMessageId, content }) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      identities: true,
      tags: { include: { tag: true } },
    },
  });
  if (!customer) return { customer: null, history: [], orders: [], leads: [], brand: {} };

  const [messages, orders, leads, brandSettings, promptRow] = await Promise.all([
    prisma.message.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.order.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 3, include: { items: { include: { product: true } } } }),
    prisma.lead.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 3 }),
    prisma.businessSetting.findMany({ where: { category: { in: ['brand', 'business', 'ai'] } } }).catch(() => []),
    prisma.promptTemplate.findFirst({ where: { key: 'agent.sales.reply', isActive: true }, orderBy: { version: 'desc' } }).catch(() => null),
  ]);

  const brand = {};
  for (const b of brandSettings) {
    try {
      const v = typeof b.value === 'string' ? JSON.parse(b.value) : b.value;
      brand[b.key] = v?.value ?? v;
    } catch (_) {
      brand[b.key] = b.value;
    }
  }
  // Fallbacks
  const brandName = brand['brand.name'] || brand['business.name'] || 'آرشیا مارکت';
  const brandTone = brand['ai.tone'] || 'صمیمی و حرفه‌ای، فارسی، کوتاه';
  const salesPolicy = brand['business.salesPolicy'] || 'پاسخ کوتاه، پیشنهاد محصول مرتبط، دعوت به خرید';

  // History as compact turns
  const history = messages.reverse().map(m => ({
    role: m.direction === 'INBOUND' ? 'user' : 'assistant',
    channel: m.channel,
    content: String(m.content).slice(0, 300),
    at: m.createdAt.toISOString(),
  }));

  // Orders compact
  const ordersCompact = orders.map(o => ({
    number: o.orderNumber,
    status: o.status,
    total: String(o.total),
    items: o.items.map(i => ({ name: i.product?.name, qty: i.quantity })).slice(0, 3),
  }));

  // Leads compact
  const leadsCompact = leads.map(l => ({ status: l.status, intent: l.intent, score: l.score }));

  const tags = (customer.tags || []).map(ct => ct.tag.name);
  const identities = (customer.identities || []).map(i => `${i.channel}:${i.externalId.slice(-6)}`);

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      phoneMasked: maskForLog(customer.phone),
      city: customer.city,
      status: customer.status,
      source: customer.source,
      tags,
      identities,
      lastSeenAt: customer.lastSeenAt,
    },
    customerName: customer.name || 'عزیز',
    brandName,
    brandTone,
    salesPolicy,
    productName: ordersCompact[0]?.items[0]?.name || leadsCompact[0]?.intent || null,
    history,
    orders: ordersCompact,
    leads: leadsCompact,
    channel,
    content: String(content).slice(0, 500),
    systemPromptTemplate: promptRow?.content || null,
    // For LLM system
    systemPrompt: null, // will be built by runner
  };
}

function buildSystemPrompt(context, extra) {
  if (context.systemPromptTemplate) return context.systemPromptTemplate;
  const brand = context.brandName || 'آرشیا مارکت';
  const tone = context.brandTone || 'صمیمی، حرفه‌ای، فارسی، کوتاه (حداکثر 2 جمله)';
  const policy = context.salesPolicy || 'هدف: کمک به تصمیم خرید، پیشنهاد محصول مرتبط، دعوت محترمانه';
  return `تو دستیار فروش هوشمند "${brand}" هستی.
لحن: ${tone}
قوانین: ${policy}
مشتری: ${context.customerName} (${context.customer?.status}, تگ‌ها: ${(context.customer?.tags||[]).join(',')||'بدون تگ'})
تاریخچه کوتاه: ${context.history.slice(-4).map(h=> `${h.role}: ${h.content.slice(0,80)}`).join(' | ')||'ندارد'}
سفارشات اخیر: ${context.orders.map(o=> `${o.number}(${o.status})`).join(', ')||'ندارد'}
وظیفه: به پیام کاربر پاسخ کوتاه و مفید بده، نیت را تشخیص بده (price_inquiry/stock_inquiry/purchase_intent/support/greeting/general)، ابزار پیشنهادی را بگو (inventory.check, order.create, customer.search)، و scoreDelta (0-30) برگردان.
خروجی JSON: {"reply":"متن فارسی کوتاه","intent":"...","entities":{"hasPriceInquiry":bool,...},"suggestedTools":["..."],"scoreDelta":number}
هرگز اطلاعات محرمانه فاش نکن، هرگز قیمت تخیلی نساز — اگر موجودی/قیمت دقیق می‌خواهی، suggestedTools را پر کن تا سیستم چک کند.`;
}

module.exports = { buildAgentContext, buildSystemPrompt, maskForLog };
