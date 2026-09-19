# API CRM — Phase 3

Base: `http://localhost:3000/api`

All CRM routes require `Authorization: Bearer <JWT>` (or `ceo_token` httpOnly) → 401 if missing, 403 if role lacks perm, 429 if rate limited. All responses include `X-Request-ID` header and `requestId` in body.

Error format (standard):
```json
{ "success": false, "error": { "code": "CUSTOMER_NOT_FOUND", "message": "...", "requestId": "..." } }
```

Success:
```json
{ "success": true, "customer": {...}, "requestId": "..." }
```

---

## Customers

### GET /api/customers
Query: `page=1&limit=20&search=0912&status=LEAD&source=INSTAGRAM&tag=VIP`
Perm: `customers.read`
Response: `{ success, customers:[{..., tags:[{tag}], _count:{orders,leads}}], pagination:{page,limit,total,pages}, requestId }`

### POST /api/customers
Perm: `customers.create`
Body (Zod):
```json
{ "phone":"09120000001","name":"سارا","email":"","city":"تهران","source":"BASALAM","status":"NEW","notes":"…" }
```
Only allowed fields accepted (mass assignment protection). Phone normalized → `normalizedPhone`. Duplicate phone/normalized → 409 `DUPLICATE_CUSTOMER`. XSS escaped.
Response: 201 `{ success, customer }`

### GET /api/customers/:id
Perm: `customers.read`
Response: `{ success, customer:{..., identities, tags, customerNotes, leads, followUps, messages, orders, _count } }` 404 if not found

### PATCH /api/customers/:id
Perm: `customers.update`
Body: `{ name, email, city, status, source, notes, isActive }` (only allowed)
Status transition `NEW→VIP` only CEO/ADMIN → 403 otherwise.
Audited + Timeline.
Response: `{ success, customer }`

### GET /api/customers/:id/timeline
Perm: `customers.read`
Query: `page, limit, eventType, from, to`
Response: `{ success, timeline:[], pagination }`

### GET /api/customers/:id/orders
Perm: `orders.read`
Query: `page, limit`
Response: `{ success, orders, pagination, kpi:{totalOrders,totalSpend} }` — IDOR safe: only orders where `customerId` matches

### GET /api/customers/:id/messages
Perm: `messages.read`
Response: `{ success, messages, pagination }`

### GET /api/customers/:id/leads
Perm: `leads.read`
Response: `{ success, leads }`

### GET /api/customers/:id/followups
Perm: `followups.read`
Response: `{ success, followups }`

### POST /api/customers/:id/notes
Perm: `customers.update`
Body: `{ content:"..." }` XSS escaped
Response: 201 `{ success, note }`

### POST /api/customers/:id/tags
Perm: `customers.update`
Body: `{ name:"مشتری VIP" }`
Creates Tag if not exists, then CustomerTag `@@unique(customerId,tagId)` → 409 if duplicate
Response: 201 `{ success, tag, customerTag }`

### DELETE /api/customers/:id/tags/:tagId
Perm: `customers.update`
Response: `{ success }`

### POST /api/customers/:id/merge
Perm: `customers.merge`
Body: `{ sourceId:"..." }`
Transactional, idempotent (`idempotency_keys` scope `customer-merge`), audited, moves identities/messages/leads/followups/notes/tags/orders + timeline + delete source
Response: `{ success, message:"ادغام شد" }` 404 if source/target not found, 409 if duplicate

### GET /api/customers/:id/360
Perm: `customers.read`
Response: `{ success, customer, kpi:{totalOrders,totalSpend,avgOrderValue,lastOrder,openLeads,pendingFollowups}, timeline, orders, messages, leads, followups, notes, payments }`

---

## Leads

### GET /api/leads
Perm: `leads.read`
Query: `page,limit,status`
Response: `{ success, leads:[{customer,product,assignedTo}], pagination }`

### GET /api/leads/:id
Perm: `leads.read`
Response: `{ success, lead }`

### POST /api/leads
Perm: `leads.create`
Body: `{ customerId, status, source, intent, interestedProductId, estimatedValue, nextFollowUpAt }`
Duplicate prevention: same `customerId+interestedProductId` within 1h → 409 `DUPLICATE_LEAD`
Score calculated via rule engine, customer status→LEAD, timeline + audit
Response: 201 `{ success, lead }`

### PATCH /api/leads/:id
Perm: `leads.update`
Body: `{ status, intent, estimatedValue, nextFollowUpAt }`
Response: `{ success, lead }`

### POST /api/leads/:id/followup
Perm: `followups.create`
Body: `{ type:"CALL|MESSAGE|VISIT|EMAIL|OTHER", scheduledAt:"ISO", reason:"..." }`
Duplicate: same `leadId+scheduledAt` PENDING → 409
Response: 201 `{ success, followUp }`

---

## Messages

### POST /api/messages
Perm: `messages.create`
Body: `{ customerId, channel:"WEBSITE|TELEGRAM|INSTAGRAM|BASALAM|MANUAL|OTHER", direction:"INBOUND|OUTBOUND", content:"...", externalMessageId, text }`
XSS escaped, `@@unique(channel,externalMessageId)` duplicate → 409, customer lastSeenAt updated, timeline
Response: 201 `{ success, message }`

---

## FollowUps

### GET /api/followups
Perm: `followups.read`
Query: `status`
Response: `{ success, followups }`

### PATCH /api/followups/:id
Perm: `followups.execute`
Body: `{ status:"PENDING|RUNNING|COMPLETED|CANCELLED|FAILED" }`
If COMPLETED sets `completedAt=now()`, timeline + audit
Response: `{ success, followUp }`

---

## Tags

### GET /api/tags
Perm: any authenticated
Response: `{ success, tags }`

---

## Audit

### GET /api/audit
Perm: `audit.read` (CEO/ADMIN)
Response: `{ success, logs:[{...metadata phone masked}] }`

---

## Misc (Phase 2 retained)

`GET /api/health`, `GET /api/ready`, `POST /api/auth/request-otp`, `POST /api/auth/verify-otp`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/orders`, `PATCH /api/orders/:id/status`, `GET /api/inventory`, `GET /api/products`, `POST /api/basalam-hook`, `POST /api/schedule`, `GET /api/schedule`

All include `requestId` and PII masking in logs.
