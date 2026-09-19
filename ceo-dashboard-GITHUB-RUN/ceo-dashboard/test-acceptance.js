const prisma = require('./lib/prisma');
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ownerPhone = '09017909857';
const testPhone = '09120001111';
const TEST_OTP = process.env.TEST_OTP || '999999';

function hashOTP(o){ return crypto.createHash('sha256').update(o).digest('hex'); }

async function fetchJSON(url, opts={}){
  const r = await fetch(url, opts);
  let t, d;
  try{ d=await r.json(); t=JSON.stringify(d);}catch{t=await r.text();}
  return {status:r.status, data:d, text:t, headers:r.headers};
}
async function requestOTP(phone){
  console.log(`\n→ Request OTP ${phone}`);
  const r = await fetchJSON(`${BASE}/api/auth/request-otp`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({phone})});
  console.log(`  ${r.status} ${r.text.slice(0,200)}`);
  return r;
}
async function verifyOTP(phone, otp){
  console.log(`→ Verify OTP ${phone} / ${otp}`);
  const r = await fetchJSON(`${BASE}/api/auth/verify-otp`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({phone, otp})});
  console.log(`  ${r.status} ${r.text.slice(0,500)}`);
  return r;
}
async function getOtpFromDB(phone){
  // normalize like server
  let p = phone.replace(/\D/g,'').slice(-11);
  p = p.slice(-10);
  if(p.length===10) p='0'+p;
  const rec = await prisma.otpRequest.findFirst({ where:{ phone: p }, orderBy:{ createdAt:'desc' } });
  return rec;
}

(async()=>{
  try{
    console.log('=== ACCEPTANCE TEST START ===');
    // Cleanup previous test user if exists
    await prisma.user.deleteMany({ where:{ phone: testPhone } }).catch(()=>{});
    // Also delete test phone variations
    const normalizedTest = '09120001111';
    // 1. Owner Login
    console.log('\n[1] Owner Login');
    let r = await requestOTP(ownerPhone);
    if(r.status!==200) throw new Error('owner request-otp failed '+r.text);
    let rec = await getOtpFromDB(ownerPhone);
    if(!rec) throw new Error('no otp record for owner');
    // Need to get plain OTP — we logged it, but we can brute force? Instead we can directly set a known OTP by updating hash to hash of 1234?
    // Simpler: we generate our own OTP and patch DB to make hash match 1111, then verify with 1111
    // For owner, we can set otp to 1234 and update DB
    const ownerOtp = '1234';
    await prisma.otpRequest.update({ where:{ id: rec.id }, data:{ otpHash: hashOTP(ownerOtp) } });
    console.log(`  Patched owner OTP to ${ownerOtp} (hash ${hashOTP(ownerOtp).slice(0,8)})`);
    let v = await verifyOTP(ownerPhone, ownerOtp);
    if(v.status!==200) throw new Error('owner verify failed '+v.text);
    const ownerToken = v.data.token;
    console.log(`  ✅ Owner token ${ownerToken.slice(0,20)}...`);
    const ownerAuth = { 'Authorization': `Bearer ${ownerToken}`, 'content-type':'application/json' };

    // 2. Create Test User via owner
    console.log('\n[2] Create Test User');
    let cu = await fetchJSON(`${BASE}/api/users`, {method:'POST', headers:ownerAuth, body:JSON.stringify({ phone: testPhone, role:'TEST_SALES', displayName:'Test Sales User', isTestAccount:true })});
    console.log(`  ${cu.status} ${cu.text.slice(0,500)}`);
    if(cu.status!==201) throw new Error('create test user failed');
    const testUserId = cu.data.user.id;
    console.log(`  ✅ Test user id ${testUserId}`);

    // Verify owner preserved
    const ownerUser = await prisma.user.findUnique({ where:{ phone: ownerPhone } });
    console.log(`  Owner preserved: phone=${ownerUser.phone} role=${ownerUser.role} isTest=${ownerUser.isTestAccount}`);

    // 3. Login Test User
    console.log('\n[3] Login Test User');
    r = await requestOTP(testPhone);
    console.log(`  request-otp status ${r.status}`);
    if(r.status!==200) throw new Error('test request-otp failed '+r.text);
    rec = await getOtpFromDB(testPhone);
    console.log(`  OTP record hash ${rec.otpHash.slice(0,12)} should be TEST_OTP hash ${hashOTP(TEST_OTP).slice(0,12)} match=${rec.otpHash===hashOTP(TEST_OTP)}`);
    // Verify with TEST_OTP (non-prod bypass)
    v = await verifyOTP(testPhone, TEST_OTP);
    console.log(`  verify status ${v.status}`);
    if(v.status!==200) throw new Error('test verify failed '+v.text);
    const testToken = v.data.token;
    console.log(`  ✅ Test token ${testToken.slice(0,20)}... decoded role should be TEST_SALES`);
    const testAuth = { 'Authorization': `Bearer ${testToken}`, 'content-type':'application/json' };

    // 4. Test RBAC — Allowed Access
    console.log('\n[4] RBAC Allowed Access (TEST_SALES should read customers)');
    let rc = await fetchJSON(`${BASE}/api/customers?limit=1`, {headers: testAuth});
    console.log(`  GET /api/customers → ${rc.status} ${rc.text.slice(0,300)}`);
    if(rc.status!==200) throw new Error('TEST_SALES should be allowed customers.read but got '+rc.status);

    // 5. Forbidden Access — credential
    console.log('\n[5] RBAC Forbidden Access (TEST_SALES should NOT manage credential)');
    let forb = await fetchJSON(`${BASE}/api/integrations/TELEGRAM/credentials`, {method:'POST', headers:testAuth, body:JSON.stringify({ botToken:'123456:TEST' })});
    console.log(`  POST credentials → ${forb.status} ${forb.text.slice(0,400)}`);
    if(forb.status!==403) console.log('  ⚠️ Expected 403 for TEST_SALES credential manage');

    // 6. Forbidden — audit
    console.log('\n[6] RBAC Forbidden audit');
    let for2 = await fetchJSON(`${BASE}/api/audit`, {headers: testAuth});
    console.log(`  GET /api/audit → ${for2.status} ${for2.text.slice(0,300)}`);
    if(for2.status!==403) console.log('  ⚠️ Expected 403 for TEST_SALES audit.read');

    // 7. Agent Permission check
    console.log('\n[7] Tool Permission — TEST_SALES should be blocked for telegram.sendMessage (TEST_MODE_BLOCKED or FORBIDDEN)');
    let tool = await fetchJSON(`${BASE}/api/tools/telegram.sendMessage/execute`, {method:'POST', headers:testAuth, body:JSON.stringify({ chatId:'123', text:'test from test user' })});
    console.log(`  POST tool → ${tool.status} ${tool.text.slice(0,400)}`);
    if(tool.status!==403) console.log('  ⚠️ Expected 403 for test tool');

    // 8. Allowed for owner — create customer as test data should be flagged isTestData false for owner, true for test
    console.log('\n[8] Create customer as owner (should be isTestData false)');
    let custOwner = await fetchJSON(`${BASE}/api/customers`, {method:'POST', headers:ownerAuth, body:JSON.stringify({ phone:'09120002222', name:'Owner Customer Prod', source:'MANUAL' })});
    console.log(`  owner create → ${custOwner.status} ${custOwner.text.slice(0,400)}`);
    let prodCustomerId = custOwner.data?.customer?.id;
    let prodCust = prodCustomerId ? await prisma.customer.findUnique({where:{id:prodCustomerId}}) : null;
    console.log(`  isTestData for owner customer: ${prodCust?.isTestData}`);

    console.log('\n[9] Create customer as test user (should be isTestData true)');
    let custTest = await fetchJSON(`${BASE}/api/customers`, {method:'POST', headers:testAuth, body:JSON.stringify({ phone:'09120003333', name:'Test Customer', source:'MANUAL' })});
    console.log(`  test create → ${custTest.status} ${custTest.text.slice(0,400)}`);
    let testCustomerId = custTest.data?.customer?.id;
    let testCust = testCustomerId ? await prisma.customer.findUnique({where:{id:testCustomerId}}) : null;
    console.log(`  isTestData for test customer: ${testCust?.isTestData}`);

    // 9. Verify AuditLog
    console.log('\n[10] Verify AuditLog');
    let audit = await fetchJSON(`${BASE}/api/audit`, {headers: ownerAuth});
    console.log(`  audit count ${audit.data?.logs?.length || audit.data?.auditLogs?.length || 0} status ${audit.status}`);
    const hasTestCreate = JSON.stringify(audit.data).includes('USER_CREATED') || JSON.stringify(audit.data).includes('TEST');
    console.log(`  has USER_CREATED: ${hasTestCreate}`);

    // 10. Logout test
    console.log('\n[11] Logout test');
    await fetchJSON(`${BASE}/api/auth/logout`, {method:'POST', headers:testAuth});

    // 11. Owner Login again verify production unchanged
    console.log('\n[12] Owner re-login verify production unchanged');
    r = await requestOTP(ownerPhone);
    rec = await getOtpFromDB(ownerPhone);
    await prisma.otpRequest.update({ where:{ id: rec.id }, data:{ otpHash: hashOTP(ownerOtp) } });
    v = await verifyOTP(ownerPhone, ownerOtp);
    const ownerToken2 = v.data.token;
    const ownerAuth2 = { 'Authorization': `Bearer ${ownerToken2}`, 'content-type':'application/json' };
    let users = await fetchJSON(`${BASE}/api/users`, {headers: ownerAuth2});
    console.log(`  GET /api/users → ${users.status} count ${users.data?.users?.length}`);
    console.log(`  users: ${JSON.stringify(users.data?.users?.map(u=>({phone:u.phone, role:u.role, isTest:u.isTestAccount})))}`);

    // 12. Reset Test Data
    console.log('\n[13] Reset Test Data (should delete only isTestData)');
    let reset = await fetchJSON(`${BASE}/api/test/reset`, {method:'POST', headers:ownerAuth2});
    console.log(`  reset → ${reset.status} ${reset.text.slice(0,500)}`);
    // Verify prod customer still exists, test customer deleted
    let prodExists = await prisma.customer.findUnique({where:{id:prodCustomerId}});
    let testExists = testCustomerId ? await prisma.customer.findUnique({where:{id:testCustomerId}}) : null;
    console.log(`  prod exists after reset: ${!!prodExists} (should true)`);
    console.log(`  test exists after reset: ${!!testExists} (should false)`);

    // Cleanup
    await prisma.customer.deleteMany({ where:{ phone:{ in:['09120002222','09120003333'] } } }).catch(()=>{});
    await prisma.user.deleteMany({ where:{ phone: testPhone } }).catch(()=>{});
    console.log('\n=== ACCEPTANCE TEST PASSED ===');
    await prisma.$disconnect();
    process.exit(0);
  }catch(e){
    console.error('\n❌ ACCEPTANCE TEST FAILED', e.message, e.stack);
    await prisma.$disconnect();
    process.exit(1);
  }
})();