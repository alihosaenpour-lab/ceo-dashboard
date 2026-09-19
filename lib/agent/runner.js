/**
 * Agent Runner — The Brain
 * Flow: load memory → call LLM (system+user) → parse intent → execute suggested tools (inventory.check etc) → generate final reply → persist outbound + timeline + audit + metrics
 * Professional: RequestID throughout, PII masked in logs, fallback mock, never leaks DB, tool sandbox
 */
const prisma = require('../prisma');
const { callLLM } = require('./llm');
const { buildAgentContext, buildSystemPrompt } = require('./memory');
const { executeTool } = require('./toolsExecutor');
const pipeline = require('../integrations/pipeline');

async function runAgent({ customerId, channel, messageId, content, requestId, source = 'webhook', actorUserId = null, ip = null }) {
  const start = Date.now();
  const rid = requestId || `agent-${Date.now()}`;

  // 1) Build context
  const ctx = await buildAgentContext(prisma, { customerId, channel, externalMessageId: messageId, content });
  const system = buildSystemPrompt(ctx);
  const user = `کانال: ${channel}\nپیام کاربر: ${content}\nمشتری: ${ctx.customerName} (${ctx.customer?.status})\nسابقه: ${ctx.history.slice(-3).map(h=> h.content.slice(0,60)).join(' | ')||'ندارد'}`;

  // 2) Call LLM (with fallback mock)
  const llmRes = await callLLM({ prisma, system, user, context: ctx, tools: null });
  const reply = llmRes.reply || 'ممنون از پیام شما!';
  const intent = llmRes.intent || 'general';
  const entities = llmRes.entities || {};
  const suggestedTools = llmRes.suggestedTools || [];

  // 3) Execute suggested tools (if any) — e.g., inventory.check
  const toolResults = [];
  for (const tName of suggestedTools.slice(0, 3)) {
    try {
      let args = {};
      // Heuristic args: if inventory.check and we have product hint
      if (tName === 'inventory.check') {
        // Try to infer product from content or last order
        const titleHint = content.split(' ').find(w => w.length > 3) || ctx.productName;
        if (titleHint) args.title = String(titleHint).slice(0, 40);
      } else if (tName === 'customer.search') {
        args.query = content.slice(0, 20);
      } else if (tName === 'order.get') {
        // skip if no orderId
        continue;
      }
      const tr = await executeTool(tName, args, { actorUserId, requestId: rid, ip, channel, customerId });
      toolResults.push({ tool: tName, success: true, result: tr.result });
    } catch (e) {
      toolResults.push({ tool: tName, success: false, error: e.message.slice(0, 150) });
    }
  }

  // 4) Refine reply with tool data (if inventory low, add that)
  let finalReply = reply;
  const invCheck = toolResults.find(r => r.tool === 'inventory.check');
  if (invCheck && invCheck.success && invCheck.result) {
    const r = invCheck.result;
    if (r.found === false) finalReply += '\n(محصول دقیق پیدا نشد — همکاران بررسی می‌کنند)';
    else if (r.status === 'OUT_OF_STOCK') finalReply += ` — متأسفانه ${r.product.name} ناموجود است. جایگزین پیشنهاد کنم؟`;
    else if (r.status === 'LOW') finalReply += ` — ${r.product.name} فقط ${r.inventory.quantity} عدد مانده.`;
  }

  // 5) Lead intent handling — create/update lead if purchase/price
  let leadId = null;
  if (['price_inquiry', 'purchase_intent', 'stock_inquiry'].includes(intent) || entities.hasPriceInquiry || entities.hasProductInquiry) {
    try {
      const score = typeof llmRes.scoreDelta === 'number' ? llmRes.scoreDelta : (intent === 'purchase_intent' ? 30 : 15);
      // Check recent duplicate
      const dup = await prisma.lead.findFirst({ where: { customerId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }, orderBy: { createdAt: 'desc' } });
      if (!dup || dup.intent !== content.slice(0, 100)) {
        const lead = await prisma.lead.create({
          data: {
            customerId,
            intent: String(content).slice(0, 200),
            source: channel === 'TELEGRAM' ? 'TELEGRAM' : channel === 'INSTAGRAM' ? 'INSTAGRAM' : channel === 'WEBSITE' ? 'WEBSITE' : 'MANUAL',
            status: 'NEW',
            score,
            assignedToId: actorUserId,
          },
        });
        leadId = lead.id;
        await prisma.customer.update({ where: { id: customerId }, data: { status: 'LEAD', lastSeenAt: new Date() } });
        await prisma.customerTimeline.create({ data: { customerId, eventType: 'LEAD_CREATED_BY_AGENT', title: `لید ${intent} توسط ایجنت`, description: content.slice(0, 100), metadata: { leadId, intent, score, llmProvider: llmRes.provider } } });
        // Auto followUp 2h later
        await prisma.followUp.create({
          data: { customerId, leadId, type: 'MESSAGE', scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000), reason: `پیگیری لید ${intent}`, assignedToId: actorUserId },
        }).catch(() => {});
      } else {
        leadId = dup.id;
        // Ensure at least one pending followUp exists for this lead — create if missing (fixes pipeline lead without followUp)
        try{
          const existingFU = await prisma.followUp.findFirst({ where:{ leadId: dup.id, status:'PENDING' }});
          if(!existingFU){
            await prisma.followUp.create({
              data:{ customerId, leadId: dup.id, type:'MESSAGE', scheduledAt: new Date(Date.now()+2*60*60*1000), reason:`پیگیری لید ${intent} (auto bổ sung)`, assignedToId: actorUserId }
            });
            await prisma.customerTimeline.create({ data:{ customerId, eventType:'FOLLOWUP_CREATED_BY_AGENT', title:'پیگیری تکمیلی', description:`برای لید ${dup.id.slice(-6)}`, metadata:{ leadId:dup.id, intent } } }).catch(()=>{});
          }
        }catch(_){}
      }
    } catch (e) {
      console.warn('[AGENT_LEAD_ERROR]', e.message);
    }
  }

  // 6) Persist agent reply as outbound message (for memory) — channel same but direction OUTBOUND, status PROCESSED
  let outboundId = null;
  try {
    const out = await prisma.message.create({
      data: {
        customerId,
        channel: channel === 'SYSTEM' ? 'TELEGRAM' : channel, // fallback
        direction: 'OUTBOUND',
        content: finalReply.slice(0, 2000),
        text: finalReply.slice(0, 2000),
        status: 'PROCESSED',
        metadata: { via: 'agent', intent, llmProvider: llmRes.provider, model: llmRes.model, toolResults, requestId: rid, source },
      },
    });
    outboundId = out.id;
    await prisma.customerTimeline.create({
      data: { customerId, eventType: 'AGENT_REPLIED', title: `ایجنت پاسخ داد (${intent})`, description: finalReply.slice(0, 120), metadata: { messageId: out.id, intent, provider: llmRes.provider }, actorId: actorUserId },
    });
  } catch (e) {
    console.warn('[AGENT_OUTBOUND_ERROR]', e.message);
  }

  // 7) Audit + metrics
  const latency = Date.now() - start;
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'AGENT_RUN',
        entityType: 'Agent',
        entityId: customerId,
        ip,
        metadata: {
          requestId: rid,
          channel,
          intent,
          llmProvider: llmRes.provider,
          model: llmRes.model,
          latencyMs: latency,
          toolCount: toolResults.length,
          inboundMessageId: String(messageId || ''),
          outboundMessageId: outboundId ? String(outboundId) : null,
          leadId,
          hash: require('./llm').hashPrompt(content).slice(0, 8),
        },
      },
    });
  } catch (_) {}

  console.log(JSON.stringify({ at: new Date().toISOString(), event: 'AGENT_RUN', requestId: rid, channel, customerId: String(customerId).slice(-6), intent, provider: llmRes.provider, latencyMs: latency, leadId: leadId ? String(leadId).slice(-6) : null }));

  return {
    success: true,
    intent,
    reply: finalReply,
    rawReply: reply,
    entities,
    toolResults,
    leadId,
    outboundId,
    latencyMs: latency,
    llm: { provider: llmRes.provider, model: llmRes.model, usage: llmRes.usage },
    requestId: rid,
  };
}

// Convenience: run for inbound messageId (lookup)
async function runForMessage(messageId) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, include: { customer: true } });
  if (!msg) throw new Error('Message not found');
  return runAgent({ customerId: msg.customerId, channel: msg.channel, messageId: msg.id, content: msg.content, requestId: `msg-${messageId}` });
}

module.exports = { runAgent, runForMessage };
