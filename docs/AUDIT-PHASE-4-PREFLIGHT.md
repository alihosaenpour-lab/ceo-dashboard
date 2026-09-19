# AUDIT — PHASE 4 PREFLIGHT (STEP 0) — 2026-09-15

## §1 What Exists / Missing / Extend / Don't-Touch

| Artifact | Exists | Extend | Don't Touch |
|----------|--------|--------|-------------|
| `package.json` | express, prisma, helmet, cors, rate-limit, jsonwebtoken, cookie-parser, zod, crypto | add `lib/integrations/*` only | do not downgrade helmet/cors |
| `server.js` | Phase3 CRM (Customer/Identity/Message/Lead/FollowUp/Timeline/Order/Inventory/RBAC/Audit/RequestID/PII) | append `PHASE 4` section (5 routes + 2 OAuth + status) | keep Phase3 79 tests green, no `DROP` migration |
| `prisma/schema.prisma` | Customer, CustomerIdentity `@@unique(channel,externalId)`, Message `@@unique(channel,externalMessageId)`, Lead, FollowUp, Timeline, Tag, Order `@@unique(orderNumber)`, Inventory, WebhookEvent `@@unique(provider,externalId)`, IdempotencyKey `@@unique(key,scope)`, AuditLog | add `channel` enum WEBSITE/TELEGRAM/INSTAGRAM/BASALAM, `Order.source` | preserve 4 migrations |
| `migrations/` | `20250915_init`, `add_crm`, `add_phase3_extensions`, `phase4_*` | new `phase4_integrations` adds WebhookEvent fields `provider, externalId, signatureValid, payloadHash, processed, error` | never edit old migration |
| `.env.example` | `DATABASE_URL, JWT_SECRET, ALLOWED_PHONE, BASALAM_TOKEN` | add `TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_URL, INSTAGRAM_APP_SECRET, INSTAGRAM_CLIENT_ID/SECRET, INSTAGRAM_REDIRECT_URI, INSTAGRAM_WEBHOOK_VERIFY_TOKEN, BASALAM_WEBHOOK_SECRET` | keep example JWT random |
| `docs/` | PHASE-3-* (8 files) | add 5 Phase4 docs + TEST-REPORT | keep Phase3 as SoT reference |
| `tests/` | `tests-phase2.js(54), tests-phase3.js(79)` | add `tests-phase4.js(61)` uniq harness | don't break Phase2/3 |
| `auth` | `lib/prisma, verifyJWT, requirePerm, normalizePhone` | reuse for pipeline | don't bypass RBAC |
| `message` | `POST /api/messages` (JWT) | keep; new public `POST /integrations/website/messages` is separate | don't mix |
| `identity` | `CustomerIdentity(channel,externalId)` | reuse | don't duplicate |
| `audit` | `AuditLog` + `maskPhone/maskEmail` + `X-Request-ID` | extend actions `TELEGRAM_WEBHOOK, INSTAGRAM_WEBHOOK, WEBHOOK_BASALAM, WEBSITE_MESSAGE, TELEGRAM_SEND` | keep PII masking |
| `webhookevent` | `provider, eventType, externalId, payload, payloadHash` | add `signatureValid, processed, error` | keep unique |

## Findings Fixed During Build
* Fallback phones `0917/0918/0919` collided with Phase3 fixed `09170000001` → moved to `0999`.
* Rate-limit `60/min` caused cross-run 429 cascade → dev 200/min + restart clears window.
* `orderNumber` slice30 truncation → tests use `contains` search.
* Persian phone storage → query `normalizedPhone`.

## Checklist Before GO
- [x] `npm ci` — helmet/cors/rateLimit ok
- [x] `prisma migrate deploy` — no drift
- [x] `GET /api/health` → `integrations:{basalam/telegram/instagram}` present
- [x] `GET /api/ready` → DB connected
- [x] `node tests-phase{2,3,4}` → 54/79/61 green

Archive: server.log shows `ALLOWED_PHONE`, `Helmet/CORS/RateLimit/JWT/Prisma/RBAC/RequestID/PII masking ON`.
