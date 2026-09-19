/**
 * Phase 4 — FIXED TESTS — use unique IDs per run
 */
require('dotenv').config();
const crypto = require('crypto');
const prisma = require('./lib/prisma');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TELEGRAM_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'test_telegram_secret_123';
const INSTAGRAM_SECRET = process.env.INSTAGRAM_APP_SECRET || 'test_instagram_secret_123';
let passed=0, failed=0, skipped=0;
function ok(n,c,e=''){ if(c){console.log(`✅ ${n} ${e}`);passed++;}else{console.log(`❌ ${n} ${e}`);failed++;}}
async function fetchJSON(u,o={}){ const r=await fetch(u,o); let d=null; let t=null; try{ d=await r.json(); t=JSON.stringify(d); }catch(e){ t=await r.text().catch(()=>''); try{d=JSON.parse(t);}catch{_}{d=t;} } return {status:r.status, headers:r.headers, data:d, text:t} }
function jwtFor(p='09017909857', role='CEO'){ const jwt=require('jsonwebtoken'); const s=process.env.JWT_SECRET||'test'; return jwt.sign({phone:p, role}, s, {expiresIn:'1h'}); }
function hmacInstagram(b,s){ return 'sha256=' + crypto.createHmac('sha256', s).update(JSON.stringify(b)).digest('hex'); }

async function run(){
  console.log('=== PHASE 4 FIXED ===');
  const uniq = Date.now().toString().slice(-7); // 7 digits unique
  const tgBase = 710000 + parseInt(uniq.slice(-4)); // ensure 6 digits
  const igBase = `ig_${uniq}`;
  const sessBase = `sess-${uniq}`;
  const phoneBase = `0912${uniq.padStart(7,'0')}`.slice(0,11);
  const phone2 = `0913${uniq.padStart(7,'0')}`.slice(0,11);
  // Get product
  const product = await prisma.product.findFirst({where:{isActive:true}});
  ok('Product exists', !!product);
  const ceoToken = jwtFor('09017909857','CEO');
  const authCEO = {'Authorization':`Bearer ${ceoToken}`, 'Content-Type':'application/json'};
  const supportJwt = jwtFor('09017909857','SUPPORT');
  const authSupport = {'Authorization':`Bearer ${supportJwt}`, 'Content-Type':'application/json'};
  // Telegram valid
  const tgUpdateId = parseInt(Date.now().toString().slice(-9)); // unique update_id
  let tgBody = { update_id: tgUpdateId, message:{ message_id: parseInt(uniq), from:{id: tgBase, username:'tguser', first_name:'Ali'}, chat:{id: tgBase}, text:'سلام قیمت چنده؟' }};
  let r = await fetchJSON(`${BASE}/api/integrations/telegram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':TELEGRAM_SECRET}, body: JSON.stringify(tgBody)});
  ok('1 valid webhook', r.status===200 && r.data.received, JSON.stringify(r.data).slice(0,80));
  const tgCustomerId = r.data.customerId;
  // duplicate
  let r4 = await fetchJSON(`${BASE}/api/integrations/telegram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':TELEGRAM_SECRET}, body: JSON.stringify(tgBody)});
  ok('4 duplicate', r4.status===200 && r4.data.duplicate===true);
  // new customer with different externalId
  const tgBase2 = tgBase+5;
  let tgBody2 = { update_id: tgUpdateId+5, message:{ message_id: parseInt(uniq)+5, from:{id: tgBase2, username:'newuser', first_name:'New'}, chat:{id: tgBase2}, text:'سلام' }};
  let r5 = await fetchJSON(`${BASE}/api/integrations/telegram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':TELEGRAM_SECRET}, body: JSON.stringify(tgBody2)});
  ok('5 new customer', r5.status===200 && !!r5.data.customerId && r5.data.customerId!==tgCustomerId);
  // instagram
  const igMid = `mid_${uniq}`;
  let igBody = { entry:[{ messaging:[{ sender:{id: igBase}, recipient:{id:'page_1'}, message:{mid: igMid, text:'سلام اینستا'}, timestamp:1234567890 }]}]};
  let sig = hmacInstagram(igBody, INSTAGRAM_SECRET);
  let r16a = await fetchJSON(`${BASE}/api/integrations/instagram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Hub-Signature-256': sig}, body: JSON.stringify(igBody)});
  ok('16 first instagram', r16a.status===200 && r16a.data.received);
  let r16b = await fetchJSON(`${BASE}/api/integrations/instagram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Hub-Signature-256': sig}, body: JSON.stringify(igBody)});
  ok('16 duplicate', r16b.status===200 && r16b.data.duplicate===true);
  // website phone normalization with Persian
  const persianPhone = '۰۹۱۲۰۰۰۴۴۴۵'; // will normalize to 09120004445
  // But to avoid collision, use unique phone for website test, and test persian separately with unique
  const persianUniqPhone = '۰۹۱۲' + uniq.padStart(7,'0').split('').map(d=> '۰۱۲۳۴۵۶۷۸۹'[parseInt(d)]).join('').slice(0,7);
  // Actually create persian digits from uniq
  const toPersian = s=> s.replace(/\d/g, d=>'۰۱۲۳۴۵۶۷۸۹'[d]);
  const persianPhoneUniq = toPersian(`0912${uniq.padStart(7,'0')}`.slice(0,11));
  let r33 = await fetchJSON(`${BASE}/api/integrations/website/messages`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId:`${sessBase}-33`, phone: persianPhoneUniq, message:'تست فارسی' })});
  ok('33 phone normalization', r33.status===201);
  const norm = persianPhoneUniq.replace(/[۰-۹]/g, d=> String.fromCharCode(d.charCodeAt(0)-1728));
  // check via prisma with normalized
  let normCust = await prisma.customer.findFirst({ where:{ normalizedPhone: norm }});
  ok('33b normalized persisted', !!normCust && normCust.normalizedPhone===norm, normCust ? normCust.normalizedPhone : 'not found');
  // IDOR
  if(tgCustomerId){
    let r37 = await fetchJSON(`${BASE}/api/customers/${tgCustomerId}/orders`, {headers: authCEO});
    ok('37 IDOR', r37.status===200 && Array.isArray(r37.data.orders));
  } else {
    ok('37 IDOR', false, 'no tgCustomerId');
  }
  console.log(`\n=== RESULT FIXED: ${passed} passed, ${failed} failed ===`);
}
run().catch(e=>{console.error(e); process.exit(1);});
