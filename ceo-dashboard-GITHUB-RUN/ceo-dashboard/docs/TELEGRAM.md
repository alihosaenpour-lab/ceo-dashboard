# Telegram — Real Integration

## Env
```
TELEGRAM_BOT_TOKEN=123456:AAF…       # from @BotFather
TELEGRAM_WEBHOOK_SECRET=random-hex   # X-Telegram-Bot-Api-Secret-Token header
TELEGRAM_WEBHOOK_URL=https://yourdomain/api/integrations/telegram/webhook
```

## Setup
1. `curl -X POST https://api.telegram.org/bot$TOKEN/setWebhook -d url=$TELEGRAM_WEBHOOK_URL -d secret_token=$TELEGRAM_WEBHOOK_SECRET`
2. Check: `curl https://api.telegram.org/bot$TOKEN/getWebhookInfo`
3. Health: `GET /api/integrations/status` → `telegram.status CONNECTED` when token present.

## Webhook `POST /api/integrations/telegram/webhook` (public)
* **11 steps**: secret → size (1mb) → zod-like parse → hash → idempotency (`telegram-${update_id}` + `WebhookEvent TELEGRAM`) → normalize → identity (`TELEGRAM+externalId`) → customer → message (`TELEGRAM+message_id` dedup) → timeline → lead → audit. All in one `prisma.$transaction`.
* Headers: `X-Telegram-Bot-Api-Secret-Token: $SECRET`. Missing/wrong → `401 INVALID_SIGNATURE` (never 200).
* Body: Telegram `update` with `message` xor `edited_message` xor `channel_post`. `noMessage` (e.g. `my_chat_member`) still idempotented but returns `noMessage:true`.
* Duplicate `update_id` or `message_id` → `200 {duplicate:true}` no side-effect.

Example:
```bash
curl -X POST http://localhost:3000/api/integrations/telegram/webhook \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"update_id":123456,"message":{"message_id":9,"from":{"id":700001,"username":"ali"},"chat":{"id":700001},"text":"سلام"}}'
```

## Outbound `POST /api/integrations/telegram/send` (CEO, `integration.telegram.send`)
```json
{"customerId":"cmu…", "text":"سفارشت آماده است"}  // or {"chatId":"700001","text":"…"}
```
* Resolves `chatId` via `CustomerIdentity TE​LEGRAM`. Test dummy token (`test-*`) short-circuits to `message_id: Date.now()`.
* Real path: `lib/integrations/telegram#sendTelegramMessage` → `POST https://api.telegram.org/bot$TOKEN/sendMessage` with **5s timeout, 1 retry for 429/5xx/timeout**, JSON body `{chat_id, text}`.
* Creates `Message(OUTBOUND)` + `Timeline MESSAGE_SENT` + `Audit TELEGRAM_SEND`.

## Rate-Limit & Retry
* `telegramLimiter 200/min` (60 in prod, relaxed in dev for test harness 65-rapid). Hit → `429 RATE_LIMIT`.
* Retry only `429/5xx/408`. No retry on `400/401/403`.

## Tests (tests-phase4.js)
1 valid → received, 1b invalid secret → 401, 1d invalid payload → 400, 1e missing message → handled, 4/4b duplicate `update_id`/`message_id` → duplicate:true, 5 new customer, 6 existing (same externalId), 9 send with token, 12 rate-limit bypass (expects not 200). All use `uniq=Date.now().slice(-6)` + `tgExtId1=700000+parseInt(uniq)` to avoid cross-run pollution.

## Troubleshooting
* `duplicate:true` on fresh `update_id` → check `message_id` still duplicate (`externalMessageId` unique per channel). Use fresh `message_id` per run.
* `RATE_LIMIT` on first call after 65-rapid → limiter window 60s. Wait 60s or restart server (in-memory) or raise limit.
