# Website Chat / Lead Entry

## Route
`POST /api/integrations/website/messages` (public, no JWT — chat widget)

## Zod Schema
```ts
{
  sessionId?: string(1..100)   // widget session
  customerId?: string           // logged-in customer
  name?: string(0..100)
  phone?: string(10..20)       // normalized via pipeline.normalizePhone → 400 if invalid
  email?: string | ""          // .email()
  message: string(1..2000)     // required (= text)
  text?: string(0..2000)
  metadata?: any               // limited, stored as Message.metadata
}
```

Size: `express.json 1mb` → `413 PAYLOAD_TOO_LARGE`. Field `message.length>2000` also 413. Only `metadata` subset is stored; never `req.headers` dump.

## Logic
1. Validate Zod → 400.
2. If `phone` present → `normalizePhone` else 400.
3. Idempotency: `contentHash=sha256(message).slice(0,12)`, `externalMessageId = sessionId ? "${sessionId}-${hash}" : "web-${hash}-${Date.now()}"`. Check `Message(WEBSITE, externalMessageId)` duplicate → `duplicate:true`; also `IdempotencyKey website-${externalMessageId}`.
4. Transaction:
   * `resolveOrCreateWebsiteCustomer(tx, {customerId, phone, email, name, sessionId})`
     - if `customerId` → find or 404
     - else if `phone` → `normalizedPhone` lookup → found → update `lastSeenAt`, create `PHONE` identity if missing; else create new `Customer(phone, normalizedPhone, name/email/city?, source WEBSITE, status NEW)` + `Timeline CUSTOMER_CREATED` + `Identity PHONE`
     - else (no phone) → `generateFallbackPhone(sessionId, '0999')` → same create (note `0999`)
   * `createInboundMessage(tx, {customerId, channel:WEBSITE, externalMessageId, content, metadata})` → Timeline
   * `detectAndCreateLead(tx, {customerId, content})` → if true, set `lead.source=WEBSITE`
   * `Audit WEBSITE_MESSAGE`

Returns `201 {received:true, customerId, messageId, leadId}` or `200 {duplicate:true}`.

## Phone Normalization
Persian `۰۹۱۲…` → `0912…` via `charCode-1728`, Arabic, `+98/0098/98` stripping, `normalizePhone` → `0912xxxxxxx`. Tests use `toPersian` helper + `persianPhoneUniq=toPersian('0912'+uniq)` and verify `normalizedPhone: persianNorm`.

## Tests
31 valid → 201, 32 invalid payload (empty message) → 400, 33 phone normalization `۰۹۱۲۰۲۴۷۳۹۵` → `09120247395` persisted, 33b `Customer(normalizedPhone)`, 34 customer resolution same `normalizedPhone` reused, 35 duplicate `sessionId+contentHash` → duplicate:true, 36 lead creation `0915+uniq` → lead `score:50`, 36b score check. Unique `leadPhone=0915+uniq` avoids 1h dup window (`leadId null` crash).

## Frontend
Widget should `POST` to this route with `sessionId` stored in `sessionStorage` (not truth, just UX). Display errors `400 INVALID_PHONE`, `429 RATE_LIMIT`, `413`.
