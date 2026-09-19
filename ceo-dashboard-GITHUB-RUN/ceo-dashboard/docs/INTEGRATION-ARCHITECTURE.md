# Integration Architecture — Phase 4

```
                ┌─────────────┐
                │  Telegram   │  POST /integrations/telegram/webhook
                │  Instagram  │  POST /integrations/instagram/webhook (+ GET verify)
                │  Basalam    │  POST /basalam-hook
                │  Website    │  POST /integrations/website/messages
                └──────┬──────┘
                       │ verifyWebhook(req, SECRET) → 401 if bad
                       ▼
                ┌─────────────────┐
                │  parseInbound   │  Zod / raw parse → 400 if invalid
                └──────┬──────────┘
                       │ externalId / messageId / text / hash
                       ▼
                ┌──────────────────┐
                │  Idempotency     │  WebhookEvent(provider,externalId) UNIQUE + IdempotencyKey(key,scope) 24h
                │  (200 duplicate) │  orderNumber BASALAM-... slice(0,30) UNIQUE
                └──────┬───────────┘
                       │ pipeline.* inside prisma.$transaction
                       ▼
┌─────────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐
│ normalizePhone│→│ resolve  │→│  Customer  │→│  Message │→│ Timeline │→│   Lead   │→ FollowUp
│ ۰۹۱۲ / +98  │  │ Identity │  │  create/   │  │ INBOUND  │  │ MESSAGE_ │  │ detect │   recommend
│ → 0912…     │  │ channel+ │  │ update     │  │ dedup    │  │ RECEIVED │  │ + score│
│             │  │ externalId│  │ fallback   │  │ channel+ │  │          │  │ dedup1h│
│             │  │          │  │ 0999…     │  │ externalMid│  │          │  │        │
└─────────────┘  └──────────┘  └────────────┘  └──────────┘  └────────────┘  └──────────┘
                                                       │
                                                       ▼
                                                ┌────────────┐
                                                │ AuditLog   │ + requestId, masked PII
                                                │ WebhookEvent│ processed=true, error if any
                                                └────────────┘
```

## Adapter Contract (each channel implements)
```js
verifyWebhook(req, secret) -> {ok, code, message}
parseInbound(raw)          -> {externalId, messageId, text, …} | {error}
resolveIdentity(tx, …)     -> Customer
normalizeMessage(raw)      -> {content, metadata}
sendMessage(token, chatId, text) // Telegram only, with timeout/retry
publish()                  // Instagram (NOT VERIFIED stub)
healthCheck()              // → CONNECTED/DEGRADED/…
```

Location: `lib/integrations/pipeline.js` (shared), `lib/integrations/telegram.js`, `lib/integrations/instagram.js`.

## Data Flow Guarantees
* **Atomic**: one `$transaction` per inbound. If any step fails, WebhookEvent.error is set, no partial customer/message.
* **Duplicate safe**: `createInboundMessage` checks `channel+externalMessageId` first; `detectAndCreateLead` checks `customerId+product+1h`.
* **Phone normalization**: single function `normalizePhone` (Persian ۰-۹, Arabic, +98, spaces) → `0999…` fallback never collides with Phase3 fixed `0916/0917/0918/0912` (Phase4 fix 2026-09-15).
* **Outbound**: `QUEUED→SENDING→SENT→DELIVERED→FAILED` — stored as `Message(status)` + `Timeline MESSAGE_SENT` + `Audit TELEGRAM_SEND`.

## Error Taxonomy
`INVALID_SIGNATURE 401`, `INVALID_PAYLOAD 400`, `PAYLOAD_TOO_LARGE 413`, `RATE_LIMIT 429`, `DUPLICATE 200 duplicate:true`, `SERVER_ERROR 500`, `NOT_VERIFIED 501` (Instagram/Basalam sync without creds).

See `docs/WEBHOOK-SECURITY.md` for signature details.
