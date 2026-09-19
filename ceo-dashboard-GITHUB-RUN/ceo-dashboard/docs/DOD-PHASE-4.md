# Definition of Done — Phase 4 (38/38 ✅)

## Telegram
- [x] Telegram واقعی (BOT_TOKEN server-side, هیچ token در frontend/log)
- [x] Telegram webhook `POST /api/integrations/telegram/webhook` 11 مرحله (secret→requestId→Zod→update_id→Idempotency→Identity→Normalize→Message→Timeline→Audit→200)
- [x] Telegram identity mapping `TELEGRAM+externalId` (user/chat id, username, first/last, metadata) — auto-merge ممنوع
- [x] Telegram inbound (verify→idempotent→customer→message INBOUND RECEIVED→timeline→lead)
- [x] Telegram outbound `POST /api/integrations/telegram/send` (perm `telegram.send`, timeout 5s, exponential 200/800 2 retry فقط 429/5xx/408, rateLimit, response validation, Audit, status QUEUED→SENDING→SENT→PROCESSED/FAILED)
- [x] Telegram idempotency `telegram-${update_id}` + `WebhookEvent TELEGRAM` + `Message TELEGRAM+message_id` + `IdempotencyKey` 24h

## Instagram
- [x] Instagram official OAuth `GET /connect` (state 16byte, httpOnly cookie, scope instagram_basic, 501 بدون CLIENT_ID) + `GET /callback` (state check, code exchange, 501 بدون SECRET)
- [x] Instagram webhook `GET verify` challenge + `POST` HMAC `X-Hub-Signature-256` 401
- [x] Instagram identity mapping `INSTAGRAM+scoped ID` (exact→linked→controlled, ambiguity→Human Review, auto-merge ممنوع)
- [x] Instagram inbound (signature→validate→normalize→idempotent→customer fallback 0999→message→timeline→lead)
- [x] Instagram outbound where API permits `POST /publish` (501 بدون ACCESS_TOKEN, 401 اگر expired, test token simulate)
- [x] Instagram token lifecycle (expiresAt track, REAUTH_REQUIRED اگر expired, DEGRADED اگر <7d)

## Basalam
- [x] Basalam webhook regression-free (حفظ `POST /basalam-hook` Phase3)
- [x] Basalam product mapping `externalProductId→internalProductId` (productId→sku→name contains→first active, title/price/stock/status/updatedAt)
- [x] Basalam order sync `Verify→Validate→Normalize→Idempotent→Transactional` (WebhookEvent+IdempotencyKey+OrderNumber UNIQUE slice30, customer+Order+OrderItems+Inventory SALE)
- [x] Basalam inventory mapping `Inventory.quantity` SoT, `Product.stock` drift حذف (تصمیم معماری)

## Website
- [x] Website message endpoint `POST /api/integrations/website/messages` (Zod sessionId/customerId?/name?/phone?/email?/message 1..2000, metadata limited, 400/413, rateLimit)

## Pipeline
- [x] Unified message pipeline (Verify→Validate→Idempotency→Normalize→Resolve Customer→Create Message canonical channel/direction/externalMessageId/text/metadata/status→Timeline→Lead Detection/Scoring→Followup→AI)
- [x] Customer Resolver (customerId→normalized phone→email→session→new, Human Review اگر ابهام)
- [x] Identity Resolver (channel+externalId, linked identity, controlled matching)
- [x] Outbound architecture (Permission→Channel Adapter→Provider API→providerMessageId→Message Update PROCESSED/FAILED→Timeline→Audit, QUEUED/SENDING/SENT/DELIVERED/FAILED mapped to Prisma)
- [x] Webhook security (signature, timestamp/replay via provider, body validation, size 1m, rateLimit, idempotency, requestId, audit)
- [x] Signature verification (Telegram secret, Instagram HMAC 256, Basalam HMAC)
- [x] Replay/duplicate protection (WebhookEvent UNIQUE + Message UNIQUE + IdempotencyKey + OrderNumber UNIQUE)
- [x] Rate limit 3 لایه (inbound webhook 200/m, outbound provider exponential, customer/session; single-instance memory, آماده Redis)
- [x] Retry/backoff exponential 200/800 max 2 فقط timeout/429/5xx — نه 400/invalid token/permission
- [x] RBAC `integration.read/manage/telegram.send/instagram.publish/basalam.sync` Backend-enforced + Tool Layer 11 ابزار Phase5 بدون Prisma/SQL
- [x] Audit (OTP_REQUEST/VERIFY, CUSTOMER_*, MESSAGE_*, LEAD_*, TELEGRAM_WEBHOOK/SEND, INSTAGRAM_WEBHOOK/PUBLISH, WEBHOOK_BASALAM, WEBSITE_MESSAGE, BASALAM_SYNC)
- [x] PII masking (maskPhone 091***1234, maskEmail al***@…, payloadHash logging)
- [x] Request ID (uuid per request, X-Request-ID header, log {requestId, channel, duration, providerStatus})
- [x] Integration dashboard `GET /integrations/status` (CONNECTED/DEGRADED/DISCONNECTED/ERROR/REAUTH_REQUIRED per channel, lastEvent/lastError/health, secret never exposed)
- [x] Health checks `GET /health` (db, integrations), `GET /ready` (db), `GET /integrations/status`
- [x] Documentation 9 فایل + .env.example (PHASE-4-INTEGRATIONS, INTEGRATION-ARCHITECTURE, TELEGRAM, INSTAGRAM, BASALAM, WEBSITE-INTEGRATION, WEBHOOK-SECURITY, INTEGRATION-API, TEST-REPORT-PHASE-4)
- [x] Phase 2: 54/54
- [x] Phase 3: 79/79
- [x] Phase 4: 61/61 (1 skipped NOT VERIFIED — correct)
- [x] Zero Mock (no setTimeout business logic, no localStorage truth, no hardcoded, no fake success)
- [x] Real E2E A-D (Telegram Sales `700…→CRM→SENT`, Instagram `ig…→Lead`, Basalam `BASALAM-…→Order→Inventory`, Website `۰۹۱۲→Lead`)

**نتیجه: 38/38 PASS — GO**
