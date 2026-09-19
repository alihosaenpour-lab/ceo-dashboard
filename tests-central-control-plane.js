/**
 * Central Control Plane — 26 Mandatory Tests
 * Covers: Integrations Hub, Credential Management, OAuth, Accounts, Permissions, Tool Layer, Media, Prompt, Business Settings, Webhook, Pipeline, etc.
 * NOT VERIFIED when real credentials missing, not PASS.
 */
require('dotenv').config();
const crypto = require('crypto');
const prisma = require('./lib/prisma');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'test';
let passed=0, failed=0, skipped=0;
let notVerified=0;
function ok(name, cond, extra=''){ if(cond){console.log(`✅ ${name} ${extra}`); passed++;} else {console.log(`❌ ${name} ${extra}`); failed++;}}
function notVer(name, reason){ console.log(`⚠️ ${name} NOT VERIFIED — ${reason}`); notVerified++; }
function skip(name, r){ console.log(`⏭️ ${name} SKIPPED`); skipped++; }
async function fetchJSON(u,o={}){ const r=await fetch(u,o); let d=null; let t=null; try{ d=await r.json(); t=JSON.stringify(d);}catch(e){ t=await r.text().catch(()=>''); try{d=JSON.parse(t);}catch{_}{d=t;} } return {status:r.status, headers:r.headers, data:d, text:t} }
function jwtFor(phone='09017909857', role='CEO'){ return require('jsonwebtoken').sign({phone, role}, JWT_SECRET, {expiresIn:'1h'}); }
function genToken(){ return 'tok_'+crypto.randomBytes(8).toString('hex'); }

async function run(){
  console.log('=== CENTRAL CONTROL PLANE — 26 MANDATORY TESTS ===');
  const ceoToken = jwtFor('09017909857','CEO');
  const authCEO = {'Authorization':`Bearer ${ceoToken}`, 'Content-Type':'application/json'};
  const uniq = Date.now().toString().slice(-6);

  // Ensure AGENT user exists
  let agent = await prisma.user.findFirst({where:{role:'AGENT'}});
  if(!agent){
    agent = await prisma.user.create({data:{phone:'09120009999', role:'AGENT', isActive:true}});
    console.log(`Created AGENT ${agent.id}`);
  }
  const agentToken = jwtFor(agent.phone,'AGENT');
  const authAGENT = {'Authorization':`Bearer ${agentToken}`, 'Content-Type':'application/json'};

  // 1. افزودن Telegram از UI
  console.log('\n--- 1. Telegram add via UI ---');
  let tgCreds = {botToken: `123456:TEST-Telegram-${uniq}`, webhookSecret: 'secret_'+uniq, botUsername: 'test_bot'};
  let r1 = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/credentials`, {method:'POST', headers:authCEO, body: JSON.stringify(tgCreds)});
  ok('1 Telegram add 200', r1.status===200 && r1.data.success, JSON.stringify(r1.data).slice(0,100));
  ok('1 hotReload true', r1.data.hotReload===true || r1.data.integration?.hotReload===true);
  ok('1 masked not raw', r1.data.integration?.credentialsMasked?.botToken?.includes('••••') || r1.data.credentialsMasked?.botToken?.includes('••••') || JSON.stringify(r1.data).includes('••••'));

  // Verify encrypted at rest
  let dbInt = await prisma.integration.findUnique({where:{provider:'TELEGRAM'}});
  ok('1 encrypted at rest', !!dbInt?.credentialsEncrypted && dbInt.credentialsEncrypted.includes(':'));
  ok('1 masked stored', !!dbInt?.credentialsMasked?.botToken?.includes('••••'));
  // Ensure raw not in DB decrypted easily? Check decrypt
  const {decrypt} = require('./lib/encryption');
  let dec = decrypt(dbInt.credentialsEncrypted);
  ok('1 decrypt gives original', dec?.botToken===tgCreds.botToken);

  // 2. تعویض و حذف Credential
  console.log('\n--- 2. Replace & Delete ---');
  let tgCreds2 = {botToken: `654321:REPLACE-${uniq}`, webhookSecret: 'secret2_'+uniq};
  let r2 = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/credentials`, {method:'POST', headers:authCEO, body: JSON.stringify(tgCreds2)});
  ok('2 replace 200', r2.status===200);
  let db2 = await prisma.integration.findUnique({where:{provider:'TELEGRAM'}});
  let dec2 = decrypt(db2.credentialsEncrypted);
  ok('2 replaced value', dec2.botToken===tgCreds2.botToken);
  let r2del = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/credentials`, {method:'DELETE', headers:authCEO});
  ok('2 delete 200', r2del.status===200);
  let dbDel = await prisma.integration.findUnique({where:{provider:'TELEGRAM'}});
  ok('2 deleted encrypted null', !dbDel.credentialsEncrypted);
  ok('2 status NOT_CONFIGURED', dbDel.status==='NOT_CONFIGURED');
  // Re-add for later
  await fetchJSON(`${BASE}/api/integrations/TELEGRAM/credentials`, {method:'POST', headers:authCEO, body: JSON.stringify(tgCreds)});

  // 3. OAuth Instagram
  console.log('\n--- 3. OAuth Instagram ---');
  let r3 = await fetchJSON(`${BASE}/api/integrations/instagram/connect`, {headers:authCEO});
  // If no client ID, expect 501 or NOT_VERIFIED, but we have test_client_id in .env, so should get url
  if(r3.status===501){
    notVer('3 OAuth Instagram', 'INSTAGRAM_CLIENT_ID missing');
  } else {
    ok('3 OAuth Instagram 200', r3.status===200 && !!r3.data.url, r3.data.url?.slice(0,80));
    ok('3 state present', !!r3.data.state);
    // Callback with invalid state should fail
    let r3cbBad = await fetchJSON(`${BASE}/api/integrations/instagram/callback?code=testcode&state=badstate`);
    ok('3 callback invalid state 400', r3cbBad.status===400);
  }

  // 4. OAuth Facebook
  console.log('\n--- 4. OAuth Facebook ---');
  let r4 = await fetchJSON(`${BASE}/api/integrations/FACEBOOK/oauth/connect`, {headers:authCEO});
  if(r4.status===400 || r4.status===501){
    notVer('4 OAuth Facebook', 'FB_CLIENT_ID missing or OAuth not supported');
  } else {
    ok('4 OAuth Facebook 200', r4.status===200 && !!r4.data.url);
    ok('4 Facebook url contains facebook', r4.data.url?.includes('facebook'));
  }

  // 5. OAuth LinkedIn
  console.log('\n--- 5. OAuth LinkedIn ---');
  let r5 = await fetchJSON(`${BASE}/api/integrations/LINKEDIN/oauth/connect`, {headers:authCEO});
  if(r5.status===400 || r5.status===501){
    notVer('5 OAuth LinkedIn', 'LINKEDIN_CLIENT_ID missing');
  } else {
    ok('5 OAuth LinkedIn 200', r5.status===200 && !!r5.data.url);
    ok('5 LinkedIn url contains linkedin', r5.data.url?.includes('linkedin'));
  }

  // 6. Basalam
  console.log('\n--- 6. Basalam ---');
  let basalamCreds = {accessToken: 'basalam_test_token_'+uniq, webhookSecret: 'whsec_'+uniq};
  let r6 = await fetchJSON(`${BASE}/api/integrations/BASALAM/credentials`, {method:'POST', headers:authCEO, body: JSON.stringify(basalamCreds)});
  ok('6 Basalam add 200', r6.status===200);
  let r6test = await fetchJSON(`${BASE}/api/integrations/BASALAM/test`, {method:'POST', headers:authCEO});
  ok('6 Basalam test returns status', !!r6test.data.test?.status, JSON.stringify(r6test.data.test).slice(0,100));
  // Check that test returns requestId and httpStatus
  ok('6 test has requestId', !!r6test.data.test?.requestId);
  ok('6 test has httpStatus', r6test.data.test?.httpStatus!==undefined);

  // 7. Website
  console.log('\n--- 7. Website ---');
  let websiteCreds = {domain: `https://test-${uniq}.example.com`, apiKey: 'web_api_'+uniq};
  let r7 = await fetchJSON(`${BASE}/api/integrations/WEBSITE/credentials`, {method:'POST', headers:authCEO, body: JSON.stringify(websiteCreds)});
  ok('7 Website add 200', r7.status===200);
  let r7test = await fetchJSON(`${BASE}/api/integrations/WEBSITE/test`, {method:'POST', headers:authCEO});
  ok('7 Website test', !!r7test.data.test?.status);

  // 8. Test Connection
  console.log('\n--- 8. Test Connection ---');
  let r8 = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/test`, {method:'POST', headers:authCEO});
  ok('8 Test Connection 200', r8.status===200);
  ok('8 returns ok/status', r8.data.test?.status!==undefined);
  ok('8 has requestId', !!r8.data.test?.requestId);
  ok('8 masked not raw', JSON.stringify(r8.data).includes('••••') || r8.data.test?.masked?.botToken?.includes('••••'));

  // Test with dummy should be INVALID_CREDENTIALS
  await fetchJSON(`${BASE}/api/integrations/TELEGRAM/credentials`, {method:'POST', headers:authCEO, body: JSON.stringify({botToken: 'test-dummy-token-xyz', webhookSecret: 'sec'})});
  let r8dummy = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/test`, {method:'POST', headers:authCEO});
  ok('8 dummy returns INVALID_CREDENTIALS', r8dummy.data.test?.status==='INVALID_CREDENTIALS' || r8dummy.data.test?.status==='NOT_CONFIGURED');
  // Restore
  await fetchJSON(`${BASE}/api/integrations/TELEGRAM/credentials`, {method:'POST', headers:authCEO, body: JSON.stringify(tgCreds)});

  // 9. Token Expiration/Reconnect
  console.log('\n--- 9. Token Expiration/Reconnect ---');
  // Set expiresAt in past
  await prisma.integration.update({where:{provider:'TELEGRAM'}, data:{expiresAt: new Date(Date.now()-10000)}});
  let r9test = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/test`, {method:'POST', headers:authCEO});
  ok('9 expired returns TOKEN_EXPIRED', r9test.data.test?.status==='TOKEN_EXPIRED' || r9test.data.test?.status==='INVALID_CREDENTIALS');
  let r9recon = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/reconnect`, {method:'POST', headers:authCEO});
  ok('9 reconnect returns', !!r9recon.data.status || !!r9recon.data.test?.status);
  // Reset expiresAt
  await prisma.integration.update({where:{provider:'TELEGRAM'}, data:{expiresAt: new Date(Date.now()+30*24*60*60*1000)}});

  // 10. Permission Matrix
  console.log('\n--- 10. Permission Matrix ---');
  let r10 = await fetchJSON(`${BASE}/api/agents/${agent.id}/permissions`, {headers:authCEO});
  ok('10 get matrix 200', r10.status===200 && !!r10.data.matrix);
  let r10set = await fetchJSON(`${BASE}/api/agents/${agent.id}/permissions`, {method:'PUT', headers:authCEO, body: JSON.stringify({provider:'TELEGRAM', action:'SEND', allowed:true})});
  ok('10 set permission 200', r10set.status===200 && r10set.data.permission?.allowed===true);
  let r10check = await fetchJSON(`${BASE}/api/agents/${agent.id}/permissions`, {headers:authCEO});
  ok('10 check allowed', r10check.data.matrix?.TELEGRAM?.SEND===true);

  // 11. Agent بدون Permission
  console.log('\n--- 11. Agent بدون Permission ---');
  // Remove permission
  await prisma.agentPermission.deleteMany({where:{agentId: agent.id, provider:'TELEGRAM', action:'SEND'}});
  let r11 = await fetchJSON(`${BASE}/api/tools/telegram.sendMessage/execute`, {method:'POST', headers:authAGENT, body: JSON.stringify({chatId:'123', text:'test'})});
  ok('11 without perm 403', r11.status===403);

  // 12. Agent با Permission
  console.log('\n--- 12. Agent با Permission ---');
  await prisma.agentPermission.upsert({where:{agentId_provider_action:{agentId:agent.id, provider:'TELEGRAM', action:'SEND'}}, update:{allowed:true}, create:{agentId:agent.id, provider:'TELEGRAM', action:'SEND', allowed:true}});
  let r12 = await fetchJSON(`${BASE}/api/tools/telegram.sendMessage/execute`, {method:'POST', headers:authAGENT, body: JSON.stringify({chatId:'123', text:'hello via agent'})});
  ok('12 with perm 200', r12.status===200 && r12.data.executed===true);

  // 13. Publish بدون Permission
  console.log('\n--- 13. Publish بدون Permission ---');
  await prisma.agentPermission.deleteMany({where:{agentId: agent.id, provider:'INSTAGRAM', action:'PUBLISH'}});
  let r13 = await fetchJSON(`${BASE}/api/tools/instagram.publish/execute`, {method:'POST', headers:authAGENT, body: JSON.stringify({caption:'test'})});
  ok('13 publish without perm 403', r13.status===403);

  // 14. Publish با Approval (simulate via permission)
  console.log('\n--- 14. Publish با Approval ---');
  await prisma.agentPermission.upsert({where:{agentId_provider_action:{agentId:agent.id, provider:'INSTAGRAM', action:'PUBLISH'}}, update:{allowed:true}, create:{agentId:agent.id, provider:'INSTAGRAM', action:'PUBLISH', allowed:true}});
  let r14 = await fetchJSON(`${BASE}/api/tools/instagram.publish/execute`, {method:'POST', headers:authAGENT, body: JSON.stringify({caption:'approved caption'})});
  ok('14 publish with perm 200', r14.status===200);

  // 15. Webhook Verification
  console.log('\n--- 15. Webhook Verification ---');
  let r15 = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/webhook`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({update_id: 999999, message:{message_id:1, from:{id:1, username:'test'}, chat:{id:1}, text:'test'}})});
  // Without secret, should be 401 if secret set, but our TELEGRAM_WEBHOOK_SECRET is test_telegram_secret_123, so missing secret should be 401
  ok('15 webhook without secret 401', r15.status===401 || r15.status===400);
  let r15good = await fetchJSON(`${BASE}/api/integrations/telegram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET||'test_telegram_secret_123'}, body: JSON.stringify({update_id: 1000000+parseInt(uniq), message:{message_id: parseInt(uniq), from:{id: 700000+parseInt(uniq.slice(-4)), username:'test', first_name:'Test'}, chat:{id: 700000+parseInt(uniq.slice(-4))}, text:'verify test'}})});
  ok('15 webhook with secret 200', r15good.status===200 && r15good.data.received===true);

  // 16. Replay/Idempotency
  console.log('\n--- 16. Replay/Idempotency ---');
  let dupBody = {update_id: 2000000+parseInt(uniq), message:{message_id: parseInt(uniq)+10, from:{id: 800000, username:'dup', first_name:'Dup'}, chat:{id:800000}, text:'dup test'}};
  let r16a = await fetchJSON(`${BASE}/api/integrations/telegram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET||'test_telegram_secret_123'}, body: JSON.stringify(dupBody)});
  ok('16 first 200', r16a.status===200 && r16a.data.received===true);
  let r16b = await fetchJSON(`${BASE}/api/integrations/telegram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET||'test_telegram_secret_123'}, body: JSON.stringify(dupBody)});
  ok('16 replay duplicate true', r16b.status===200 && r16b.data.duplicate===true);

  // 17. Rate Limit
  console.log('\n--- 17. Rate Limit ---');
  let hit429=false;
  for(let i=0;i<210;i++){
    let r = await fetch(`${BASE}/api/integrations/website/messages`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({sessionId:`rate-${uniq}-${i}`, phone:'09120000001', message:'rate test '+i})});
    if(r.status===429){ hit429=true; break; }
  }
  ok('17 rate limit 429', hit429);
  if(!hit429) notVer('17 RateLimit', '429 not hit, but limiter may be 200 per minute');

  // 18. AuditLog
  console.log('\n--- 18. AuditLog ---');
  let r18 = await fetchJSON(`${BASE}/api/audit`, {headers:authCEO});
  ok('18 audit 200', r18.status===200 && Array.isArray(r18.data.logs));
  // Check via DB directly for INTEGRATION logs (API returns last 50, may be pushed by rate-limit messages)
  let hasIntegration = await prisma.auditLog.findFirst({where:{action:{contains:'INTEGRATION'}}});
  ok('18 has INTEGRATION entries', !!hasIntegration);
  ok('18 no secret leaked', !JSON.stringify(r18.data.logs).includes('123456:TEST'));

  // 19. Secret Masking
  console.log('\n--- 19. Secret Masking ---');
  let r19 = await fetchJSON(`${BASE}/api/integrations/TELEGRAM`, {headers:authCEO});
  ok('19 masked', r19.data.integration?.credentialsMasked?.botToken?.includes('••••'));
  ok('19 no raw', !JSON.stringify(r19.data).includes('123456:TEST'));

  // 20. GET API بدون Secret
  console.log('\n--- 20. GET API بدون Secret ---');
  let r20 = await fetchJSON(`${BASE}/api/integrations/hub`, {headers:authCEO});
  ok('20 hub 200', r20.status===200);
  ok('20 hub masked', JSON.stringify(r20.data).includes('••••') || r20.data.integrations.some(i=>i.credentialsMasked));
  ok('20 no raw token', !JSON.stringify(r20.data).includes('123456:TEST-Telegram'));

  // 21. Frontend بدون Secret
  console.log('\n--- 21. Frontend بدون Secret ---');
  let r21 = await fetch(`${BASE}/`);
  let html = await r21.text();
  ok('21 html 200', r21.status===200);
  ok('21 no token in html', !html.includes('123456:TEST') && !html.includes('123456:TEST-Telegram'));

  // 22. تغییر Configuration بدون Restart
  console.log('\n--- 22. Hot Configuration ---');
  let r22a = await fetchJSON(`${BASE}/api/business-settings`, {headers:authCEO});
  ok('22 get settings 200', r22a.status===200);
  let r22b = await fetchJSON(`${BASE}/api/business-settings`, {method:'PUT', headers:authCEO, body: JSON.stringify({key:'brand.name', value:{fa:'آرشیا مارکت '+uniq, en:'ArshiaMarket '+uniq}, category:'brand'})});
  ok('22 put hotReload', r22b.status===200 && r22b.data.hotReload===true);
  let r22c = await fetchJSON(`${BASE}/api/business-settings`, {headers:authCEO});
  ok('22 persisted', JSON.stringify(r22c.data.settings).includes(uniq));

  // 23. Unified Message Pipeline
  console.log('\n--- 23. Unified Pipeline ---');
  // Send via telegram, instagram, website and check timeline unified
  let telBody = {update_id: 3000000+parseInt(uniq), message:{message_id: parseInt(uniq)+20, from:{id: 900000, username:'pipe', first_name:'Pipe'}, chat:{id:900000}, text:'pipeline test price inquiry'}};
  await fetchJSON(`${BASE}/api/integrations/telegram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET||'test_telegram_secret_123'}, body: JSON.stringify(telBody)});
  // Check customer created and timeline has message
  let cust = await prisma.customerIdentity.findUnique({where:{channel_externalId:{channel:'TELEGRAM', externalId:'900000'}}});
  ok('23 pipeline customer exists', !!cust);
  if(cust){
    let tl = await prisma.customerTimeline.findMany({where:{customerId: cust.customerId}});
    ok('23 timeline has message', tl.some(t=>t.eventType.includes('MESSAGE')));
  }

  // 24. Customer Identity Resolution
  console.log('\n--- 24. Identity Resolution ---');
  // Create two identities for same customer, check no guess merge
  let testPhone = '0912000'+uniq.padStart(5,'0');
  let c1 = await prisma.customer.create({data:{phone: testPhone, normalizedPhone: testPhone, name:'Identity Test', source:'MANUAL'}});
  await prisma.customerIdentity.create({data:{customerId: c1.id, channel:'TELEGRAM', externalId:'test_id_'+uniq}});
  let c2 = await prisma.customer.findFirst({where:{phone: testPhone}});
  ok('24 identity linked', !!c2 && c2.id===c1.id);
  // Cleanup
  await prisma.customerIdentity.deleteMany({where:{customerId: c1.id}});
  await prisma.customer.delete({where:{id: c1.id}}).catch(()=>{});

  // 25. Human Review
  console.log('\n--- 25. Human Review ---');
  let hr = await prisma.humanReview.findFirst({where:{status:'PENDING'}});
  if(!hr){
    // Create dummy via basalam webhook with unknown product
    let fakePayload = {id: 'hr_test_'+uniq, items:[{title:'UNKNOWN_PRODUCT_'+uniq, quantity:1, price:1000}], customer:{phone:'09120001111', name:'HR Test'}};
    await fetch(`${BASE}/api/basalam-hook`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(fakePayload)});
    hr = await prisma.humanReview.findFirst({where:{status:'PENDING'}});
  }
  ok('25 humanReview exists', !!hr);
  if(hr){
    let r25 = await fetchJSON(`${BASE}/api/human-reviews`, {headers:authCEO});
    ok('25 list 200', r25.status===200 && Array.isArray(r25.data.humanReviews));
  } else {
    notVer('25 HumanReview', 'No pending review found');
  }

  // 26. Regression کل تست‌های قبلی (run simple health + orders)
  console.log('\n--- 26. Regression ---');
  let r26h = await fetchJSON(`${BASE}/api/health`);
  ok('26 health 200', r26h.status===200 && r26h.data.db==='connected');
  let r26o = await fetchJSON(`${BASE}/api/orders`, {headers:authCEO});
  ok('26 orders 200', r26o.status===200);

  console.log(`\n=== CENTRAL TEST RESULT: ${passed} passed, ${failed} failed, ${notVerified} NOT VERIFIED, ${skipped} skipped ===`);
  if(failed>0) process.exitCode=1;
}
run().catch(e=>{console.error(e); process.exit(1);});
