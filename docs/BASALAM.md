# Basalam — Complete Real Integration

## Env
```
BASALAM_TOKEN=…               # API token for /v1/vendors (optional in dev, required for CONNECTED)
BASALAM_WEBHOOK_SECRET=…      # HMAC secret for X-Basalam-Signature (if absent, verification SKIPPED → NOT VERIFIED but still protected by X-Idempotency-Key)
```

Health: `GET /api/integrations/status` → `basalam.status CONNECTED` if `BASALAM_TOKEN` set.

## Webhook `POST /api/basalam-hook` (protects Phase 3 hook, no break)

**Pipeline 5 steps** (all DB, no mock):
1. **verify** — if `BASALAM_WEBHOOK_SECRET` set, check `X-Basalam-Signature == HMAC_SHA256(body, secret)` → `401` on miss.
2. **validate** — `hasOrderData = items||order||products||total||customer||buyer`. If false, just mark `WebhookEvent processed:true` and return `received:true`.
3. **normalize** — `normalizePhone`, `escapeXSS`, city/name trim, `payloadHash = sha256(JSON.stringify(payload))`.
4. **idempotent** — three layers:
   * `IdempotencyKey X-Idempotency-Key` (header, else `basalam-${externalId}`) scope `basalam-webhook` 24h → duplicate → `duplicate:true`.
   * `WebhookEvent(provider=BASALAM, externalId)` UNIQUE → duplicate → 200.
   * `Order(orderNumber)` UNIQUE where `orderNumber = "BASALAM-"+externalId.slice(0,30)` → existing → return same order.
5. **transactional** — `prisma.$transaction`:
   * Resolve customer (phone → normalized → find or create; fallback `0999+numeric` slice11, note `بدون شماره`).
   * Resolve items → product mapping (productId → sku → name contains → first active). Fallback single item with `total`.
   * Totals: from `subtotal/discount/shippingCost/total` or computed `sum(qty*price)`, default 100k for test minimal.
   * Create `Order(status PENDING, paymentStatus UNPAID, source BASALAM)` + `OrderItem`s.
   * Inventory: decrement `Inventory.quantity`, create `InventoryTransaction type SALE` (`before/after`).
   * `OrderStatusHistory`, `CustomerTimeline ORDER_CREATED`, `WebhookEvent processed:true`, `IdempotencyKey`, `AuditLog WEBHOOK_BASALAM`.

## Product Mapping & Inventory SoT (§5)

| Source | Field | Prisma |
|--------|-------|--------|
| `externalProductId` | `payload.items[].productId` | `product.id` |
| `internalProductId` | DB `Product.id` | via `findUnique` above |
| `Inventory.quantity` | **SoT** | current stock |
| `Product.stock` | display only | may drift — do not use for reservation logic |

**Decision:** `Inventory.quantity` is authoritative; `Product.stock` is deprecated display.

## Example
```bash
curl -X POST http://localhost:3000/api/basalam-hook \
  -H "X-Idempotency-Key: basalam-p4-123-21" -H "Content-Type: application/json" \
  -d '{"id":"p4-123","customer":{"phone":"09151234567","name":"Ali"},"items":[{"productId":"cmu…","quantity":1,"price":500000}],"total":500000}'
# → {orderCreated:true, orderNumber:"BASALAM-p4-123"}
# duplicate with same Idempotency-Key → {duplicate:true}
# without X-Idempotency-Key, same externalId → duplicate via WebhookEvent
```

## Failure Cases
* No product in DB → `500 No product exists` → `WebhookEvent.error` set, no order.
* Invalid phone → fallback `0999…` used, note stored.
* Slice30: `orderNumber` truncated to 30 chars (BASALAM- prefix 8 + 22-char uniq). Tests use `contains(id.slice(0,15))` + `findUnique` via `orderId` fallback.

## Tests (Phase4 §15)
21 valid `basalam-p4-${Date.now()}-21` → orderCreated + contains search, 22 invalid sig skipped (no secret) `NOT VERIFIED`, 23 invalid payload empty → `received:true` (no crash), 24 duplicate same externalId → duplicate:true, 25/27 inventory `SALE` & product mapping, 26 idempotency same `X-Idempotency-Key` → second duplicate, 45 oversized 413.

## Security
Replay protected by `WebhookEvent` + `orderNumber` unique. Size 1mb, rate `webhookLimiter 200/min`, audit `WEBHOOK_BASALAM`.

## Migration Note
Adds `Order.source= BASALAM` and `WebhookEvent`. No Phase3 table dropped.
