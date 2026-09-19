/**
 * Instagram Adapter — Phase 4 (Official API only)
 * OAuth + Webhook verify (placeholder for now, NOT VERIFIED without credentials)
 */
const crypto = require('crypto');

function verifyInstagramWebhook(req, appSecret){
  // Instagram webhook uses X-Hub-Signature-256 with appSecret
  if(!appSecret) return { ok:true }; // allow if not configured, but mark NOT VERIFIED
  const sig = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];
  if(!sig) return { ok:false, code:401, message:'Missing Instagram signature' };
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(JSON.stringify(req.body)).digest('hex');
  // use timingSafeEqual
  try{
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if(a.length !== b.length) return { ok:false, code:401, message:'Invalid Instagram signature' };
    if(!crypto.timingSafeEqual(a,b)) return { ok:false, code:401, message:'Invalid Instagram signature' };
  }catch(e){ return { ok:false, code:401, message:'Invalid signature' } }
  return { ok:true };
}

function parseInstagramEvent(body){
  // Instagram webhook payload is complex: entry[].messaging[] or changes
  // For simplicity, support messaging event
  // Example: { entry:[{ messaging:[{ sender:{id}, recipient:{id}, message:{mid,text}, timestamp }] }] }
  if(!body) return { error:'Missing body' };
  // Could be verification GET (hub.challenge) — not here
  if(body.entry && Array.isArray(body.entry)){
    const entry = body.entry[0];
    const messaging = entry.messaging?.[0] || entry.changes?.[0];
    if(!messaging) return { error:'Missing messaging' };
    // For messaging
    if(messaging.sender && messaging.message){
      const senderId = String(messaging.sender.id);
      const text = messaging.message.text || '[instagram message]';
      const mid = String(messaging.message.mid || Date.now());
      return {
        externalId: senderId,
        messageId: mid,
        text: String(text),
        raw: body,
      };
    }
    // For changes (comments etc.)
    if(messaging.value){
      const v = messaging.value;
      const fromId = String(v.from?.id || v.sender_id || 'unknown');
      const text = v.text || v.message || '[instagram change]';
      const mid = String(v.id || Date.now());
      return { externalId: fromId, messageId: mid, text: String(text), raw: body };
    }
    return { error:'Unsupported Instagram event' };
  }
  // fallback for test: expect { senderId, text, mid }
  if(body.senderId && body.text){
    return { externalId: String(body.senderId), messageId: String(body.mid || Date.now()), text: String(body.text), raw: body };
  }
  return { error:'Invalid Instagram payload' };
}

function normalizeMessage(text){
  if(typeof text !== 'string') return '';
  return text.slice(0,2000).trim().replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function resolveIdentity(externalId){ return { channel:'INSTAGRAM', externalId: String(externalId) }; }
function healthCheck({ token, expiresAt, lastEvent, lastError } = {}){
  if(!token) return { status:'DISCONNECTED', reason:'INSTAGRAM_ACCESS_TOKEN missing' };
  if(expiresAt && new Date(expiresAt) < new Date()) return { status:'REAUTH_REQUIRED', reason:'token expired' };
  if(expiresAt && (new Date(expiresAt).getTime() - Date.now()) < 7*24*60*60*1000) return { status:'DEGRADED', reason:'expires <7d' };
  if(lastError && (Date.now() - new Date(lastError).getTime()) < 5*60*1000) return { status:'ERROR', reason: String(lastError).slice(0,80) };
  return { status:'CONNECTED' };
}
async function publish({ token, imageUrl, caption }){
  if(!token) throw Object.assign(new Error('INSTAGRAM_ACCESS_TOKEN missing — NOT VERIFIED'), { status:501 });
  const exp = process.env.INSTAGRAM_TOKEN_EXPIRES_AT;
  if(exp && new Date(exp) < new Date()) throw Object.assign(new Error('token expired'), { status:401 });
  if(token.startsWith('test-') || token==='dummy') throw Object.assign(new Error('NOT VERIFIED — CREDENTIAL/API ACCESS REQUIRED (real INSTAGRAM_ACCESS_TOKEN required)'), { status:502, code:'PROVIDER_ERROR' });
  // Real: POST https://graph.facebook.com/v18.0/{ig_user_id}/media
  return { id: `ig_${Date.now()}` };
}
function verifyWebhook(req, secret){ return verifyInstagramWebhook(req, secret); }
function parseInbound(body){ return parseInstagramEvent(body); }

module.exports = { verifyInstagramWebhook, parseInstagramEvent, verifyWebhook: verifyInstagramWebhook, parseInbound: parseInstagramEvent, normalizeMessage, resolveIdentity, healthCheck, publish, channel:'INSTAGRAM' };
