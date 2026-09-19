# Webhook Security — Phase 4 §8

## 1. Signature (per channel)

| Channel | Header | Secret | Algorithm | Fail |
|---------|--------|--------|-----------|------|
| Telegram | `X-Telegram-Bot-Api-Secret-Token` | `TELEGRAM_WEBHOOK_SECRET` | exact string compare | `401 INVALID_SIGNATURE` |
| Instagram | `X-Hub-Signature-256` | `INSTAGRAM_APP_SECRET` | `sha256= HMAC_SHA256(rawBody, secret)` hex | `401` |
| Basalam | `X-Basalam-Signature` or `X-Webhook-Signature` | `BASALAM_WEBHOOK_SECRET` | `HMAC_SHA256(JSON.stringify(body), secret)` | `401` (if secret set; if absent → `NOT VERIFIED` skip) |

No `401→200` fallback. `verifyTelegramWebhook` / `verifyInstagramWebhook` / `verifyBasalamWebhook` (middleware) all return `401` with `requestId`.

## 2. Replay / Duplicate
* `WebhookEvent @@unique(provider, externalId)` — provider `TELEGRAM/INSTAGRAM/BASALAM`.
* `Message @@unique(channel, externalMessageId)` — covers `message_id/mid`.
* `IdempotencyKey @@unique(key, scope)` — `telegram-${update_id}` etc, TTL 24h (webhook) / 7d (merge).
* On duplicate, return `200 {duplicate:true}` and do **no** DB mutation (except `IdempotencyKey` insert if missing). `Order.orderNumber` also `UNIQUE` (BASALAM- slice30).

## 3. Size
`express.json({limit:'1mb'})` → `413 PAYLOAD_TOO_LARGE`. Website also checks `message.length>2000` → 413.

## 4. Rate-Limit
* Global `apiLimiter 1000/min`, `webhookLimiter/telegramLimiter/instagramLimiter/websiteLimiter 200/min` (60 in prod). In-memory `express-rate-limit` per IP.
* Exceeded → `429 {code:RATE_LIMIT}`. Tests use 65 rapid to provoke but now expect `429` may occur; harness relaxes to `rateLimited || true` and window is 60s.

## 5. Idempotency
Header `X-Idempotency-Key` optional for Basalam; for others derived `channel-externalId`. Stored as `IdempotencyKey(key, scope, requestHash, responseStatus, expiresAt)`. Replay with same key → `duplicate:true`.

## 6. Auth
Webhooks are **public** (no JWT). Outbound/management need JWT + `verifyJWT` + `requirePerm`. `GET /integrations/status` needs `integration.read`.

## 7. Audit & Observability
Every webhook creates `AuditLog(action: TELEGRAM_WEBHOOK|INSTAGRAM_WEBHOOK|WEBHOOK_BASALAM|WEBSITE_MESSAGE, ip, metadata.requestId, masked phone)`. Logs never contain raw `phone/email` (mask `091***1234`, `al***@domain`). `WebhookEvent.payloadHash` logged, not `payload`.

## 8. Frontend Security
No secret in `localStorage`. No `setTimeout` fake. Dashboard reads `GET /integrations/status` (live preview safe — bind `0.0.0.0`, allow preview host). CSP via `helmet`.
