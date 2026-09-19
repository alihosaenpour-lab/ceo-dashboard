# PHASE 3 — CRM — مستندات

## معماری Identity

- **Customer** اصلی: `phone` unique + `normalizedPhone` unique (ایران +98/۰۹۰۱۲...)
- **CustomerIdentity** مجزا برای هر کانال: `@@unique([channel, externalId])` با `PHONE/TELEGRAM/INSTAGRAM/BASALAM/WEBSITE/EMAIL`
- هر مشتری می‌تواند چند هویت داشته باشد؛ هویت تکراری بلاک (P2002)

```
Customer 1 ── N CustomerIdentity
          ├── N Message
          ├── N Lead
          ├── N FollowUp
          ├── N CustomerNote
          ├── N CustomerTag → Tag
          └── N CustomerTimeline
```

## مدل‌های CRM

| مدل | کلید |
|---|---|
| Customer | status: NEW/LEAD/ACTIVE/CUSTOMER/VIP/INACTIVE/BLOCKED, source, firstSeenAt/lastSeenAt |
| CustomerIdentity | channel, externalId, username, displayName |
| Tag / CustomerTag | نام یکتا، رنگ |
| CustomerNote | authorId, content |
| Lead | status NEW..CLOSED, score 0-100, intent, interestedProductId, estimatedValue, assignedTo |
| FollowUp | type CALL/MESSAGE/VISIT/EMAIL/OTHER, status PENDING..FAILED, scheduledAt, leadId nullable |
| Message | channel Source, direction INBOUND/OUTBOUND, externalMessageId + @@unique(channel,externalMessageId), status RECEIVED..IGNORED |
| CustomerTimeline | eventType, title, description, actorId, metadata |

## Phone Normalization

```js
normalizePhone(raw):
  1. فارسی/عربی → انگلیسی
  2. حذف فاصله/-
  3. حذف +98/0098/98
  4. حذف 0 اول
  5. بررسی 10 رقم و شروع با 9 → '0'+s
```

مثال: `09017909857`, `+989017909857`, `00989017909857`, `۰۹۰۱۷۹۰۹۸۵۷` → `09017909857`

## Deduplication & Merge

- تشخیص via `normalizedPhone` و `CustomerIdentity`
- AUTO MERGE فقط اگر `normalizedPhone` یکسان و Rule قطعی
- Ambiguous → `PENDING_REVIEW` (انجام نشده، CEO تصمیم)
- Merge: Transactional, Audited, Idempotent (`idempotency_keys` scope `customer-merge`), Reversible نه اما تمام روابط منتقل می‌شود
- Endpoint: `POST /api/customers/:id/merge {sourceId}`

## Timeline

هر رویداد مهم یک `CustomerTimeline` ایجاد می‌کند:
`CUSTOMER_CREATED, CUSTOMER_UPDATED, CUSTOMER_STATUS_CHANGED, CUSTOMER_TAGGED, TAG_REMOVED, CUSTOMER_MERGED, MESSAGE_RECEIVED/SENT, LEAD_CREATED/UPDATED, FOLLOWUP_CREATED/COMPLETED, NOTE_CREATED, ORDER_STATUS_CHANGED`

`GET /api/customers/:id/timeline?page&limit&eventType&from&to`

## Lead Scoring Rule Engine

```js
score = messageCount*5
 + (productInquiry?15:0)
 + (priceInquiry?20:0)
 + (stockInquiry?10:0)
 + (repeatedContact?15:0)
 + (previousPurchase?25:0)
 + (highValue?30:0)
 + (quotation?25:0)
 capped 100
```

AI فقط Recommendation، تصمیم نهایی با Rule Engine.

## Follow-up Engine

- DB-backed `scheduledAt`, `status PENDING→RUNNING→COMPLETED/CANCELLED/FAILED`
- Duplicate prevention: `findFirst({leadId, scheduledAt, status:PENDING})` → 409
- Idempotency via unique scheduledAt+leadId

## Search & Pagination

- `GET /api/customers?search=&status=&source=&tag=&page=&limit=` 
- `search` روی `phone/normalizedPhone/name/email` با `contains` + `mode:insensitive` و index
- `page 1..`, `limit 1..100`, `total/pages` در response
- Frontend debounce 400ms

## 360 Dashboard

`GET /api/customers/:id/360` → customer + kpi{totalOrders, totalSpend Decimal, avgOrderValue, lastOrder, openLeads, pendingFollowups} + timeline(20) + orders(10) + messages(10) + leads(10) + followups(10) + notes(10) + payments

## RBAC

Permissions map:

- CEO: `*`
- ADMIN: customers.*, messages.*, leads.*, followups.*, orders.*, audit.read
- MANAGER: read-only
- SALES: customers.read, leads.*
- SUPPORT: customers.read, messages.*

Middleware `requirePerm(perm)` → 403

## Transactions

- Customer create + Identity + Timeline + Audit
- Merge (move identities/messages/leads/followUps/notes/tags/orders + timeline + audit + delete source + idempotencyKey)
- Lead create + customer status LEAD + timeline + audit
- FollowUp create/complete + timeline + audit
- Order status + inventory ledger
