/**
 * Unified Message Pipeline — Phase 4
 * Shared helpers for Telegram/Instagram/Basalam/Website
 */
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = require('../prisma');

function escapeXSS(str){
  if(typeof str !== 'string') return str;
  return str.replace(/[&<>\"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;' }[c]));
}
function normalizePhone(raw){
  if(!raw) return null;
  let s = raw.toString()
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0)-1728))
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0)-1584))
    .replace(/[\s\-\(\)]/g,'');
  s = s.replace(/^(\+98|0098|98)/,'');
  s = s.replace(/^0/,'');
  if(!/^\d{10}$/.test(s)) return null;
  if(!s.startsWith('9')) return null;
  return '0'+s;
}
function calculateLeadScore({ messageCount=0, hasProductInquiry=false, hasPriceInquiry=false, hasStockInquiry=false, repeatedContact=false, previousPurchase=false }){
  let score=0;
  score+=messageCount*5;
  if(hasProductInquiry) score+=15;
  if(hasPriceInquiry) score+=20;
  if(hasStockInquiry) score+=10;
  if(repeatedContact) score+=15;
  if(previousPurchase) score+=25;
  return Math.min(100, score);
}
function generateFallbackPhone(externalId, prefix='0999'){
  // Deterministic hash-based to avoid numeric suffix collision (P0 CRM DATA CORRUPTION)
  const str = String(externalId);
  const numericRaw = str.replace(/\D/g,'').slice(-7);
  let numeric;
  if(numericRaw.length===7 && str.length<12){
    // short numeric-like IDs keep as-is for backward compat, but still hash to avoid collisions
    numeric = numericRaw;
  } else {
    const hash = crypto.createHash('sha256').update(str).digest('hex');
    const num = parseInt(hash.slice(0,7), 16) % 10000000;
    numeric = String(num).padStart(7,'0');
  }
  return `${prefix}${numeric}`.slice(0,11);
}

async function resolveCustomerByIdentity(tx, channel, externalId){
  const ident = await tx.customerIdentity.findUnique({ where:{ channel_externalId:{ channel, externalId: String(externalId) } }, include:{ customer:true } });
  return ident ? ident.customer : null;
}

/**
 * Resolve or create customer for Telegram inbound
 * Returns customer
 */
async function resolveOrCreateTelegramCustomer(tx, { externalId, username, firstName, lastName, phone }){
  const ext = String(externalId);
  // 1) exact identity
  let customer = await resolveCustomerByIdentity(tx, 'TELEGRAM', ext);
  if(customer) {
    await tx.customer.update({ where:{ id: customer.id }, data:{ lastSeenAt: new Date() }});
    // update identity metadata
    await tx.customerIdentity.update({ where:{ channel_externalId:{ channel:'TELEGRAM', externalId: ext } }, data:{ username, displayName: [firstName, lastName].filter(Boolean).join(' '), lastSeenAt: new Date() }}).catch(()=>{});
    return customer;
  }
  // 2) try phone if provided (contact share)
  if(phone){
    const norm = normalizePhone(phone);
    if(norm){
      customer = await tx.customer.findFirst({ where:{ OR:[{ phone }, { normalizedPhone: norm }] } });
      if(customer){
        // link identity to existing customer
        try{ await tx.customerIdentity.create({ data:{ customerId: customer.id, channel:'TELEGRAM', externalId: ext, username, displayName: [firstName, lastName].filter(Boolean).join(' ') }}) }catch(_){}
        await tx.customer.update({ where:{ id: customer.id }, data:{ lastSeenAt: new Date() }});
        return customer;
      }
    }
  }
  // 3) create new customer with fallback phone
  const fallbackPhone = generateFallbackPhone(ext, '0999');
  const fallbackNorm = normalizePhone(fallbackPhone) || fallbackPhone;
  // ensure unique phone — increment last digit if collision (avoids mixing different externalIds)
  let finalPhone = fallbackPhone;
  let finalNorm = fallbackNorm;
  let counter=0;
  while(await tx.customer.findFirst({ where:{ OR:[{ phone: finalPhone }, { normalizedPhone: finalNorm }] } })){
    counter++;
    // deterministically vary last digit
    const base = fallbackPhone.slice(0,10);
    finalPhone = `${base}${counter % 10}`;
    finalNorm = normalizePhone(finalPhone) || finalPhone;
    if(counter>9) break;
  }
  const name = [firstName, lastName].filter(Boolean).join(' ') || username || `کاربر تلگرام ${ext.slice(-4)}`;
  customer = await tx.customer.create({
    data:{
      phone: finalPhone,
      normalizedPhone: finalNorm,
      name: escapeXSS(String(name).slice(0,100)),
      source: 'TELEGRAM',
      status: 'NEW',
      notes: `ساخته شده از تلگرام - externalId ${ext} - username ${username||''}`
    }
  });
  await tx.customerTimeline.create({ data:{ customerId: customer.id, eventType:'CUSTOMER_CREATED', title:'مشتری از تلگرام', description:`externalId ${ext}` }});
  await tx.customerIdentity.create({ data:{ customerId: customer.id, channel:'TELEGRAM', externalId: ext, username, displayName: name }});
  try{ await tx.customerIdentity.create({ data:{ customerId: customer.id, channel:'PHONE', externalId: finalPhone }}) }catch(_){}
  return customer;
}

/**
 * Resolve or create for Website
 * Priority: customerId → normalized phone → email → session identity → new
 */
async function resolveOrCreateWebsiteCustomer(tx, { customerId, phone, email, name, sessionId }){
  // 1) customerId if valid and exists
  if(customerId){
    const c = await tx.customer.findUnique({ where:{ id: customerId } });
    if(c) {
      await tx.customer.update({ where:{ id: c.id }, data:{ lastSeenAt: new Date() }});
      return c;
    }
  }
  // 2) phone
  if(phone){
    const norm = normalizePhone(phone);
    if(norm){
      let c = await tx.customer.findFirst({ where:{ OR:[{ phone }, { normalizedPhone: norm }] } });
      if(c){
        await tx.customer.update({ where:{ id: c.id }, data:{ lastSeenAt: new Date() }});
        return c;
      }
    }
  }
  // 3) email
  if(email){
    let c = await tx.customer.findFirst({ where:{ email } });
    if(c){
      await tx.customer.update({ where:{ id: c.id }, data:{ lastSeenAt: new Date() }});
      return c;
    }
  }
  // 4) session identity
  if(sessionId){
    const ident = await tx.customerIdentity.findFirst({ where:{ channel:'WEBSITE', externalId: String(sessionId) }, include:{ customer:true } });
    if(ident) {
      await tx.customer.update({ where:{ id: ident.customer.id }, data:{ lastSeenAt: new Date() }});
      return ident.customer;
    }
  }
  // 5) create new
  const rawPhone = phone || generateFallbackPhone(sessionId || Date.now().toString(), '0999');
  const norm = normalizePhone(rawPhone) || rawPhone;
  const finalName = name || `کاربر سایت ${String(sessionId||'').slice(-4) || 'ناشناس'}`;
  const finalEmail = email || null;
  let customer = null;
  // try to ensure phone unique — increment last digit
  let finalPhone = rawPhone;
  let finalNorm = norm;
  let cnt=0;
  while(await tx.customer.findFirst({ where:{ OR:[{ phone: finalPhone }, { normalizedPhone: finalNorm }] } })){
    cnt++;
    const base = rawPhone.slice(0,10);
    finalPhone = `${base}${cnt % 10}`;
    finalNorm = normalizePhone(finalPhone) || finalNorm;
    if(cnt>9) break;
  }
  customer = await tx.customer.create({
    data:{
      phone: finalPhone,
      normalizedPhone: finalNorm,
      name: escapeXSS(String(finalName).slice(0,100)),
      email: finalEmail,
      source: 'WEBSITE',
      status: 'NEW',
      notes: `ساخته شده از وب‌سایت - session ${sessionId||''}`
    }
  });
  await tx.customerTimeline.create({ data:{ customerId: customer.id, eventType:'CUSTOMER_CREATED', title:'مشتری از وب‌سایت', description:`session ${sessionId||''}` }});
  await tx.customerIdentity.create({ data:{ customerId: customer.id, channel:'WEBSITE', externalId: String(sessionId || customer.id), displayName: finalName }});
  if(phone) try{ await tx.customerIdentity.create({ data:{ customerId: customer.id, channel:'PHONE', externalId: String(phone) }}) }catch(_){}
  if(email) try{ await tx.customerIdentity.create({ data:{ customerId: customer.id, channel:'EMAIL', externalId: String(email) }}) }catch(_){}
  return customer;
}

async function createInboundMessage(tx, { customerId, channel, externalMessageId, content, metadata, actorId }){
  // duplicate check
  if(externalMessageId){
    const dup = await tx.message.findFirst({ where:{ channel, externalMessageId: String(externalMessageId) }});
    if(dup) return { message: dup, duplicate:true };
  }
  const msg = await tx.message.create({
    data:{
      customerId,
      channel,
      direction: 'INBOUND',
      content: escapeXSS(content),
      text: escapeXSS(content),
      externalMessageId: externalMessageId ? String(externalMessageId) : null,
      status: 'RECEIVED',
      metadata: metadata || {}
    }
  });
  await tx.customer.update({ where:{ id: customerId }, data:{ lastSeenAt: new Date() }});
  await tx.customerTimeline.create({ data:{ customerId, eventType:'MESSAGE_RECEIVED', title:`پیام ${channel}`, description: content.slice(0,80), actorId, metadata:{ messageId: msg.id, channel } }});
  return { message: msg, duplicate:false };
}

async function detectAndCreateLead(tx, { customerId, content, actorId }){
  const lower = String(content||'').toLowerCase();
  const hasPrice = lower.includes('قیمت') || lower.includes('price') || lower.includes('هزینه');
  const hasStock = lower.includes('موجود') || lower.includes('stock') || lower.includes('موجودی');
  const hasProduct = lower.includes('محصول') || lower.includes('خرید') || lower.includes('سفارش') || lower.includes('product');
  // simple heuristic: if contains price or stock or product, create lead if not exists recent
  if(!(hasPrice || hasStock || hasProduct)) return null;
  // duplicate prevention: same customer recent lead within 1h?
  const recent = await tx.lead.findFirst({ where:{ customerId, createdAt:{ gte: new Date(Date.now()-60*60*1000) } }});
  if(recent) return null;
  const messageCount = await tx.message.count({ where:{ customerId }});
  const repeated = await tx.lead.count({ where:{ customerId } }) >0;
  const previousPurchase = await tx.order.count({ where:{ customerId }}) >0;
  const score = calculateLeadScore({ messageCount, hasProductInquiry:hasProduct, hasPriceInquiry:hasPrice, hasStockInquiry:hasStock, repeatedContact:repeated, previousPurchase });
  const lead = await tx.lead.create({
    data:{
      customerId,
      status:'NEW',
      source: 'TELEGRAM', // will be overridden by caller if needed
      intent: escapeXSS(content.slice(0,200)),
      score,
    }
  });
  await tx.customer.update({ where:{ id: customerId }, data:{ status:'LEAD', lastSeenAt: new Date() }});
  await tx.customerTimeline.create({ data:{ customerId, eventType:'LEAD_CREATED', title:`لید از پیام (${lead.status})`, description: content.slice(0,100), actorId, metadata:{ leadId: lead.id, score } }});
  // Auto followUp 2h later (professional: ensures every NEW lead has tracking)
  try{
    await tx.followUp.create({ data:{ customerId, leadId: lead.id, type:'MESSAGE', scheduledAt: new Date(Date.now()+2*60*60*1000), reason:`پیگیری لید ${content.slice(0,40)}`, assignedToId: actorId }});
  }catch(_){}
  return lead;
}

module.exports = {
  escapeXSS,
  normalizePhone,
  generateFallbackPhone,
  resolveCustomerByIdentity,
  resolveOrCreateTelegramCustomer,
  resolveOrCreateWebsiteCustomer,
  createInboundMessage,
  detectAndCreateLead,
};
