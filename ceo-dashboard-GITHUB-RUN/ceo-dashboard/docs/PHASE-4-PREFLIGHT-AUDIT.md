# PHASE 4 — PRE-FLIGHT AUDIT (STEP 0)
**تاریخ:** 2026-09-15 — Amsterdam — Sandbox بعد از Reset
**Master Prompt:** PHASE-4-REAL-INTEGRATIONS-MASTER-PROMPT-FA.md (681 خط, 23 بخش)

## 0) وضعیت محیط فعلی — هشدار

> **Sandbox ریست شده:** `node_modules` حذف شده (طبق snapshot policy) و `psql` / `pg_isready` در PATH نیست. Postgres `ceo_panel` با `DATABASE_URL=postgresql://ceo:ceo_secure_2026@localhost:5432/ceo_panel` فعلاً **در دسترس نیست** تا `npm install` و `DB restore` انجام شود.
> آخرین وضعیت **قبل از ریست** (2026-09-13 00:19): `tests-phase3 79/79 PASS` + `tests-phase2 54/54 PASS` + `Basalam webhook orderCreated:true` + `pg_trgm 4 index` + `KPI داینامیک`.

**اقدام قبل از کدنویسی Phase 4:**
```bash
cd ceo-dashboard && npm install
# سپس DB restore (migration deploy + seed) و server start
# بعد tests-phase2/3 باید دوباره 54/54 و 79/79 شود — Regression اول حل شود
```

---

## 1) چه چیزی واقعاً وجود دارد؟ (Verified از فایل‌ها)

### package.json
- `name: ceo-panel-secure 2.0.0` — `main: electron.js`
- `scripts: start/dev/desktop/android/test`
- `dependencies: express 4.22, @prisma/client 5.22, prisma 5.22, helmet 8.3, cors 2.8, express-rate-limit 8.7, jsonwebtoken 9.0, zod 4.6, cookie-parser, dotenv` — **بدون** `node-telegram-bot-api`, `axios`, `bullmq`, `ioredis`, `winston` (برای Phase 4 باید اضافه شود)
- `devDependencies: electron, capacitor`

### server.js — 1088 خط — Phase 3 کامل
- 37 route — `app.get/post/patch` شمارش شد
- **Basalam Hook واقعی (مرحله 2 تکمیل امروز):** `POST /api/basalam-hook` با `webhookLimiter 60/min` + `verifyBasalamWebhook (HMAC SHA256)` + `IdempotencyKey scope:basalam-webhook` + `WebhookEvent @unique(provider,externalId)` + **Transaction** کامل `Customer→Order→OrderItems→Inventory SALE→Timeline→Audit` + `orderCreated:true` Verified
- **CRM کامل Phase 3:** 18 API جدید — `GET /api/customers?search&status&source&tag&page&limit` با `normalizedPhone` + `POST/PATCH /api/customers` + `GET .../timeline|orders|messages|leads|followups` + `POST .../notes|tags|merge` + `GET .../360` + `leads` + `messages` + `followups` — همه `verifyJWT + requirePerm` + `Zod` + `escapeXSS` + `PII masking` + `Request-ID`
- **Security:** `helmet (CSP off)` + `CORS whitelist (ALLOWED_DOMAIN + localhost)` + `apiLimiter 1000/min` + `otpLimiter 100/min` + `blocked .env/.git/package-lock.json → 404` + `static dotfiles:deny`
- **RBAC:** `PERMISSIONS: CEO=* | ADMIN=customers.*|messages.*|leads.*|followups.*|orders.*|audit.read | MANAGER| SALES| SUPPORT` — `requirePerm()` backend-enforced
- **Helpers:** `normalizePhone` (فارسی/عربی→انگلیسی, +98), `calculateLeadScore`, `maskPhone/maskEmail`, `signJWT`, `generateOTP/hashOTP`
- **Health:** `GET /api/health` با `integrations: {basalam, telegram, instagram}` — telegram/instagram فعلاً `false` (چون TOKEN خالی)

### prisma/schema.prisma — 23 مدل / 13 Enum
- Enums: `Role (9) | OrderStatus (12) | PaymentStatus | Source (6) | InventoryTransactionType | ScheduledContentStatus/Platform | CustomerStatus (7) | LeadStatus (8) | FollowUpStatus/Type | MessageStatus | IdentityChannel (6)`
- Models: `User, Session, OtpRequest, Customer (+normalizedPhone unique), CustomerIdentity @@unique(channel,externalId), Tag, CustomerTag @@unique, CustomerNote, CustomerTimeline, Message, Lead, FollowUp, Product, Inventory @unique(productId), InventoryTransaction, Order, OrderItem, OrderStatusHistory, Payment, IdempotencyKey @@unique(key,scope), WebhookEvent @@unique(provider,externalId), ScheduledContent, AuditLog`
- **Indexes:** `customers__trgm ×4` (امروز), `customers_status_idx`, `phone_idx`, `normalizedPhone_idx`, `message channel/createdAt`, `lead score/status`, `followUp scheduledAt`
- **Migrations:** `20260912234223_init` + `202609130000_phase3_crm` + `202609130001_pg_trgm` (همه در `prisma/migrations/`) — `migration_lock.toml` حاضر

### .env.example
- حاضر و کامل: `PORT, NODE_ENV, ALLOWED_DOMAIN, JWT_SECRET, ALLOWED_PHONE=09017909857, OTP_*, BASALAM_TOKEN/STORE_URL, TELEGRAM_BOT_TOKEN/ADMIN_CHAT_ID, INSTAGRAM_ACCESS_TOKEN, KAVENEGAR_API_KEY, BASALAM_WEBHOOK_SECRET, DATABASE_URL` — **Secret واقعی در docs نیست**

### .env واقعی (masked)
- `DATABASE_URL=postgresql://ceo:ceo_secure_2026@localhost:5432/ceo_panel`
- `BASALAM_TOKEN=***masked*** (eyJty... 500 scopes)` — **موجود**
- `TELEGRAM_BOT_TOKEN=` **خالی** — `TELEGRAM_ADMIN_CHAT_ID=` خالی — `TELEGRAM_WEBHOOK_SECRET=` خالی
- `INSTAGRAM_ACCESS_TOKEN=` **خالی**
- `JWT_SECRET=ef50e6ca...` — موجود
- `BASALAM_WEBHOOK_SECRET=` **خالی** (پس verifyBasalamWebhook bypass می‌شود — باید در Production پر شود)
- `ALLOWED_PHONE=09017909857`, `ALLOWED_DOMAIN=panel.yourstore.ir`

### docs/
- `PHASE-3-CRM.md` (4.1K) — Identity/Tag/Note/Lead/FollowUp/Timeline/Search/360/RBAC
- `API-CRM.md` (5.4K) — 18 API با Zod
- `SECURITY-CRM.md` (4K) — RBAC/IDOR/Mass/XSS/PII/RateLimit/Concurrency
- `CRM-LIFECYCLE.md` (3.4K) — State Machine
- `TEST-REPORT-PHASE-3.md` (2.8K) — 79/79
- `PHASE-3-REPORT.md` (17K, 11 بخش, 🟢 GO)
- `FINAL-COMPLETE-REPORT-2026-09-13.md` (12K) — 4 مرحله نهایی‌سازی امروز
- **برای Phase 4 ناقص:** `PHASE-4-INTEGRATIONS.md`, `INTEGRATION-ARCHITECTURE.md`, `TELEGRAM.md`, `INSTAGRAM.md`, `BASALAM.md`, `WEBSITE-INTEGRATION.md`, `WEBHOOK-SECURITY.md`, `INTEGRATION-API.md`, `TEST-REPORT-PHASE-4.md` — **هیچکدام وجود ندارد — باید ساخته شود**

### tests
- `tests-phase2.js` (15K) — انتظار 54/54 — آخرین بار 54/54 (2026-09-13)
- `tests-phase3.js` (25K) — انتظار 79/79 — آخرین بار 79/79 (بعد از otpLimiter 100)
- `test-basalam-real.js` — تست واقعی باسلام با `Bearer TOKEN` — کار می‌کند (نیاز به TOKEN)
- `tests-phase4.js` — **وجود ندارد — باید ساخته شود (46 تست §15)**

### index.html — 93K + CRM
- Login OTP via `/api/auth/*` — JWT httpOnly — `escapeHtml`
- KPIs داینامیک (امروز): `kpi-profit`, `kpi-customers` از DB
- CRM Card: `customerSearch, customerStatusFilter, customersList, customersPagination, customerModal, crm360Modal` — `loadCustomers, debouncedSearch, openCustomer360, addTag/addNote/merge` — همه DB
- Integrations Modal: `intModal` با 3 کارت (اینستا/تلگرام/باسلام) — **فعلاً Mock UI** — `connectInsta()` با `setTimeout` شبیه‌سازی — **باید به وضعیت واقعی Backend وصل شود (§12)**
- Personnel: `personnel[]` با 7 نفر — AI دمو — خارج CRM

---

## 2) چه چیزی ناقص است؟ (برای Phase 4)

| حوزه | وضعیت | جزئیات |
|---|---|---|
| **Telegram Adapter** | ❌ Missing | هیچ `POST /api/integrations/telegram/webhook` — هیچ `verifyTelegram()`, `TelegramService.sendMessage()`, `resolveIdentity(TELEGRAM)`, `Idempotency provider=TELEGRAM` |
| **Instagram OAuth + Webhook** | ❌ Missing | هیچ `GET /api/integrations/instagram/connect|callback` — هیچ `verifyInstagramSignature`, token lifecycle, re-auth |
| **Basalam تکمیل** | ⚠️ Partial | Hook Order واقعی امروز کامل شد، ولی `Product mapping` (externalProductId ↔ internalProductId) + `Order status sync` (RECEIVED→DELIVERED) + `Inventory drift` (Product.stock vs Inventory.quantity) هنوز حل نشده (§5) |
| **Website Chat** | ❌ Missing | هیچ `POST /api/integrations/website/messages` — هیچ sessionId/phone/email resolver |
| **Unified Pipeline** | ❌ Missing | هیچ `Inbound Event → Verify→Validate→Idempotency→Normalize→ResolveCustomer→Message→Timeline→Lead→FollowUp→AI` canonical pipeline — هر کانال جدا Logic دارد |
| **Outbound Architecture** | ❌ Missing | هیچ `QUEUED/SENDING/SENT/DELIVERED/FAILED` + `Permission Check + Channel Adapter + Provider API + Audit` |
| **Idempotency+Retry+RateLimit** | ⚠️ Partial | Inbound `IdempotencyKey` برای Basalam هست، ولی برای TELEGRAM/INSTAGRAM/WEBSITE نه — Retry با exponential backoff نه — RateLimit فقط in-memory (آماده Redis نیست) |
| **Webhook Security** | ⚠️ Partial | Basalam HMAC هست، ولی Telegram secret validation + Instagram signature + replay/timestamp + size limit + 401/403 یکسان نیست |
| **RBAC جدید** | ❌ Missing | هیچ `integration.read/manage`, `integration.telegram.send`, `integration.instagram.publish`, `integration.basalam.sync` — و Tool Layer برای Phase 5 (`customer.search` etc.) |
| **Integration Dashboard** | ❌ Mock | Modal فقط `setTimeout` — هیچ `CONNECTED/DEGRADED/DISCONNECTED/REAUTH_REQUIRED` واقعی از `GET /api/integrations/status` |
| **Observability** | ⚠️ Partial | `requestId, channel, duration` در log هست، ولی `provider status, error code, PII masking` برای integration نه |
| **Tests Phase 4** | ❌ Missing | 0/46 — باید 46 تست §15 ساخته شود — Regression 47/48 باید حفظ شود |
| **Docs Phase 4** | ❌ Missing | 9 فایل §19 |
| **DB برای Integrations** | ⚠️ Review | `CustomerIdentity` و `Message` و `WebhookEvent` کافی است، ولی شاید `IntegrationState` (token, expiration, webhook status, lastSync, health) برای داشبورد نیاز باشد — Migration Safety §14 باید backup + diff + test |

---

## 3) چه چیزی باید Extend شود؟ (بدون شکستن Phase 3)

- **Extend، نه Rewrite:**
  - `server.js` — افزودن Adapters به‌صورت `lib/integrations/{telegram,instagram,basalam,website}.js` + `lib/integrations/pipeline.js` + `lib/integrations/idempotency.js` — جدا نگه داشتن از CRM core
  - `prisma/schema.prisma` — احتمالاً `IntegrationAccount` / `IntegrationState` برای `token, expiration, webhook status, health` (اگر شد بدون تغییر Customer/Order core) — Migration جدید `202609150000_phase4_integrations` با `backup` و `prisma migrate status`
  - `.env.example` — افزودن `TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_URL, INSTAGRAM_CLIENT_ID/SECRET/REDIRECT_URI, INSTAGRAM_WEBHOOK_VERIFY_TOKEN`
  - `index.html` — `openIntegrations()` باید به `GET /api/integrations/status` واقعی وصل شود (جای `setTimeout`)
  - `package.json` — افزودن `axios` (یا `node-fetch` native) برای Provider calls — **بدون** `node-telegram-bot-api` سنگین اگر webhook کافی است
- **حفظ شود:** `Customer, Identity, Message, Lead, FollowUp, Timeline, Order, Inventory, Audit, IdempotencyKey, WebhookEvent` — هیچ تغییر destructive بدون approval

---

## 4) چه چیزی نباید دستکاری شود؟ (Source of Truth)

**ممنوع دست زدن (Regression Risk):**
- `Customer.normalizedPhone unique` + `CustomerIdentity @@unique(channel,externalId)` + `Message/Lead/FollowUp` enums + `Timeline eventTypes`
- `Order` transaction (status + inventory ledger) + `Payment Decimal`
- `IdempotencyKey @unique(key,scope)` + `WebhookEvent @unique(provider,externalId)`
- `RBAC PERMISSIONS` + `verifyJWT` + `maskPhone/maskEmail` + `Request-ID` + `Zod`
- `tests-phase2.js` + `tests-phase3.js` — باید تا آخر 54/54 و 79/79 بماند — هر تغییر باید ابتدا Regression را پاس کند
- `normalizePhone` + `calculateLeadScore` + `escapeXSS`
- `.env` واقعی — هرگز به Git یا frontend نرود

---

## 5) Regression انتظاری — قبل از شروع Phase 4

| Test Suite | Expected | آخرین بار | الان (بدون node_modules/DB) |
|---|---|---|---|
| Phase 2 | 54/54 | 54/54 (2026-09-13 00:19) | ❌ Cannot run — `MODULE_NOT_FOUND` + `psql not found` — نیاز به `npm install` + DB restore |
| Phase 3 | 79/79 | 79/79 (2026-09-13 00:19) | ❌ Cannot run — همان |

**قدم بعدی اجباری:** `npm install` + `DB restore` → سپس `node tests-phase2.js && node tests-phase3.js` → اگر هرکدام FAIL، اول Fix — سپس شروع Phase 4.

---

## 6) Credential / API Access — NOT VERIFIED

- `BASALAM_TOKEN` ✅ موجود و Verified (eyJ... 500 scopes) — `GET /v1/users/me` تست شده در `test-basalam-real.js`
- `TELEGRAM_BOT_TOKEN` ❌ خالی — NOT VERIFIED — نیاز به `@BotFather` — تا آن موقع Telegram status = `DISCONNECTED`
- `TELEGRAM_WEBHOOK_SECRET` ❌ خالی — NOT VERIFIED
- `INSTAGRAM_ACCESS_TOKEN` ❌ خالی — `INSTAGRAM_CLIENT_ID/SECRET` ❌ — NOT VERIFIED — نیاز به `developers.facebook.com` — تا آن موقع Instagram = `REAUTH_REQUIRED`
- `BASALAM_WEBHOOK_SECRET` ❌ خالی — الان bypass — برای Production باید پر شود

**طبق §23 گزارش نهایی:** هرجا credential نیست، `NOT VERIFIED — CREDENTIAL/API ACCESS REQUIRED` گزارش می‌شود و تست جعلی ساخته نمی‌شود.

---

## 7) Architecture پیشنهادی برای Phase 4 (برای تایید)

```
Provider Webhook (Telegram/Instagram/Basalam/Website)
  → POST /api/integrations/:channel/webhook (verify + zod + rateLimit + requestId)
  → Idempotency (channel+externalEventId)
  → Normalize (parseInbound)
  → Identity Resolver (channel, externalId → CustomerIdentity)
  → Customer Resolver (normalizedPhone/email/session → Customer)
  → Message.create (channel, direction:INBOUND, externalMessageId unique, status:RECEIVED)
  → Timeline (MESSAGE_RECEIVED)
  → Lead Detection (intent→ Lead + Scoring)
  → FollowUp Recommendation
  → Audit
  → 200 fast response

Outbound: POST /api/integrations/:channel/send (RBAC) → QUEUED → SENDING → SENT/FAILED → Timeline + Audit
```

هر Adapter جدا: `lib/integrations/telegram.js`, `instagram.js`, `basalam.js`, `website.js` + `pipeline.js` unified.

---

## 8) Checklist DeDoN Phase 4 — قبل از شروع

- [ ] npm install + DB restore + Phase2/3 PASS
- [ ] Backup
- [ ] Telegram webhook + identity + inbound + outbound + idempotency
- [ ] Instagram OAuth + webhook + identity + inbound
- [ ] Basalam product/order/inventory تکمیل بدون Regression
- [ ] Website messages endpoint
- [ ] Unified pipeline
- [ ] Customer/Identity Resolver
- [ ] Outbound architecture + status
- [ ] Webhook security + replay
- [ ] RBAC integration.*
- [ ] Integration dashboard واقعی
- [ ] Health checks
- [ ] Docs 9 فایل
- [ ] Tests 46 + Regression 54/54 + 79/79
- [ ] Zero Mock + Real E2E

---

**آماده برای تایید شما:** اگر تایید کنید، با `npm install` و `DB restore` شروع می‌کنم و سپس Adapterها را یکی‌یکی (اول Telegram، بعد Instagram، بعد Website) می‌سازم — بدون دست زدن به CRM core.

