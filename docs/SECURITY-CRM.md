# SECURITY CRM — Phase 3

## Auth & RBAC

- JWT in `httpOnly` cookie `ceo_token` + Bearer header support, 12h expiry, verified via `verifyJWT`
- `ALLOWED_PHONE=09017909857` → 403 if phone last 10 digits mismatch (RBAC base)
- Role-based permissions map (`PERMISSIONS`):
  - CEO: `*`
  - ADMIN: customers.*, messages.*, leads.*, followups.*, orders.*, audit.read
  - Others restricted
- Middleware `requirePerm(perm)` → 403 `FORBIDDEN` with `requestId`
- All CRM routes behind `verifyJWT` + `requirePerm`
- `GET /api/audit` only `audit.read` → CEO/ADMIN

## IDOR Protection

- `GET /api/customers/:id/orders` filters `where:{customerId: id}` → cannot leak other customer's orders
- `GET /api/customers/:id/...` checks existence of customer first → 404 if not found, not 200 with empty
- Changing `:id` to another customer's id returns that customer's data only if has `customers.read` perm (CEO) — but order isolation ensures no cross-customer order leak; message/lead/followup also filtered by `customerId`
- Test: `IDOR customers/:id/orders isolated` ✅

## Mass Assignment Protection

- **Never** `req.body` directly into Prisma
- Every write uses Zod schema picking only allowed fields:
  - `POST /api/customers`: only `phone, name, email, city, source, status, notes`
  - `PATCH /api/customers/:id`: only `name, email, city, status, source, notes, isActive`
  - Attempts to inject `id, role, isActive:false, phone` are ignored
- Test: `isActive` remains true, `id !== hacked_id`, `phone` unchanged via PATCH ✅

## XSS Protection

- Backend: `escapeXSS(str)` replaces `&<>"'` before saving `name, city, notes, intent, content, tag name`
- Frontend: `escapeHtml` via `div.textContent` for all rendered customer data, timeline, notes, messages
- Tests: `<script>`, `<img onerror>`, `<svg onload>` → stored as `&lt;script&gt;` ✅

## SQL Injection

- All DB access via Prisma parameterized queries, no raw string interpolation
- Search uses `contains` with `mode:insensitive`, not raw SQL
- Test via `search` with `'; DROP TABLE` → safe

## PII Masking

- Helpers: `maskPhone(phone)` → `090***9857`, `maskEmail(email)` → `ab***@domain`
- Logs: `requestId, method, url, status, duration, ip, user:maskPhone`, `phone` in body masked, never log OTP/token/authorization header
- Audit: `metadata.phone` masked before response (audit API)
- Test: audit `metadata.phone` contains `***` ✅

## Rate Limit & Headers

- Helmet (CSP off for PWA, other headers on)
- CORS whitelist (`ALLOWED_DOMAIN` + localhost) → credentials
- RateLimit:
  - `otpLimiter` 20/min
  - `webhookLimiter` 60/min
  - `apiLimiter` 1000/min → JSON handler with `requestId`
- Block sensitive files: `.env, .git, package-lock.json, server.js` → 404 JSON with `requestId`
- Static `dotfiles:'deny'`

## Request ID

- Middleware `crypto.randomUUID()` → `req.requestId` + `X-Request-ID` header
- Logged in every request, included in errors, audit `metadata.requestId`

## Error Handling

- Standard: `{ success:false, error:{ code, message, requestId } }`
- Production: no stack trace, no secret, no raw DB error
- All errors go through handler with `requestId`

## Duplicate & Idempotency

- `CustomerIdentity @@unique([channel,externalId])` → 409 / P2002
- `Message @@unique(channel,externalMessageId)` via `findFirst` check → 409
- `Lead` duplicate same customer+product within 1h → 409
- `FollowUp` duplicate same lead+scheduledAt PENDING → 409
- `CustomerTag @@unique(customerId,tagId)` → 409
- `Customer Merge` idempotencyKey `merge-source-target` scope `customer-merge` → duplicate:true

## Concurrency

- Prisma `$transaction` for all multi-table writes (merge, lead create, followUp, order status)
- Merge uses transaction + idempotencyKey to prevent double merge
- Test: two simultaneous merges → both handled, no crash ✅

## Secrets

- Secrets only in `.env` (DATABASE_URL, JWT_SECRET, BASALAM_TOKEN...) never in frontend or git (`.gitignore` includes `.env`)
- `GET /.env` → 404
- Frontend `grep` for secrets → 0
