# CRM Lifecycle — Phase 3

## State Machine: CustomerStatus

```
NEW → LEAD → ACTIVE → CUSTOMER → VIP → INACTIVE → BLOCKED
 |      |       |         |       |
 └──────┴───────┴─────────┴───────┘ (downgrade via PATCH with audit)

NEW (اولین دیده شدن)
 ↓ (message/lead created → score)
LEAD (فرصت فروش)
 ↓ (contacted/qualified)
ACTIVE (در تعامل)
 ↓ (order created)
CUSTOMER (یک خرید)
 ↓ (repeat purchase / high value)
VIP
 ↓ (60 روز بدون فعالیت)
INACTIVE
 ↓ (manual)
BLOCKED
```

**Transition Rules:**
- `NEW → VIP` فقط CEO/ADMIN (403 برای SUPPORT)
- هر Transition: `PATCH /api/customers/:id {status}` → transaction + `CustomerTimeline` `CUSTOMER_STATUS_CHANGED` + `AuditLog` + `requestId`
- Validation via Zod enum, not raw body

## Lead Lifecycle

```
NEW → CONTACTED → QUALIFIED → QUOTED → NEGOTIATING → WON
                                           ↘ LOST → CLOSED
```

- `POST /api/leads` → `NEW`, score calculated, customer status→LEAD
- `PATCH /api/leads/:id {status}` → timeline `LEAD_UPDATED`

## FollowUp Lifecycle

```
PENDING → RUNNING → COMPLETED
   ↘ CANCELLED / FAILED
```

- DB-backed `scheduledAt`, no `setTimeout`
- `POST /api/leads/:id/followup` → `PENDING`
- `PATCH /api/followups/:id {status:COMPLETED}` → `completedAt=now()` + timeline `FOLLOWUP_COMPLETED`

## Order ↔ Customer

- Order always has `customerId` FK (if webhook without customer → create `Unresolved Customer` then resolution - not yet auto, manual via merge)
- `GET /api/customers/:id/orders` shows orders, `GET /api/customers/:id/360` aggregates `totalOrders, totalSpend Decimal, avgOrderValue`
- Order status change `→` customer timeline `ORDER_STATUS_CHANGED`

## Payment ↔ Customer

- Payments via `order.customerId` → 360 `payments` list, `totalSpend` sum of `order.total` Decimal (not frontend calc)

## Timeline Events (CustomerTimeline)

| eventType | trigger |
|---|---|
| CUSTOMER_CREATED | POST /api/customers |
| CUSTOMER_UPDATED / STATUS_CHANGED | PATCH |
| CUSTOMER_TAGGED / TAG_REMOVED | POST/DELETE tags |
| CUSTOMER_MERGED | POST merge |
| MESSAGE_RECEIVED/SENT | POST /api/messages |
| LEAD_CREATED/UPDATED | POST/PATCH leads |
| FOLLOWUP_CREATED/COMPLETED | followup create/complete |
| NOTE_CREATED | POST notes |
| ORDER_STATUS_CHANGED | PATCH orders/:id/status |

API: `GET /api/customers/:id/timeline?page&limit&eventType&from&to` → pagination, filters, indexes on `customerId, eventType, createdAt`

## End-to-End Flow Example

1. `POST /api/customers {phone:09120000001}` → `CUSTOMER_CREATED` + `Identity PHONE`
2. `POST /api/messages {customerId, channel:TELEGRAM, content:"قیمت؟", externalMessageId}` → `MESSAGE_RECEIVED` + `lastSeenAt`
3. `POST /api/leads {customerId, intent:"price inquiry", interestedProductId, estimatedValue}` → score 65, `LEAD_CREATED`, customer→LEAD
4. `POST /api/leads/:id/followup {scheduledAt, reason}` → `FOLLOWUP_CREATED` PENDING
5. `POST /api/orders` (via webhook or manual) → order + `ORDER_CREATED` in timeline
6. `PATCH /api/orders/:id/status {APPROVED}` → inventory RESERVATION + timeline
7. `PATCH /api/followups/:id {COMPLETED}` → `FOLLOWUP_COMPLETED`
8. `GET /api/customers/:id/360` → full view with KPI from DB

CRM is Source of Truth; AI is assistant layer (future).
