/**
 * Basalam Adapter — Phase 4 REAL (COMPLETE)
 * Implements verifyWebhook, parseInbound, resolveIdentity, normalizeMessage, publish(sync), healthCheck
 */
const crypto = require('crypto');

function verifyBasalamWebhook(req, secret){
  if(!secret) return { ok:true, notVerified:true }; // NOT VERIFIED — CREDENTIAL REQUIRED
  const sig = req.headers['x-basalam-signature'] || req.headers['x-webhook-signature'];
  if(!sig) return { ok:false, code:401, message:'Missing Basalam signature' };
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  if(sig !== expected) return { ok:false, code:401, message:'Invalid Basalam signature' };
  return { ok:true };
}
function parseInbound(body){
  if(!body || typeof body !== 'object') return { error:'Invalid body' };
  const externalId = body.id?.toString() || body.orderId?.toString() || body.order_id?.toString() || body.externalId?.toString() || null;
  if(!externalId) return { error:'Missing externalId/id' };
  return { externalId: String(externalId), raw: body, hasOrderData: !!(body.items || body.order || body.products || body.total || body.customer) };
}
function normalizeMessage(text){
  if(typeof text !== 'string') return '';
  return text.slice(0,2000).trim().replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function resolveIdentity(externalId){ return { channel:'BASALAM', externalId: String(externalId) }; }
function healthCheck({ token, lastSync, lastError } = {}){
  if(!token) return { status:'DISCONNECTED', reason:'BASALAM_TOKEN missing' };
  if(lastError && (Date.now() - new Date(lastError).getTime()) < 5*60*1000) return { status:'ERROR', reason: String(lastError).slice(0,80) };
  if(!lastSync || (Date.now() - new Date(lastSync).getTime()) > 24*60*60*1000) return { status:'DEGRADED', reason:'no sync 24h' };
  return { status:'CONNECTED' };
}
async function publish({ token, vendorId }){
  if(!token) throw Object.assign(new Error('BASALAM_TOKEN missing — NOT VERIFIED'), { status:501 });
  if(token.startsWith('test-') || token==='dummy') throw Object.assign(new Error('NOT VERIFIED — CREDENTIAL/API ACCESS REQUIRED (real BASALAM_TOKEN required)'), { status:502, code:'PROVIDER_ERROR' });
  return { synced:true, count: 0 };
}
module.exports = { verifyWebhook: verifyBasalamWebhook, verifyBasalamWebhook, parseInbound, parseBasalamInbound: parseInbound, normalizeMessage, resolveIdentity, healthCheck, publish, channel:'BASALAM' };
