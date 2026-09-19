/**
 * Simple Queue + Cron — in-memory for single instance (professional: replace with BullMQ/Redis for scale)
 * Queues: agent.inbound (Telegram/Instagram/Website), followup.due, content.generate
 * Cron: every 60s check followUps, every 5min check scheduledContent
 */
const prisma = require('../prisma');

let isRunning = false;
let timers = [];
const q = []; // { id, type, payload, attempts, nextAt }

function enqueue(type, payload, opts = {}) {
  const id = `${type}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
  q.push({ id, type, payload, attempts: 0, nextAt: opts.delayMs ? Date.now() + opts.delayMs : Date.now(), maxAttempts: opts.maxAttempts || 3 });
  if (q.length > 1000) q.shift();
  console.log(JSON.stringify({ at: new Date().toISOString(), event: 'QUEUE_ENQUEUE', type, id }));
  return id;
}

function dequeueReady() {
  const now = Date.now();
  const idx = q.findIndex(j => j.nextAt <= now);
  if (idx === -1) return null;
  const [job] = q.splice(idx, 1);
  return job;
}

async function processAgentInbound(job, runner) {
  const { customerId, channel, messageId, content, requestId } = job.payload;
  try {
    const res = await runner({ customerId, channel, messageId, content, requestId, source: 'queue' });
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'QUEUE_DONE', type: job.type, id: job.id, intent: res?.intent }));
    return true;
  } catch (e) {
    console.warn(JSON.stringify({ at: new Date().toISOString(), event: 'QUEUE_FAIL', type: job.type, id: job.id, error: e.message.slice(0, 200) }));
    if (job.attempts < job.maxAttempts) {
      job.attempts++;
      job.nextAt = Date.now() + Math.pow(2, job.attempts) * 1000; // 2s,4s,8s
      q.push(job);
    } else {
      // Create human review for failed agent
      try {
        await prisma.humanReview.create({
          data: {
            type: 'AGENT_FAILED',
            status: 'PENDING',
            provider: channel,
            externalId: String(messageId || ''),
            payload: { content: String(content).slice(0, 500), error: e.message.slice(0, 300) },
            reason: `Agent failed after ${job.maxAttempts} attempts: ${e.message.slice(0, 150)}`,
            requestId: job.payload.requestId || null,
          },
        });
      } catch (_) {}
    }
    return false;
  }
}

let runnerFn = null;
async function workerLoop() {
  if (isRunning) return;
  isRunning = true;
  const job = dequeueReady();
  if (job) {
    if (job.type === 'agent.inbound' && runnerFn) {
      await processAgentInbound(job, runnerFn);
    } else if (job.type === 'followup.due') {
      // handled by cron directly
    }
    // continue fast
    isRunning = false;
    setImmediate(workerLoop);
  } else {
    isRunning = false;
  }
}

function startQueue(runner) {
  runnerFn = runner;
  // worker every 800ms
  const t1 = setInterval(workerLoop, 800);
  timers.push(t1);
  console.log('[QUEUE] started (in-memory, 800ms poll)');
  return () => stopQueue();
}
function stopQueue() {
  timers.forEach(clearInterval);
  timers = [];
  console.log('[QUEUE] stopped');
}

// --- Cron ---
let cronTimers = [];
function startCrons() {
  // FollowUp due every 60s
  const t2 = setInterval(async () => {
    try {
      const now = new Date();
      const due = await prisma.followUp.findMany({ where: { status: 'PENDING', scheduledAt: { lte: now } }, take: 10, include: { customer: true, lead: true } });
      for (const fu of due) {
        // Mark running, enqueue agent to generate reminder
        await prisma.followUp.update({ where: { id: fu.id }, data: { status: 'RUNNING' } }).catch(() => {});
        enqueue('agent.inbound', {
          customerId: fu.customerId,
          channel: 'SYSTEM',
          messageId: `followup-${fu.id}`,
          content: `یادآوری پیگیری: ${fu.reason || 'پیگیری'} برای لید ${fu.leadId || ''} ـ مشتری ${fu.customer?.name || ''}`,
          requestId: `cron-followup-${fu.id}`,
        });
        console.log(JSON.stringify({ at: new Date().toISOString(), event: 'CRON_FOLLOWUP_DUE', followUpId: fu.id, customerId: fu.customerId }));
      }
    } catch (e) {
      console.warn('[CRON_FOLLOWUP_ERROR]', e.message);
    }
  }, 60_000);
  cronTimers.push(t2);

  // Content generate every 5min check (if scheduledAt <= now and PENDING_APPROVAL? Actually for auto-draft 09:00/18:00, we check)
  const t3 = setInterval(async () => {
    try {
      const pending = await prisma.scheduledContent.findMany({ where: { status: 'PENDING_APPROVAL', scheduledAt: { lte: new Date() } }, take: 5 });
      if (pending.length) console.log(JSON.stringify({ at: new Date().toISOString(), event: 'CRON_CONTENT_PENDING', count: pending.length }));
      // Could auto-publish if BusinessSetting ai.autoPublish = true — for now just log
    } catch (e) {
      console.warn('[CRON_CONTENT_ERROR]', e.message);
    }
  }, 5 * 60_000);
  cronTimers.push(t3);

  // Inventory low alert every 15min
  const t4 = setInterval(async () => {
    try {
      const low = await prisma.inventory.findMany({ where: { quantity: { lte: 5 } }, include: { product: true }, take: 5 });
      if (low.length) {
        console.log(JSON.stringify({ at: new Date().toISOString(), event: 'CRON_INVENTORY_LOW', count: low.length, items: low.map(l => ({ sku: l.product.sku, qty: l.quantity })) }));
        // Could create HumanReview or Telegram alert
      }
    } catch (e) {}
  }, 15 * 60_000);
  cronTimers.push(t4);

  console.log('[CRON] started (followUp 60s, content 5m, inventory 15m)');
}

function stopCrons() {
  cronTimers.forEach(clearInterval);
  cronTimers = [];
}

function getQueueStats() {
  return { queued: q.length, types: q.reduce((a, j) => { a[j.type] = (a[j.type] || 0) + 1; return a; }, {}) };
}

module.exports = { enqueue, dequeueReady, startQueue, stopQueue, startCrons, stopCrons, getQueueStats, q };
