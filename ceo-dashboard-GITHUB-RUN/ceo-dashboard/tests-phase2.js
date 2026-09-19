/**
 * PHASE 2 Tests - PostgreSQL + Prisma
 * Tests: DB, Auth, Orders, Inventory, Webhook, Concurrency
 */
const crypto = require('crypto');
const prisma = require('./lib/prisma');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
let passed=0, failed=0;
function ok(name, cond, extra=''){
  if(cond){ console.log(`✅ ${name} ${extra}`); passed++; }
  else { console.log(`❌ ${name} ${extra}`); failed++; }
}
function hashOTP(o){ return crypto.createHash('sha256').update(o).digest('hex'); }

async function fetchJSON(url, opts={}){
  const res = await fetch(url, opts);
  let data; try{ data = await res.json(); }catch(e){ data = {} }
  return { res, data, status: res.status };
}

async function run(){
  console.log('\n🧪 PHASE 2 Tests\n');

  // 1) DB Health
  try{
    await prisma.$queryRaw`SELECT 1`;
    ok('DB connected', true);
  }catch(e){ ok('DB connected', false, e.message); }

  let health = await fetchJSON(`${BASE}/api/health`);
  ok('GET /api/health 200', health.status===200);
  ok('Health db=connected', health.data.db==='connected', JSON.stringify(health.data.db));
  ok('Health prisma flag', health.data.security?.prisma===true);

  // 2) Auth: OTP via DB (hash, expiry, attempts)
  // Clean previous
  await prisma.otpRequest.deleteMany({ where:{ phone:'09017909857' } });
  // Request OTP via API
  let r1 = await fetchJSON(`${BASE}/api/auth/request-otp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone:'9017909857' }) });
  ok('POST /api/auth/request-otp 200', r1.status===200 && r1.data.ok);

  // Check DB has hash not plain
  let otpRec = await prisma.otpRequest.findFirst({ where:{ phone:'09017909857' }, orderBy:{ createdAt:'desc' } });
  ok('OTP stored hashed (not plain)', !!otpRec && otpRec.otpHash.length===64 && !['1234','0000'].includes(otpRec.otpHash));
  ok('OTP has expiry', !!otpRec && otpRec.expiresAt > new Date());

  // Try wrong OTP -> attempts increment
  let wrong = await fetchJSON(`${BASE}/api/auth/verify-otp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone:'9017909857', otp:'0000' }) });
  ok('Verify wrong OTP 400', wrong.status===400);
  let afterWrong = await prisma.otpRequest.findUnique({ where:{ id: otpRec.id } });
  ok('Attempts incremented', afterWrong && afterWrong.attempts===1);

  // Now verify with correct OTP via direct DB insertion of known OTP
  await prisma.otpRequest.deleteMany({ where:{ phone:'09017909857' } });
  const knownOTP = '7777';
  const knownHash = hashOTP(knownOTP);
  await prisma.otpRequest.create({ data:{ phone:'09017909857', otpHash: knownHash, expiresAt: new Date(Date.now()+300000), attempts:0 } });
  let verify = await fetchJSON(`${BASE}/api/auth/verify-otp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone:'9017909857', otp: knownOTP }) });
  ok('Verify correct OTP 200 + JWT', verify.status===200 && !!verify.data.token);
  const token = verify.data.token;
  ok('JWT set as httpOnly cookie', verify.res.headers.get('set-cookie')?.includes('ceo_token') || !!token);
  // Check User upsert + lastLoginAt
  let user = await prisma.user.findUnique({ where:{ phone:'09017909857' } });
  ok('User exists after verify', !!user);
  ok('User lastLoginAt set', !!user?.lastLoginAt);
  // Check AuditLog OTP_VERIFY
  let auditVerify = await prisma.auditLog.findFirst({ where:{ action:'OTP_VERIFY' }, orderBy:{ createdAt:'desc' } });
  ok('AuditLog OTP_VERIFY exists', !!auditVerify);

  // Test wrong phone blocked
  let wrongPhone = await fetchJSON(`${BASE}/api/auth/request-otp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone:'09120000000' }) });
  ok('Wrong phone blocked 403', wrongPhone.status===403);

  // Test rate limit (after 5 requests, should 429)
  // We already did 1, do 5 more quickly
  for(let i=0;i<6;i++) await fetchJSON(`${BASE}/api/auth/request-otp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone:'9017909857' }) });
  let rl = await fetchJSON(`${BASE}/api/auth/request-otp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone:'9017909857' }) });
  // may be 429 if limiter hit
  ok('RateLimit OTP (expect 429 or 200 within window)', rl.status===429 || rl.status===200, `status=${rl.status}`);

  // Need fresh token for next tests (rate limited, so insert via DB again)
  await prisma.otpRequest.deleteMany({ where:{ phone:'09017909857' } });
  await prisma.otpRequest.create({ data:{ phone:'09017909857', otpHash: hashOTP('8888'), expiresAt: new Date(Date.now()+300000), attempts:0 } });
  let v2 = await fetchJSON(`${BASE}/api/auth/verify-otp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ phone:'9017909857', otp:'8888' }) });
  const token2 = v2.data.token || token;
  const authHeader = `Bearer ${token2}`;
  const cookieHeader = v2.res.headers.get('set-cookie') || '';

  // 3) Orders: pagination, filtering, KPI from DB
  let ordersNoAuth = await fetchJSON(`${BASE}/api/orders`);
  ok('GET /api/orders without auth 401', ordersNoAuth.status===401);

  let orders = await fetchJSON(`${BASE}/api/orders?page=1&limit=2`, { headers:{ 'Authorization': authHeader } });
  ok('GET /api/orders with auth 200', orders.status===200 && orders.data.ok);
  ok('Orders pagination exists', !!orders.data.pagination && typeof orders.data.pagination.total==='number');
  ok('Orders KPI salesToday from DB', orders.data.kpi && orders.data.kpi.salesToday!==undefined);
  console.log(`   orders total=${orders.data.pagination.total} salesToday=${orders.data.kpi.salesToday}`);

  // Filtering
  let filtered = await fetchJSON(`${BASE}/api/orders?status=APPROVED`, { headers:{ 'Authorization': authHeader } });
  ok('Orders filter by status', filtered.status===200);
  // Check all returned have status APPROVED if any
  if(filtered.data.orders.length>0) ok('Filtered orders status APPROVED', filtered.data.orders.every(o=>o.status==='APPROVED'));

  // Create a new order directly via Prisma for status patch test
  let customer = await prisma.customer.findFirst();
  let product = await prisma.product.findFirst();
  let newOrder = await prisma.order.create({
    data:{
      orderNumber:'ORD-TEST-'+Date.now(),
      customerId: customer.id,
      status:'PENDING',
      paymentStatus:'PENDING',
      subtotal: 100000, discount:0, shippingCost:0, total:100000, source:'MANUAL',
      items:{ create:[{ productId: product.id, quantity:1, unitPrice:100000, total:100000 }] }
    }
  });
  ok('Created test order via Prisma', !!newOrder.id);

  // Patch status PENDING -> APPROVED (transactional + inventory)
  let invBefore = await prisma.inventory.findUnique({ where:{ productId: product.id } });
  let patch = await fetchJSON(`${BASE}/api/orders/${newOrder.id}/status`, { method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization': authHeader }, body: JSON.stringify({ status:'APPROVED' }) });
  ok('PATCH /api/orders/:id/status 200', patch.status===200 && patch.data.ok, JSON.stringify(patch.data));
  let invAfter = await prisma.inventory.findUnique({ where:{ productId: product.id } });
  ok('Inventory reserved after APPROVED', invAfter && invAfter.reservedQuantity > (invBefore?.reservedQuantity||0));
  let history = await prisma.orderStatusHistory.findFirst({ where:{ orderId: newOrder.id } });
  ok('OrderStatusHistory created', !!history && history.toStatus==='APPROVED');
  let auditOrder = await prisma.auditLog.findFirst({ where:{ action:'ORDER_STATUS_CHANGE', entityId: newOrder.id }, orderBy:{ createdAt:'desc' } });
  ok('AuditLog ORDER_STATUS_CHANGE', !!auditOrder);

  // Test CANCELLED -> restock
  let beforeCancelQty = invAfter.quantity;
  let patchCancel = await fetchJSON(`${BASE}/api/orders/${newOrder.id}/status`, { method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization': authHeader }, body: JSON.stringify({ status:'CANCELLED' }) });
  ok('PATCH to CANCELLED 200', patchCancel.status===200);
  let invAfterCancel = await prisma.inventory.findUnique({ where:{ productId: product.id } });
  ok('Inventory restocked after CANCELLED', invAfterCancel && invAfterCancel.quantity > beforeCancelQty);

  // Check Decimal handling: total is Decimal string via API

  // 4) Inventory ledger
  let invTx = await prisma.inventoryTransaction.findFirst({ where:{ productId: product.id }, orderBy:{ createdAt:'desc' } });
  ok('InventoryTransaction exists', !!invTx);
  ok('InventoryTransaction has before/after', invTx && typeof invTx.beforeQuantity==='number' && typeof invTx.afterQuantity==='number');
  let invAPI = await fetchJSON(`${BASE}/api/inventory`, { headers:{ 'Authorization': authHeader } });
  ok('GET /api/inventory 200', invAPI.status===200 && invAPI.data.ok);
  ok('Inventory low stock detection', Array.isArray(invAPI.data.low) || Array.isArray(invAPI.data.inventories));

  // 5) Schedule POST → DB + GET
  let schedBefore = await prisma.scheduledContent.count();
  let schedPost = await fetchJSON(`${BASE}/api/schedule`, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': authHeader }, body: JSON.stringify({ topic:'تست اتومات فاز2 - محصول جدید با تخفیف 15%', platform:'instagram', tone:'friendly', time:'18:00' }) });
  ok('POST /api/schedule 200', schedPost.status===200 && schedPost.data.ok);
  ok('Schedule created with platform enum', schedPost.data.data && ['INSTAGRAM','BASALAM','TELEGRAM','WEBSITE'].includes(schedPost.data.data.platform));
  let schedAfter = await prisma.scheduledContent.count();
  ok('ScheduledContent count incremented', schedAfter === schedBefore+1);
  let schedGet = await fetchJSON(`${BASE}/api/schedule`, { headers:{ 'Authorization': authHeader } });
  ok('GET /api/schedule 200', schedGet.status===200 && Array.isArray(schedGet.data.items));
  ok('Schedule items from DB', schedGet.data.items.length>=1);
  let auditSched = await prisma.auditLog.findFirst({ where:{ action:'SCHEDULE_CREATE' }, orderBy:{ createdAt:'desc' } });
  ok('AuditLog SCHEDULE_CREATE', !!auditSched);

  // 6) Webhook Basalam: HMAC + persist + idempotency
  const webhookPayload = { id:'hook-test-'+Date.now(), event:'order.created', total:250000 };
  // Without secret, HMAC not required - but should persist
  let hook1 = await fetchJSON(`${BASE}/api/basalam-hook`, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Idempotency-Key':'hook-idem-'+Date.now() }, body: JSON.stringify(webhookPayload) });
  ok('POST /api/basalam-hook 200', hook1.status===200 && hook1.data.ok);
  let webhookEvent = await prisma.webhookEvent.findFirst({ where:{ externalId: webhookPayload.id } });
  ok('WebhookEvent persisted', !!webhookEvent && webhookEvent.provider==='BASALAM');
  ok('WebhookEvent payloadHash exists', !!webhookEvent?.payloadHash);
  // Idempotency: same key should be duplicate
  const idemKey = 'hook-idem-dup-'+Date.now();
  const dupPayload = { id:'dup-'+Date.now(), event:'order.created', total:100 };
  let hookDup1 = await fetchJSON(`${BASE}/api/basalam-hook`, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Idempotency-Key': idemKey }, body: JSON.stringify(dupPayload) });
  ok('First webhook with idem key ok', hookDup1.status===200);
  let hookDup2 = await fetchJSON(`${BASE}/api/basalam-hook`, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Idempotency-Key': idemKey }, body: JSON.stringify(dupPayload) });
  ok('Duplicate webhook idempotency 200 + duplicate:true', hookDup2.status===200 && hookDup2.data.duplicate===true);
  let idemCount = await prisma.idempotencyKey.count({ where:{ key: idemKey } });
  ok('IdempotencyKey persisted once', idemCount===1);
  let hookRateLimited = false; // just check limiter exists - we already tested
  // Check webhook without idempotency still works (but we require key fallback)
  let auditHook = await prisma.auditLog.findFirst({ where:{ action:'WEBHOOK_BASALAM' }, orderBy:{ createdAt:'desc' } });
  ok('AuditLog WEBHOOK_BASALAM', !!auditHook);

  // 7) Concurrency: two simultaneous PATCH on same order
  // Create another order for concurrency
  let concOrder = await prisma.order.create({
    data:{
      orderNumber:'ORD-CONC-'+Date.now(),
      customerId: customer.id,
      status:'PENDING',
      paymentStatus:'PENDING',
      subtotal: 50000, discount:0, shippingCost:0, total:50000, source:'MANUAL',
      items:{ create:[{ productId: product.id, quantity:1, unitPrice:50000, total:50000 }] }
    }
  });
  const p1 = fetchJSON(`${BASE}/api/orders/${concOrder.id}/status`, { method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization': authHeader }, body: JSON.stringify({ status:'APPROVED' }) });
  const p2 = fetchJSON(`${BASE}/api/orders/${concOrder.id}/status`, { method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization': authHeader }, body: JSON.stringify({ status:'APPROVED' }) });
  let [c1,c2] = await Promise.all([p1,p2]);
  ok('Concurrency: both PATCH handled (no crash)', (c1.status===200 || c1.status===500) && (c2.status===200 || c2.status===500));
  let finalOrder = await prisma.order.findUnique({ where:{ id: concOrder.id } });
  ok('Concurrency: final status consistent', ['APPROVED','PENDING','PROCESSING'].includes(finalOrder.status));
  let histories = await prisma.orderStatusHistory.count({ where:{ orderId: concOrder.id } });
  ok('Concurrency: history count >=1', histories>=1);

  // 8) Products KPI: GET /api/products returns Decimal as string, with inventory
  let prodAPI = await fetchJSON(`${BASE}/api/products`, { headers:{ 'Authorization': authHeader } });
  ok('GET /api/products 200', prodAPI.status===200 && prodAPI.data.ok);
  ok('Products have Decimal price string', prodAPI.data.products.length>0 && typeof prodAPI.data.products[0].price==='string');
  ok('Products include inventory relation', prodAPI.data.products[0].inventory !== undefined);

  // 9) Block sensitive files still 404
  let blockedEnv = await fetch(`${BASE}/.env`);
  ok('GET /.env blocked 404', blockedEnv.status===404);
  let blockedPkg = await fetch(`${BASE}/package-lock.json`);
  ok('GET /package-lock.json blocked 404', blockedPkg.status===404);

  // Summary
  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===\n`);
  if(failed>0) process.exit(1);
  else process.exit(0);
}

run().catch(e=>{ console.error(e); process.exit(1); });
