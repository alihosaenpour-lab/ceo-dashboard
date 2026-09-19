# PHASE 4 — REAL INTEGRATIONS MASTER PROMPT (FA)
## CEO Panel | فروشگاه جنرال
### هدف: اتصال واقعی Telegram + Instagram + Basalam + Website به CRM موجود

این Master Prompt را مستقیماً به Claude/Arina بده. قبل از هر تغییر، کد واقعی پروژه را Audit کن و وضعیت فعلی Phase 2 و Phase 3 را حفظ کن.

## 0) قوانین غیرقابل مذاکره

Phase 3 باید Source of Truth باقی بماند:
- Customer، Identity، Message، Lead، Follow-up و Timeline واقعی در PostgreSQL
- Order و Inventory واقعی
- RBAC، Audit، Request-ID و PII masking فعال
- AI و Integration هرگز مستقیم DB را دور نمی‌زنند.

ممنوع:
- Mock integration
- Fake webhook / fake success
- setTimeout برای Business Logic
- localStorage به‌عنوان Source of Truth
- hardcoded customer/message/order/token
- secret در frontend یا Git
- bypass کردن RBAC
- direct AI → DB
- duplicate Message/Order/Webhook
- log کردن PII خام

---

# 1) STEP 0 — PRE-FLIGHT AUDIT

قبل از کدنویسی این موارد را بررسی کن:
package.json، server.js، prisma/schema.prisma، migrations، .env.example،
docs/PHASE-3-CRM.md، docs/API-CRM.md، docs/SECURITY-CRM.md،
docs/CRM-LIFECYCLE.md، tests-phase2.js، tests-phase3.js،
Basalam integration، Auth/RBAC، Message/Identity/Customer، Audit و WebhookEvent و index.html.

گزارش بده:
1. چه چیزی واقعاً وجود دارد؟
2. چه چیزی ناقص است؟
3. چه چیزی باید Extend شود؟
4. چه چیزی نباید دستکاری شود؟

قبل از شروع:
- Phase 2: انتظار 54/54
- Phase 3: انتظار 79/79

هر Regression را ابتدا حل کن.

---

# 2) معماری

معماری:

Integration Adapters
→ Verify/Validate
→ Idempotency
→ Normalize
→ Identity Resolver
→ Customer Resolver
→ Message
→ Timeline
→ Lead Detection/Scoring
→ Follow-up
→ Future AI Orchestrator

کانال‌ها:
- TELEGRAM
- INSTAGRAM
- BASALAM
- WEBSITE

هر Adapter مستقل باشد تا بعداً WhatsApp/Email بدون بازنویسی CRM اضافه شود.

Interface مفهومی:
- channel
- verifyWebhook()
- parseInbound()
- resolveIdentity()
- normalizeMessage()
- sendMessage()
- publish()
- healthCheck()

---

# 3) Telegram — REAL

Secretها فقط server-side:
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_WEBHOOK_URL=

Endpoint:
POST /api/integrations/telegram/webhook

مراحل:
1. Secret validation
2. Request ID
3. Zod validation
4. update_id extraction
5. Idempotency
6. Identity resolution
7. Message normalization
8. Message persistence
9. Timeline
10. Audit
11. پاسخ سریع HTTP

Identity:
channel=TELEGRAM
externalId=Telegram user/chat ID

داده‌های قابل نگهداری:
telegram user id، chat id، username، first name، last name، metadata

اگر Customer موجود است به همان وصل شود؛ اگر identity مبهم است auto-merge ممنوع.

Outbound:
TelegramService.sendMessage()
- timeout
- محدودیت retry
- transient error handling
- rate limit
- response validation
- Audit

هیچ token در frontend یا log قرار نگیرد.

---

# 4) Instagram — REAL OFFICIAL API

فقط API رسمی Meta/Instagram.
ممنوع:
- scraping
- password automation
- unofficial API

OAuth:
GET /api/integrations/instagram/connect
GET /api/integrations/instagram/callback

OAuth token فقط server-side، با expiration tracking و re-auth strategy.

Webhook:
POST /api/integrations/instagram/webhook

الزامی:
- signature verification
- payload validation
- normalization
- idempotency
- Identity resolution
- Message
- Timeline
- Audit

Identity:
channel=INSTAGRAM
externalId=scoped Instagram user ID

Matching:
1. exact external identity
2. linked identity
3. controlled matching
4. ambiguity → Human Review

Auto-merge ممنوع.

---

# 5) Basalam — COMPLETE REAL

Phase 3 Basalam Order/Webhook واقعی را خراب نکن.

قبل از تغییر، این‌ها را بررسی کن:
WebhookEvent، IdempotencyKey، Order، OrderItems، Inventory،
Customer، Identity، Timeline، Audit و transaction.

هر event:
Verify → Validate → Normalize → Idempotent → Transactional Persist

Product mapping:
externalProductId
internalProductId
title
price
stock
status
updatedAt

ریسک شناخته‌شده:
Product.stock در برابر Inventory.quantity.
Source of Truth را مشخص کن؛ در صورت تصمیم معماری، Inventory.quantity مرجع اصلی باشد و drift حذف شود.

Order mapping:
RECEIVED
CONFIRMED
PROCESSING
SHIPPED
DELIVERED
CANCELLED
RETURNED

---

# 6) Website Chat / Lead Entry

Endpoint پیشنهادی:
POST /api/integrations/website/messages

Input:
sessionId، customerId?، name?، phone?، email?، message، metadata?

Zod validation اجباری.

Identity resolution:
1. customerId معتبر و authorized
2. normalized phone
3. normalized email
4. session identity
5. Customer جدید

ابهام → Human Review.

---

# 7) Unified Message Pipeline

تمام کانال‌ها:

Inbound Event
→ Verify
→ Validate
→ Idempotency
→ Normalize
→ Resolve Customer
→ Create Message
→ Timeline
→ Lead Detection
→ Lead Scoring
→ Follow-up Recommendation
→ Future AI Orchestrator

Integration نباید Business Logic تکراری بسازد و مستقیماً به Agent وصل نشود.

Canonical Message:
id، customerId، channel، direction، externalMessageId،
text، metadata، status، receivedAt، createdAt

metadata محدود و schema-controlled باشد. raw payload نامحدود در DB ذخیره نشود.

---

# 8) Outbound Architecture

OUTBOUND
→ Permission Check
→ Channel Adapter
→ Provider API
→ Provider Message ID
→ Message Update
→ Timeline
→ Audit

Status:
QUEUED / SENDING / SENT / DELIVERED / FAILED

---

# 9) Idempotency + Retry + Rate Limit

Idempotency:
channel + externalEventId
و برای Message:
channel + externalMessageId

Race condition تست شود.

Rate limit:
1. inbound webhook
2. outbound provider calls
3. customer/session

Single-instance memory قابل قبول است؛ معماری باید آماده Redis باشد.

Retry فقط برای:
- timeout
- 429
- 5xx

عدم retry:
- 400
- invalid token
- permission denied
- invalid payload

Exponential backoff و سقف retry اجباری.
Failure نهایی → FAILED + Audit + observability event.

---

# 10) Webhook Security

هر Webhook:
- signature verification
- replay/timestamp protection در صورت پشتیبانی provider
- body validation
- size limit
- rate limit
- idempotency
- request ID
- audit

Webhook جعلی → 401/403.
Webhook معتبر ولی duplicate → بدون اجرای دوباره Business Logic.

---

# 11) RBAC + Tool Readiness

Permissionهای پیشنهادی:
integration.read
integration.manage
integration.telegram.send
integration.instagram.publish
integration.basalam.sync

Backend-enforced.

Tool Layer برای Phase 5 آماده شود:
customer.search
customer.get
identity.resolve
message.get
lead.create
lead.get
lead.update
followup.create
product.search
inventory.check
order.get

Agent هرگز Prisma/SQL/DB connection را مستقیم نبیند.

---

# 12) Integration Dashboard

برای هر کانال وضعیت واقعی نمایش بده:

CONNECTED
DEGRADED
DISCONNECTED
ERROR
REAUTH_REQUIRED

Telegram:
Bot username، webhook status، last event، last error، health، reconnect

Instagram:
account، connection، token status، expiration، webhook، last event

Basalam:
token status، API health، last sync، webhook، last order event

Website:
chat endpoint، event count، last message

Secret خام هرگز نمایش داده نشود.

---

# 13) Observability

برای هر Integration:
requestId، channel، event type، duration، success/failure،
provider status، error code

PII masking فعال بماند.
متن کامل پیام مشتری در log ممنوع.

---

# 14) Database / Migration Safety

قبل از Migration:
1. backup
2. schema diff
3. migration review

بعد:
1. prisma migrate status
2. migration test
3. existing data integrity
4. Phase 2 tests
5. Phase 3 tests
6. Phase 4 tests

Migration destructive بدون دلیل و approval ممنوع.

---

# 15) تست‌های الزامی Phase 4

### Telegram
1 valid webhook
2 invalid secret
3 invalid payload
4 duplicate update
5 new customer
6 existing customer
7 identity mapping
8 message persistence
9 outbound message
10 provider failure
11 retry
12 rate limit

### Instagram
13 OAuth state validation
14 callback validation
15 webhook signature
16 duplicate event
17 identity mapping
18 inbound message
19 outbound where API permits
20 expired token

### Basalam
21 valid webhook
22 invalid signature
23 duplicate webhook
24 order creation
25 inventory transaction
26 customer mapping
27 product mapping
28 status update
29 API timeout
30 retry

### Website
31 valid message
32 invalid payload
33 phone normalization
34 customer resolution
35 duplicate session/message
36 lead creation

### Security
37 IDOR
38 RBAC
39 XSS
40 mass assignment
41 token leakage
42 webhook spoofing
43 replay
44 rate-limit bypass
45 oversized payload
46 unauthorized outbound send

### Regression
47 Phase 2 all tests
48 Phase 3 all tests

هدف:
0 Failed
0 Skipped
0 Mock

---

# 16) End-to-End واقعی

## A — Telegram Sales
Customer
→ Telegram
→ Webhook
→ Identity
→ Message
→ Lead
→ CRM
→ پاسخ خروجی
→ Timeline

## B — Instagram
Instagram
→ Webhook
→ Customer Resolver
→ Message
→ Lead
→ CRM

## C — Basalam
Basalam
→ Webhook
→ Customer
→ Order
→ OrderItems
→ Inventory
→ Timeline
→ Audit

## D — Website
Website
→ Message
→ Customer
→ Lead
→ CRM

تمام مراحل باید واقعی باشند.

---

# 17) Failure Testing

عمداً تست کن:
invalid token، provider timeout، duplicate webhook،
duplicate message، malformed JSON، missing customer،
conflicting identity، 429، 500، network failure،
unauthorized user، expired OAuth.

Fake success ممنوع.

---

# 18) Frontend Rules

Frontend فقط API client باشد.

ممنوع:
- integration truth در localStorage
- token در browser
- fake connected
- fake order/message/customer
- hardcoded provider response

UI فقط وضعیت واقعی Backend را نمایش دهد.

---

# 19) Documentation

ایجاد/به‌روزرسانی:
docs/PHASE-4-INTEGRATIONS.md
docs/INTEGRATION-ARCHITECTURE.md
docs/TELEGRAM.md
docs/INSTAGRAM.md
docs/BASALAM.md
docs/WEBSITE-INTEGRATION.md
docs/WEBHOOK-SECURITY.md
docs/INTEGRATION-API.md
docs/TEST-REPORT-PHASE-4.md
.env.example

Secret واقعی داخل docs ممنوع.

---

# 20) Production Readiness

برای Production:
- HTTPS
- Nginx
- SSL
- PM2
- production env
- public webhook URL
- firewall
- health endpoint
- backup
- log rotation

Telegram/Instagram webhook باید از اینترنت واقعی قابل دسترسی و تست باشد.

---

# 21) NO-GO CONDITIONS

در صورت وجود هرکدام:
🔴 NO-GO

- Mock integration
- fake webhook
- secret frontend
- token in Git
- missing signature verification
- duplicate order/message
- broken identity mapping
- missing RBAC
- missing idempotency
- fake success
- Phase 2 regression
- Phase 3 regression
- provider integration only simulated
- unverified production webhook

---

# 22) Definition of Done

[ ] Telegram واقعی
[ ] Telegram webhook
[ ] Telegram identity mapping
[ ] Telegram inbound
[ ] Telegram outbound
[ ] Telegram idempotency
[ ] Instagram official OAuth
[ ] Instagram webhook
[ ] Instagram identity mapping
[ ] Instagram inbound
[ ] Instagram outbound where API permits
[ ] Instagram token lifecycle
[ ] Basalam webhook regression-free
[ ] Basalam product mapping
[ ] Basalam order sync
[ ] Basalam inventory mapping
[ ] Website message endpoint
[ ] Unified message pipeline
[ ] Customer Resolver
[ ] Identity Resolver
[ ] Outbound architecture
[ ] Webhook security
[ ] Signature verification
[ ] Replay/duplicate protection
[ ] Rate limit
[ ] Retry/backoff
[ ] RBAC
[ ] Audit
[ ] PII masking
[ ] Request ID
[ ] Integration dashboard
[ ] Health checks
[ ] Documentation
[ ] Phase 2: 54/54
[ ] Phase 3: 79/79
[ ] Phase 4: all PASS
[ ] Zero Mock
[ ] Real E2E

---

# 23) گزارش نهایی اجباری

در پایان گزارش دقیق بده:

A — Architecture
B — Files Changed
C — Database / Migrations
D — APIs
E — Telegram status + tests
F — Instagram status + tests
G — Basalam status + tests
H — Website status + tests
I — Security tests
J — Test Results:
Phase 2: X/X
Phase 3: X/X
Phase 4: X/X
K — Production remaining tasks
L — Known Risks
M — GO / NO-GO

اگر credential یا API رسمی در دسترس نیست:
NOT VERIFIED — CREDENTIAL/API ACCESS REQUIRED

هرگز برای سبز شدن تست، نتیجه جعلی نساز.

## هدف نهایی Phase 4

Customer واقعی از Telegram / Instagram / Website وارد شود،
در CRM واقعی ثبت شود،
Lead واقعی ایجاد شود،
Order واقعی از Basalam وارد شود،
Timeline واقعی ساخته شود،
و CEO بتواند همه را از یک داشبورد کنترل کند.

پس از تکمیل Phase 4:
PHASE 5 — AI CORE + LLM GATEWAY + RAG + MODEL ROUTER
