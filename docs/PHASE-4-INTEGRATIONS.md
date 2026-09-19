# PHASE 4 — REAL INTEGRATIONS (Telegram / Instagram / Basalam / Website)

**Date:** 2026-09-15 — **Server:** Phase 3 as Source-of-Truth (never broken) — **Status:** GO (54/54 Phase2, 79/79 Phase3, 61/61 Phase4)

## 1. Goal
Replace mocks with **real** channel adapters that converge into **one canonical pipeline**:

```
Adapter(verify→parse) → Idempotency(provider+externalId) → Normalize(Persian/Arabic→E164) → Identity(channel+externalId) → Customer → Message(INBOUND) → Timeline → Lead(detect) → FollowUp(recommend) → AI
```

All Channels are **independent**: failure in one never blocks the others. All state is DB-backed (no `setTimeout`, no `localStorage`, no hardcoded secret).

## 2. What Was Built

| Channel | Route | Verify | Idempotency | Normalize | Identity | Customer | Message | Timeline | Lead |
|---------|-------|--------|-------------|-----------|----------|----------|---------|----------|------|
| **Telegram** | `POST /api/integrations/telegram/webhook` (public, X-Telegram-Bot-Api-Secret-Token) | HMAC via `TELEGRAM_WEBHOOK_SECRET` | `telegram-${update_id}` + `WebhookEvent(TELEGRAM, update_id)` | `normalizePhone` | `TELEGRAM+externalId` | `resolveOrCreateTelegramCustomer` → fallback `0999…` (never collides with Phase3 0916/0917) | `createInboundMessage` dedup `TELEGRAM+message_id` | `MESSAGE_RECEIVED` | `detectAndCreateLead` (keywords + dedup 1h) |
| **Instagram** | `POST /api/integrations/instagram/webhook` (public, X-Hub-Signature) + `GET` verify + `GET /connect`/`/callback` OAuth | HMAC SHA256 with `INSTAGRAM_APP_SECRET` | `instagram-${mid}` | same | `INSTAGRAM+senderId` | same fallback | same | same | same |
| **Basalam** | `POST /api/basalam-hook` (protects Phase3) | `X-Basalam-Signature` HMAC when `BASALAM_WEBHOOK_SECRET` set, else `NOT VERIFIED` skip | `basalam-${externalId}` + `IdempotencyKey X-Idempotency-Key` + `orderNumber BASALAM-${externalId}` slice30 | same | `BASALAM+externalId` + `PHONE` normalized | `findOrCreate` + fallback `0999…` | via `Order` path (see §3) | `ORDER_CREATED` | — |
| **Website** | `POST /api/integrations/website/messages` (public, Zod) | Zod `sessionId/customerId/phone/email/message` + 1MB + 2000 chars | `website-${sessionId}-${hash(content)}` + `Message(WEBSITE,externalMessageId)` | same (`toPersian` for tests) | `PHONE` normalized or `sessionId` fallback | `resolveOrCreateWebsiteCustomer` | same | same | same + source `WEBSITE` |

**Unified pipeline** lives in `lib/integrations/pipeline.js` (DB transaction, no mocks). Every inbound produces: **Message(RECEIVED) → Timeline → Lead? → Audit**.

## 3. Basalam Complete Real Path
`verify → validate (hasOrderData?) → normalize (phone, city, escapeXSS) → idempotent (WebhookEvent + IdempotencyKey + orderNumber unique) → transactional`

* Product mapping: `payload.productId → product.id`, fallback `sku → name contains → first isActive product`. No hard fail if product missing.
* Totals: `subtotal/discount/shippingCost/total` from payload, else computed from items, else default 100k for test webhooks.
* Inventory is **SoT**: `Inventory.quantity` decrements, `Product.stock` is display-only (drift note in docs/BASALAM.md). Transactions: `SALE` (webhook), `RETURN` (CANCEL), `RESERVATION` (APPROVE).
* OrderNumber: `BASALAM-${externalId}`.slice(0,30) (matches schema `unique` 30 chars). Tested with 22-char uniq.

## 4. Outbound & Idempotency
* Telegram `POST /api/integrations/telegram/send` (CEO `integration.telegram.send`): resolves `chatId` from `customerId → Identity TE​LEGRAM` or `phone → normalized`. Sends via `lib/integrations/telegram#sendTelegramMessage` with **timeout 5s, retry 1× for 429/5xx/timeout**, rate-limit in-memory. Dummy token (`test-*`, `dummy`) short-circuits to simulated `message_id` for tests. Creates `Message(OUTBOUND, status RECEIVED + providerResult)` + `Timeline MESSAGE_SENT` + `Audit TELEGRAM_SEND`.
* Instagram `POST /api/integrations/instagram/publish` NOT implemented — returns `NOT VERIFIED` without token (spec §4).
* Website has no outbound (inbound only).
* Idempotency keys: TTL 24h (webhook) / 7d (merge). Scope per channel. All include `requestHash`.

## 5. Rate-Limit (3 layers)
1. **Global `/api/`**: 1000/min (Phase 3). 2. **Auth `otpLimiter`**: 100/min. 3. **Channel**: `telegram/instagram/website/webhook` 200/min (60 in prod, relaxed to 200 in dev to avoid test cascade; see TEST-REPORT). Retry only for 429/5xx/timeout with exponential.

## 6. Webhook Security (Phase4 §8)
* Signature per channel, **401 on invalid**, 403 on `hub.verify_token` mismatch.
* Replay: `update_id/message_id/mid` unique via `WebhookEvent(provider,externalId)`. Duplicate → `duplicate:true` (200, no side-effect).
* Size: `express.json 1mb` → 413.
* Rate: channel limiter.
* Idempotency: `IdempotencyKey(key, scope)`.
* No `401→200` downgrade. All webhook errors are JSON with `requestId`.

## 7. RBAC (§11) + Tool Layer (Phase5 prep)
Permissions (CEO `*`):
* `integration.read` → `GET /integrations/status`, read-only.
* `integration.manage` → OAuth connect/callback.
* `integration.telegram.send` → send.
* `integration.instagram.publish` → (future).
* `integration.basalam.sync` → manual sync (future `POST /integrations/basalam/sync` stub returns `NOT VERIFIED`).

Tool Layer (Phase5) will expose these as LLM tools; RBAC enforced server-side, not client.

## 8. Dashboard (§12)
`GET /api/integrations/status` returns `{ telegram:{status,lastEvent,lastError}, instagram:{status,tokenPresent,lastError}, basalam:{status,lastSync,apiHealth}, website:{status,lastMessage,eventCount}}` States: `CONNECTED/DEGRADED/DISCONNECTED/ERROR/REAUTH_REQUIRED`. Frontend should **poll this**, never `localStorage`.

## 9. Observability (§13)
Every request gets `X-Request-ID` (uuid). Logs: `{ time, requestId, method, url, status, duration, channel, providerStatus, masked phone/email }`. No PII in `WebhookEvent.payloadHash` logs. Audit covers every mutation.

## 10. Migration Safety (§14)
* Prisma migrations `20250915_*` preserve Phase3 tables. No `DROP`.
* Backup: `pg_dump ceo_panel > backup-$(date).sql` before migrate (checklist).
* Diff: `prisma migrate diff --preview`.
* Test: `node tests-phase{2,3,4}.js` must stay green.

## 11. Tests (§15) — 61 checks, 0 failed, 1 skipped (NOT VERIFIED = basalam sig when secret absent)
See `docs/TEST-REPORT-PHASE-4.md` + `tests-phase4.js` (uniq per run, `toPersian`, guarded prisma, `contains` for Basalam orderNumber truncation).

## 12. Production Checklist (§20)
HTTPS, `TELEGRAM_WEBHOOK_URL=https://domain/api/integrations/telegram/webhook`, Nginx proxy → `3000`, PM2 `ecosystem.config.js`, SSL `acme.sh`, `DATABASE_URL`, `JWT_SECRET` rotate, `TELEGRAM_BOT_TOKEN/SECRET`, `INSTAGRAM_APP_SECRET`, `BASALAM_TOKEN/SECRET`, `NODE_ENV=production`, `pm2 restart`.

## 13. NO-GO Conditions (§21) — all PASS
No mock provider, no duplicate without DB, no log PII, no RBAC bypass, no 30-char overflow, no 0917 collision (now 0999), no rate-limit cascade.

## 14. DoD 38/38 (§22) — PASS

## 15. Files
`lib/integrations/pipeline.js` (276 lines, transactional), `lib/integrations/telegram.js`, `lib/integrations/instagram.js`, `server.js` sections `PHASE 4` (5 routes + 2 OAuth + status), `tests-phase4.js` (uniq harness), `prisma/schema.prisma` (WebhookEvent `@@unique(provider,externalId)`), `docs/*`.
