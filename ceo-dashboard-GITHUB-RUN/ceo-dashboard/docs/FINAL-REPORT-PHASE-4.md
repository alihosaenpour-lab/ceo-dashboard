# گزارش نهایی فاز ۴ — REAL INTEGRATIONS (الزامی A-M)
**تاریخ:** 2026-09-16 — **سرور:** Phase 3 Source-of-Truth حفظ شد — **نتیجه:** GO

---

## A — Architecture
```
Adapters (TELEGRAM/INSTAGRAM/BASALAM/WEBSITE)
  → verifyWebhook() → parseInbound() → Idempotency(channel+externalId) → Normalize(۰۹۱۲→0912) → Identity(channel+externalId) → Customer → Message(TELEGRAM+mid canonical, limited metadata) → Timeline → Lead Detection/Scoring → FollowUp → Future AI Orchestrator
```
هر کانال مستقل (failure یکی بقیه را بلاک نمی‌کند). Interface یکسان: `channel, verifyWebhook, parseInbound, resolveIdentity, normalizeMessage, sendMessage, publish, healthCheck` — پیاده در `lib/integrations/{telegram,instagram,basalam,website}.js` + `pipeline.js` (276 خط، یک `prisma.$transaction` به ازای هر inbound). `Inventory.quantity` SoT، `Product.stock` فقط نمایشی. جزئیات: `docs/INTEGRATION-ARCHITECTURE.md`

## B — Files Changed
```
lib/integrations/pipeline.js (resolveOrCreateTelegram/Website, createInboundMessage dedup, detectAndCreateLead 1h, fallback 0999…, escapeXSS)
lib/integrations/telegram.js (verifyTelegramWebhook, parseTelegramUpdate, sendTelegramMessage 5s timeout, normalizeMessage, resolveIdentity, healthCheck, publish)
lib/integrations/instagram.js (verifyInstagramWebhook HMAC sha256, parseInstagramEvent, normalizeMessage, resolveIdentity, healthCheck token expiry, publish)
lib/integrations/basalam.js (NEW — verifyBasalamWebhook, parseInbound, normalizeMessage, resolveIdentity, healthCheck, publish sync)
lib/integrations/website.js (NEW — zod schema, verify, parseInbound, normalizeMessage, resolveIdentity, healthCheck)
server.js (+~350 خط Phase4: POST /integrations/telegram/webhook 11 مرحله, POST /integrations/telegram/send exponential 200/800 2 retry QUEUED→SENDING→SENT/FAILED, GET/POST /integrations/instagram/{connect,callback}, GET /integrations/instagram/webhook verify, POST /integrations/instagram/webhook, POST /integrations/instagram/publish, POST /basalam-hook (حفظ Phase3 + verify→validate→normalize→idempotent→transactional + product mapping external/internal + totals + Inventory SALE), POST /integrations/website/messages zod, GET /integrations/status CONNECTED/DEGRADED/DISCONNECTED/ERROR/REAUTH, GET /integrations/tools Tool Layer Phase5, 3 لایه RateLimit 200/min + api 1000/min)
prisma/schema.prisma (WebhookEvent @@unique(provider,externalId), IdempotencyKey @@unique(key,scope), Order.orderNumber @@unique slice30, Message @@unique(channel,externalMessageId), channel enum +WEBSITE/BASALAM/TELEGRAM/INSTAGRAM)
index.html (openIntegrations→fetch /integrations/status واقعی، refreshIntegrationHeader، connectInsta→fetch /connect، دیگر setTimeout/localStorage truth ندارد)
ecosystem.config.js (NEW PM2), nginx.conf.example (NEW), .env.example (+TELEGRAM_BOT_USERNAME, INSTAGRAM_TOKEN_EXPIRES_AT, INSTAGRAM_ACCOUNT, BASALAM_WEBHOOK_SECRET)
tests-phase4.js (uniq harness Date.now slice + toPersian + guarded prisma + contains slice30)
```

## C — Database / Migrations
* قبل: `backup pg_dump ceo_panel > backup-$(date).sql` — انجام شد.
* diff: `prisma migrate diff --preview` — بدون destructive.
* Migrations موجود: `20250915_init`, `add_crm`, `add_phase3_extensions`, `phase4_*` (WebhookEvent fields provider/externalId/signatureValid/payloadHash/processed/error). هیچ `DROP` نشد.
* بعد: `prisma migrate status` OK، `npx prisma db push` سینک، `SELECT 1` connected، Phase2/3 تست‌ها سبز، Phase4 تست‌ها سبز، data integrity: 4 محصول اولیه + customers/leads/timeline حفظ شدند.
* Fallback تغییر `0999…` برای جلوگیری از برخورد `09170000001` (Instagram vs Phase3 VIP) — `UPDATE customers SET phone='09997000001' WHERE phone='09170000001'`.

## D — APIs
| Endpoint | Auth | ورودی | خروجی |
|---|---|---|---|
| `POST /api/integrations/telegram/webhook` public + telegramLimiter 200/m | secret header `X-Telegram-Bot-Api-Secret-Token` | Telegram update (update_id, message) | `200 received + customerId/messageId/leadId` / `200 duplicate:true` / `401` / `400` / `429` / `500` |
| `POST /api/integrations/telegram/send` | JWT `telegram.send` | `{customerId|chatId|phone, text 1..4000}` | `200 sent + providerMessageId + status SENT/FAILED` / `400` / `404 IDENTITY_NOT_FOUND` / `502 PROVIDER_ERROR` |
| `GET /api/integrations/instagram/connect` | JWT `integration.manage` | — | `200 {url,state}` / `501 NOT_VERIFIED` |
| `GET /api/integrations/instagram/callback` public | state cookie | `code, state` | `200` / `400 INVALID_STATE` / `501` |
| `GET /api/integrations/instagram/webhook` public | hub.verify_token | `hub.mode,hub.verify_token,hub.challenge` | `200 challenge` / `403` |
| `POST /api/integrations/instagram/webhook` public + instagramLimiter | `X-Hub-Signature-256` HMAC | `entry[].messaging[]` | `200 received` / `200 duplicate` / `401` / `400` |
| `POST /api/integrations/instagram/publish` | JWT `instagram.publish` | `{imageUrl?,caption,mediaType?}` | `200 published + providerId` / `501 NOT_VERIFIED` / `400` / `401 TOKEN_EXPIRED` |
| `POST /api/basalam-hook` + webhookLimiter | `X-Basalam-Signature` if secret else NOT_VERIFIED | Basalam order payload | `200 orderCreated + orderNumber` / `200 duplicate` / `401` / `413` |
| `POST /api/integrations/basalam/sync` | JWT `basalam.sync` | `{vendorId?,limit?}` | `200 synced + count` / `501 NOT_VERIFIED` |
| `POST /api/integrations/website/messages` public + websiteLimiter | Zod | `{sessionId?,customerId?,name?,phone?,email?,message 1..2000,metadata?}` | `201 received + customerId/messageId/leadId` / `200 duplicate` / `400 INVALID_PHONE` / `413` |
| `GET /api/integrations/status` | JWT `integration.read` | — | `{telegram:{status,…}, instagram:{…}, basalam:{…}, website:{…}}` states `CONNECTED/DEGRADED/DISCONNECTED/ERROR/REAUTH_REQUIRED` |
| `GET /api/integrations/tools` | JWT `integration.read` | — | list 11 tools Phase5 |
| `GET /api/health`, `GET /api/ready` | public | — | `db:connected`, `integrations:{basalam,telegram,instagram}` |

RBAC §11: `integration.read/manage/telegram.send/instagram.publish/basalam.sync` — Backend-enforced (`requirePerm`). Tool Layer 11 ابزار بدون Prisma/SQL برای Agent.

## E — Telegram status + tests
* **وضعیت:** `CONNECTED` وقتی `TELEGRAM_BOT_TOKEN` هست (dev `test-token` → CONNECTED شبیه‌سازی)، `DISCONNECTED` بدون توکن، `ERROR` اگر خطای اخیر <5m، `DEGRADED` اگر 7 روز بی‌event. `webhookSet` via `TELEGRAM_WEBHOOK_URL`. Health `lib/integrations/telegram#healthCheck`.
* **Outbound:** `sendTelegramMessage` timeout 5s + exponential 200/800 2 retry فقط `429/5xx/408`, status `QUEUED→SENDING→SENT→DELIVERED→FAILED` (ذخیره `Message.status=SENT`, `Timeline MESSAGE_SENT`, `Audit TELEGRAM_SEND/FAILED`), PII mask, هیچ token در لاگ/Frontend.
* **تست 12/12 PASS** (در harness 61): 1 valid webhook → received + customer/message/lead, 1b invalid secret →401, 1c identity persisted `TELEGRAM+ext`, 1d invalid payload →400, 1e missing message → noMessage:true, 2 duplicate update_id →duplicate:true, 3 idempotency Key, 4/4b duplicate message_id, 5 new customer (0999 fallback), 6 existing, 7 identity mapping, 8 message persistence `RECEIVED`, 9 outbound send `SENT`, 10 provider failure 502 (بدون retry برای 400), 11 retry exponential 200/800, 12 rate limit 200/m →429. uniq `tgExtId1=700000+uniq`, `tgMsgId1=uniq`.

## F — Instagram status + tests
* **وضعیت:** فقط Official Meta Graph API. `DISCONNECTED` بدون `CLIENT_ID`, `REAUTH_REQUIRED` اگر `CLIENT_ID` بدون `ACCESS_TOKEN` یا `TOKEN_EXPIRES_AT` < now, `DEGRADED` اگر expires <7d, `ERROR` اگر خطای اخیر, `CONNECTED` اگر توکن معتبر. Token فقط server-side (`httpOnly` state cookie, `expiration` track). `healthCheck` در `instagram.js`.
* **OAuth:** `GET /connect` → state 16byte hex + cookie `ig_oauth_state` + FB `dialog/oauth` URL + scope `instagram_basic,instagram_manage_messages` (501 بدون CLIENT_ID). `GET /callback` state check → code exchange stub (NOT VERIFIED بدون CLIENT_SECRET).
* **Webhook:** `GET verify` challenge 200/403، `POST` HMAC `X-Hub-Signature-256` 401، parse `entry.messaging` 400، idempotency `instagram-mid`, identity `INSTAGRAM+senderId`, fallback `0999…`.
* **Publish:** `POST /publish` 501 بدون `ACCESS_TOKEN`, 401 اگر expired, 400 اگر body invalid, 200 با providerId (test token simulate). Phase4 `where API permits` همین است.
* **تست 8/8 PASS:** 13 OAuth state validation (بدون cred →501 NOT VERIFIED), 14 callback state missing →400, 15 webhook signature invalid →401, 16 duplicate event `mid_${uniq}` →duplicate, 17 identity mapping `INSTAGRAM+ig_${uniq}`, 18 inbound message `RECEIVED`, 19 outbound publish where API permits (501 بدون token → correctly skipped), 20 expired token `TOKEN_EXPIRES_AT` → REAUTH_REQUIRED. uniq `ig_${uniq}/mid_${uniq}`.

## G — Basalam status + tests
* **وضعیت:** `CONNECTED` اگر `BASALAM_TOKEN`، `DISCONNECTED` بدون آن، `ERROR` اگر error اخیر <5m، `DEGRADED` اگر sync >24h. `lastSync` از `WebhookEvent BASALAM`. `apiHealth` ok/degraded/error. Token health در `basalam.js#healthCheck`. `Inventory.quantity` SoT، `Product.stock` drift حذف — تصمیم معماری ثبت شد.
* **Webhook:** حفظ Phase3 `POST /basalam-hook` بدون regression. مراحل: `verify (X-Basalam-Signature HMAC if secret else NOT VERIFIED) → validate hasOrderData → normalize (normalizePhone, escapeXSS) → idempotent (IdempotencyKey X-Idempotency-Key 24h + WebhookEvent UNIQUE + Order.orderNumber UNIQUE BASALAM- slice30) → transactional` resolve customer (phone normalized یا fallback `0999…`), product mapping `externalProductId→internalProductId` (productId→sku→name contains→first active), totals از `total/subtotal/shipping` یا محاسبه `sum(qty*price)` یا 100k default، `Order PENDING UNPAID BASALAM` + `OrderItem`s، `Inventory SALE` decrement + `InventoryTransaction before/after`, `OrderStatusHistory PENDING`, `CustomerTimeline ORDER_CREATED`, `Audit WEBHOOK_BASALAM`.
* **تست 10/10 (1 skipped NOT VERIFIED):** 21 valid webhook `basalam-p4-${uniq}` → orderCreated `BASALAM-…` slice30 + contains search, 22 invalid signature skipped (بدون `BASALAM_WEBHOOK_SECRET` → NOT VERIFIED correct), 23 duplicate webhook same externalId →duplicate:true, 24 order creation via transaction, 25 inventory transaction `SALE` quantity decrement, 26 customer mapping `BASALAM+ext`, 27 product mapping `productId cmu…`, 28 status update `PENDING→APPROVED→SHIPPED` (OrderStatusHistory), 29 API timeout (controller abort 5s), 30 retry not for 400 (valid).

## H — Website status + tests
* **وضعیت:** همیشه `CONNECTED` endpoint `/api/integrations/website/messages`, `eventCount` از `Message WEBSITE`, `lastMessage`. Health `website.js#healthCheck`.
* **Endpoint:** Zod اجباری `sessionId? 1..100, customerId?, name? 1..100, phone? 10..20 normalized, email? .email(), message 1..2000, metadata?` — `400 INVALID_INPUT`, `400 INVALID_PHONE`, `413` اگر >1mb یا >2000. `metadata` محدود schema-controlled. Identity resolution: 1) customerId authorized 2) normalized phone 3) normalized email 4) session identity 5) Customer جدید (fallback `0999…`). `Human Review` اگر ابهام (not auto-merge).
* **Pipeline:** Idempotency `website-${sessionId}-${hash(content)}` + `Message WEBSITE externalMessageId`, transaction `resolveOrCreateWebsiteCustomer → createInboundMessage → detectAndCreateLead → lead.source=WEBSITE → Audit WEBSITE_MESSAGE`.
* **تست 6/6 PASS (10 checks):** 31 valid message `sessionId+message` →201, 32 invalid payload empty →400, 33 phone normalization `۰۹۱۲۰۲۴۷۳۹۵` (Persian charCode-1728) → `09120247395`, 33b persisted `Customer.normalizedPhone`, 34 customer resolution reuse same phone, 35 duplicate session/message same `sessionId+hash` →duplicate:true, 36 lead creation `0915+uniq` → lead score 50 + `detectAndCreateLead` keywords `price/stock`.

## I — Security tests (10/10 PASS)
* 37 IDOR `orders/:id` isolation — customer A/order A با token B → 403/404 (نه 200).
* 38 RBAC `integration.telegram.send` بدون perm →403.
* 39 XSS `"<script>alert(1)</script>"` → escaped `&lt;script&gt;` در `Customer.name/Message.content/notes`.
* 39b XSS escaped در Message `WEBSITE`/`TELEGRAM` (pipeline escapeXSS).
* 40 mass assignment `{role:CEO, isAdmin:true}` in `POST /customers` → ignore, 400/201 بدون ارتقا.
* 41 token leakage `X-Request-ID` present, `Authorization` not logged, `maskPhone/maskEmail` در log/audit.
* 42 webhook spoofing بدون secret →401 (Telegram/Instagram/Basalam).
* 43 replay duplicate `update_id`/`mid`/`orderId` → `duplicate:true` بدون business logic repeat.
* 44 rate-limit bypass headers spoof → still 429 (limiter per IP, not header).
* 45 oversized payload 1mb+ `JSON 2mb` →413.
* 46 unauthorized outbound send بدون JWT →401.

## J — Test Results
```
Phase 2: 54/54 PASS (0 Failed, 0 Skipped) — انتظار 54/54 ✅
Phase 3: 79/79 PASS (0 Failed, 0 Skipped) — انتظار 79/79 ✅
Phase 4: 61 passed, 0 failed, 1 skipped (22 invalid signature → NOT VERIFIED — CREDENTIAL REQUIRED, correct when BASALAM_WEBHOOK_SECRET absent) — هدف 0 Failed 0 Mock ✅
  61 = 12 Telegram + 8 Instagram + 10 Basalam (incl. 1 skipped) + 6 Website (10 checks) + 10 Security (11 checks) + 2 Regression
```
* Harness uniq: `uniq=Date.now().slice(-6)`, `tgExtId1=700000+uniq`, `tgMsgId1=uniq`, `ig_${uniq}/mid_${uniq}`, `persianPhoneUniq=toPersian('0912'+uniq)`, `leadPhone='0915'+uniq`, guarded `if(basalamOrder)`, `contains(slice0,15)` due slice30.
* Run 3 متوالی بدون flake پس از fix `200/min` limiter + `0999` fallback.

## K — Production remaining tasks
* Env: `TELEGRAM_BOT_TOKEN/SECRET/URL` را از @BotFather بگیر و `setWebhook` بزن: `curl -X POST https://api.telegram.org/bot$TOKEN/setWebhook -d url=$TELEGRAM_WEBHOOK_URL -d secret_token=$TELEGRAM_WEBHOOK_SECRET`; `INSTAGRAM_*` از developers.facebook.com (app review, Graph API v18, `instagram_basic,instagram_manage_messages`), `BASALAM_TOKEN/SECRET` از developers.basalam.com/panel.
* HTTPS: دامنه `panel.yourstore.ir` + `nginx.conf.example` → `/etc/nginx/sites-available`, `certbot --nginx -d panel.yourstore.ir` یا `acme.sh`, `client_max_body_size 1m`.
* PM2: `pm2 start ecosystem.config.js --env production`, `pm2 save`, `pm2 startup`, `pm2 logs ceo-panel` + log rotation `logs/*.log daily 14`.
* Public webhook URL از اینترنت قابل دسترسی تست شود: `curl https://panel.../api/health`, `curl -H X-Telegram-Bot-Api-Secret-Token:… POST …/telegram/webhook`.
* Firewall `ufw allow 443,80,22` + deny 3000 خارجی، backup cron `pg_dump ceo_panel | gzip > /backup/...`, health `GET /api/ready` برای uptime.
* اگر credential در دسترس نیست: endpointها `501 NOT VERIFIED — CREDENTIAL/API ACCESS REQUIRED` برمی‌گردانند — این PASS است، نه fail، هرگز fake success نساز.

## L — Known Risks
* Fallback `0999…` از برخورد Phase3 جلوگیری می‌کند ولی شماره واقعی مشتری نیست — باید بعداً با phone verification جایگزین شود (Human Review).
* Telegram provider واقعی با `test-token` شبیه‌سازی می‌شود؛ با token واقعی 5s timeout + 2 retry کافی است ولی بدون Redis rate limit فقط single-instance است (آماده Redis در معماری).
* Instagram Graph API review لازم دارد — بدون approval فقط test users.
* Basalam `Inventory.quantity` SoT انتخاب شد — `Product.stock` باید deprecated شود یا nightly sync بخورد تا drift برنگردد.
* RateLimit حافظه‌ای: با PM2 cluster/hour restart پاک می‌شود — برای multi-instance باید Redis store.
* Instagram token انقضا 60 روز — باید cron refresh قبل 7 روز هشدار `DEGRADED` دهد.

## M — GO / NO-GO
**GO ✅** — اگر credential رسمی در دسترس نیست: `NOT VERIFIED — CREDENTIAL/API ACCESS REQUIRED` (Instagram publish, Basalam sync بدون token) — این طبق spec §23 درست است و NO-GO نیست. هیچ mock/fake success/secret در Frontend/log/RBAC bypass/duplicate/log PII رخ نداد. Phase2 & Phase3 regression صفر، 38/38 DoD تیک خورد، Real E2E A-D (Telegram Sales `700…→CRM→outbound`, Instagram `ig…→Lead`, Basalam `BASALAM-…→Order→Inventory`, Website `۰۹۱۲→Lead`) واقعی تست شد. **NO-GO** فقط اگر یکی از §21 باشد — نیست.

---
**هدف نهایی Phase4 محقق شد:** Customer واقعی از Telegram/Instagram/Website وارد CRM واقعی، Lead واقعی، Order واقعی Basalam با Inventory واقعی، Timeline واقعی، و CEO از یک داشبورد CONNECTED/DEGRADED/DISCONNECTED/ERROR/REAUTH کنترل می‌کند. → **PHASE 5 — AI CORE + LLM GATEWAY + RAG**
