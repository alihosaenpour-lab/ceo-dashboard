# Integration API Reference — Phase 4

Base: `https://domain.or.http://localhost:3000` — All responses include `requestId` and `X-Request-ID` header.

## Public Webhooks

### `POST /api/integrations/telegram/webhook` | `telegramLimiter`
*Headers*: `X-Telegram-Bot-Api-Secret-Token` | *Body*: Telegram `update` | *Responses*: `200 {received, customerId, messageId, leadId}` / `200 {duplicate:true}` / `401 INVALID_SIGNATURE` / `400 INVALID_PAYLOAD` / `429 RATE_LIMIT` / `500`

### `GET /api/integrations/instagram/webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`
*Responses*: `200 challenge` / `403`

### `POST /api/integrations/instagram/webhook` | `instagramLimiter`
*Headers*: `X-Hub-Signature-256` | *Body*: `entry[].messaging[]` | *Responses*: same as Telegram

### `POST /api/basalam-hook` | `webhookLimiter`
*Headers*: `X-Basalam-Signature` (if secret set), `X-Idempotency-Key` optional | *Body*: Basalam order JSON | *Responses*: `200 {orderCreated, orderId, orderNumber}` / `200 {duplicate:true}` / `401` / `413`

### `POST /api/integrations/website/messages` | `websiteLimiter`
*Body Zod*: `{sessionId?, customerId?, name?, phone?(normalized), email?, message(1..2000), text?, metadata?}` | *Responses*: `201 {customerId,messageId,leadId}` / `200 {duplicate:true}` / `400 INVALID_INPUT/INVALID_PHONE` / `413`

## Authenticated (JWT + RBAC)

### `GET /api/integrations/status` | `integration.read`
*Returns*: `{integrations:{telegram:{status,lastEvent,lastError}, instagram:{status,tokenPresent,lastError}, basalam:{status,lastSync,apiHealth}, website:{status,lastMessage,eventCount}}}` States `CONNECTED/DEGRADED/DISCONNECTED/ERROR/REAUTH_REQUIRED`

### `POST /api/integrations/telegram/send` | `integration.telegram.send`
*Body*: `{customerId?, chatId?, phone?, text(1..4000)}` (one of customerId/chatId/phone required) | *Responses*: `200 {sent, providerMessageId, message}` / `400 MISSING_CHAT_ID` / `404 IDENTITY_NOT_FOUND` / `403 FORBIDDEN` / `500 NOT_CONFIGURED` / `502 PROVIDER_ERROR`

### `GET /api/integrations/instagram/connect` | `integration.manage`
*Returns*: `200 {url, state}` / `501 NOT_VERIFIED` if no `CLIENT_ID`

### `GET /api/integrations/instagram/callback` (public but state-checked)
*Query*: `code, state` | *Responses*: `200` / `400 INVALID_STATE` / `501`

---

### RBAC Matrix (Phase4 §11)
| Role | integrations |
|------|--------------|
| CEO | `*` (all) |
| ADMIN | `read, manage, telegram.send, instagram.publish, basalam.sync` |
| MANAGER | `read` |
| SALES/SUPPORT | `read` |

### Error Envelope
```json
{"success":false,"error":{"code":"INVALID_SIGNATURE|…","message":"…","requestId":"uuid"},"requestId":"uuid"}
```

### Rate-Limit Headers
`RateLimit-*`, `429 {code:RATE_LIMIT, message:"…"}`

See `docs/TELEGRAM.md`, `docs/INSTAGRAM.md`, `docs/BASALAM.md`, `docs/WEBSITE-INTEGRATION.md` for channel details.
