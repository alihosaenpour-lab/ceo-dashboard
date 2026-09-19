# Instagram — Real Integration (Meta Graph API)

> **Scope:** Official Meta Graph API only. No unofficial scrape. Without `INSTAGRAM_*` creds every endpoint returns `NOT VERIFIED` (501) — this is correct per spec.

## Env
```
INSTAGRAM_APP_SECRET=…                 # for X-Hub-Signature
INSTAGRAM_CLIENT_ID=…                  # FB app
INSTAGRAM_CLIENT_SECRET=…
INSTAGRAM_REDIRECT_URI=https://domain/api/integrations/instagram/callback
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=test_verify_token
INSTAGRAM_ACCESS_TOKEN=…               # long-lived user token, server-side only
```

## OAuth (server-side)
* `GET /api/integrations/instagram/connect` (CEO `integration.manage`) → returns `{url, state}`. Sets `ig_oauth_state` httpOnly cookie. If `CLIENT_ID` missing → `501 NOT_VERIFIED`.
* `GET /api/integrations/instagram/callback?code=…&state=…` → verifies `state` vs cookie, checks `error`, then would `POST https://graph.facebook.com/oauth/access_token` (stub, returns `message: OAuth callback received`). Token exchange never hits `localStorage`.

## Webhook
* **Verify** `GET /api/integrations/instagram/webhook?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=…` → `200 challenge` if token matches, else `403`.
* **Inbound** `POST /api/integrations/instagram/webhook` (public):
  - `X-Hub-Signature-256: sha256=<hmac(body, APP_SECRET)>` → `401 INVALID_SIGNATURE` if missing/wrong.
  - `parseInstagramEvent` expects `entry[].messaging[]` with `sender.id`, `message.mid`, `message.text`. Empty → `400 INVALID_PAYLOAD`.
  - Idempotency: `instagram-${mid}` + `WebhookEvent(INSTAGRAM, mid)`. Duplicate → `duplicate:true`.
  - Transaction: resolve `INSTAGRAM+senderId` → fallback `0999…` → `Message(IG, mid)` → `Timeline` → `Lead` → `Audit INSTAGRAM_WEBHOOK`.

```bash
# verify
curl "http://localhost:3000/api/integrations/instagram/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token&hub.challenge=CH"
# inbound (with valid signature)
BODY='{"entry":[{"messaging":[{"sender":{"id":"ig_123"},"message":{"mid":"mid_abc","text":"سلام"}}]}]}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$INSTAGRAM_APP_SECRET" | cut -d" " -f2)
curl -X POST http://localhost:3000/api/integrations/instagram/webhook -H "X-Hub-Signature-256: sha256=$SIG" -H "Content-Type: application/json" -d "$BODY"
```

## Outbound Publish
`POST /api/integrations/instagram/publish` — **NOT IMPLEMENTED** in Phase 4. Without `INSTAGRAM_ACCESS_TOKEN` returns `NOT VERIFIED`. Phase 5 will implement `POST https://graph.facebook.com/me/media` + `media_publish`.

## Tests
16 first `ig_${uniq}/mid_${uniq}` → received, 16 duplicate same `mid` → duplicate:true, 17 invalid sig → 401, 18 invalid payload → 400, 19 webhook verify GET, connect without creds → 501 NOT VERIFIED. Uses `ig_${uniq}` to avoid previous `mid_dup_001` pollution.

## Health
`GET /api/integrations/status` → `instagram.status` = `CONNECTED` (token present) | `REAUTH_REQUIRED` (clientId but no token) | `DISCONNECTED`.
