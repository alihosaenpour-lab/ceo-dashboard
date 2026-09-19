/**
 * Website Adapter — Phase 4
 * verify, parse, normalize, resolveIdentity, healthCheck
 */
const { z } = require('zod');

const websiteSchema = z.object({
  sessionId: z.string().min(1).max(100).optional(),
  customerId: z.string().optional(),
  name: z.string().max(100).optional(),
  phone: z.string().min(10).max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  message: z.string().min(1).max(2000),
  text: z.string().max(2000).optional(),
  metadata: z.any().optional(),
});

function verifyWebhook(){ return { ok:true }; } // public but zod-validated, rateLimited
function parseInbound(body){
  const parsed = websiteSchema.safeParse(body);
  if(!parsed.success) return { error: parsed.error.issues.map(i=>i.message).join(', ') };
  const { sessionId, customerId, name, phone, email, message, text, metadata } = parsed.data;
  const content = message || text;
  return { sessionId, customerId, name, phone, email, content, metadata, raw: body };
}
function normalizeMessage(text){
  if(typeof text !== 'string') return '';
  return text.slice(0,2000).trim().replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function resolveIdentity({ customerId, phone, email, sessionId }){
  if(customerId) return { channel:'PHONE', externalId: customerId, type:'customerId' };
  if(phone) {
    // normalize phone
    let s = phone.toString().replace(/[۰-۹]/g, d=> String.fromCharCode(d.charCodeAt(0)-1728)).replace(/[\s\-\(\)]/g,'').replace(/^(\+98|0098|98)/,'').replace(/^0/,'');
    if(/^\d{10}$/.test(s) && s.startsWith('9')) return { channel:'PHONE', externalId: '0'+s };
  }
  if(email) return { channel:'PHONE', externalId: email };
  return { channel:'WEBSITE', externalId: sessionId || String(Date.now()) };
}
function healthCheck(){ return { status:'CONNECTED', endpoint:'/api/integrations/website/messages' }; }
async function publish(){ throw new Error('Website publish not applicable (inbound only)'); }

module.exports = { verifyWebhook, parseInbound, normalizeMessage, resolveIdentity, healthCheck, publish, channel:'WEBSITE', schema: websiteSchema };
