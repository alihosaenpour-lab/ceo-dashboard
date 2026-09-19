# آنالیز ایجنت آرشیا مارکت — چی کمه و برای حرفه‌ای شدن چی باید اضافه بشه
تاریخ: 2026-09-17 | وضعیت فعلی: Phase 3-4 تکمیل (DB+CRM+Integrations) | محیط: development Frankfurt

> خلاصه یک خطی: اسکلت حرفه‌ای (Prisma + Pipeline + RBAC + Idempotency + HumanReview) ساخته شده، ولی **مغز ایجنت، اتوماسیون واقعی و هوش LLM** هنوز وصل نیست — الان ۷ پرسنل فقط آیکون خاموش/روشن هستند، نه ایجنت خودمختار.

---

## 1) وضع موجود — چی خوب ساخته شده (نقطه قوت)

| بخش | وضعیت | توضیح |
|---|---|---|
| **Core DB** | ✅ عالی | 28 مدل Prisma، ایندکس، تراکنش اتمیک موجودی (`WHERE quantity>=qty` + `updateMany`)، تریسیبیلیتی کامل |
| **CRM 360** | ✅ عالی | Customer/Identity/Lead/FollowUp/Timeline/Note/Tag/Merge transactional + جستجو/صفحه‌بندی |
| **Pipeline واحد** | ✅ خوب | `lib/integrations/pipeline.js` برای تلگرام/اینستا/وب‌سایت/باسلام (Idempotency + Normalize + LeadScore) |
| **Integrations Hub** | ✅ اسکلت | Central Control Plane (۵۵۴ خط) + Credential رمزنگاری AES + ماسک •••• + تست |
| **باسلام وب‌هوک** | ✅ حرفه‌ای | نگاشت محصول Deterministic (NFC/ZWNJ)، fallback ممنوع، HUMAN_REVIEW اتومات، موجودی اتمیک، INSUFFICIENT_STOCK |
| **امنیت** | ✅ قوی | Helmet/CORS/RateLimit/JWT httpOnly/CSRF/Zod/XSS/SQLi/RequestID/PII masking/AuditLog |
| **فرانت** | ✅ قابل قبول | لاگین OTP، داشبورد، CRM 360، HumanReview، اتصالات |

**یعنی فونداسیون برای اتوماسیون حرفه‌ای آماده است — فقط موتور اتوماسیون روشن نشده.**

---

## 2) گپ اصلی — چرا الان "اتوماسیون حرفه‌ای" نیست

### 2.1 مغز ایجنت (Brain) — بزرگترین گپ 🔴 P0

| گپ | وضعیت فعلی | چرا حرفه‌ای نیست | چی باید اضافه بشه | فایل |
|---|---|---|---|---|
| **LLM وصل نیست** | ❌ نیست | `pipeline.detectAndCreateLead` فقط `includes('price')` و `score = messageCount*5` — هوش واقعی صفر | `lib/agentRunner.js` + OpenAI/Claude + PromptTemplate DB | `lib/integrations/pipeline.js:13` |
| **Prompt هاردکد** | ⚠️ نصفه | `PromptTemplate` جدول دارد ولی هیچ‌جا `prisma.promptTemplate.findUnique` نمی‌شود، پرامپت‌ها داخل کد JS هاردکد | سرویس `promptService.getActive('sales.reply')` + نسخه‌بندی + Rollback UI | `prisma/schema.prisma:PromptTemplate`, `index.html:publishContent()` |
| **حافظه/کانتکست** | ❌ نیست | ایجنت هر پیام را ایزوله می‌بیند، تاریخچه مشتری/سفارش/لید را به LLM نمی‌دهد | `lib/agent/memory.js` (آخرین 20 پیام + سفارش + لید + پرسونای برند از BusinessSetting) | `lib/integrations/pipeline.js:resolveOrCreate...` |
| **هویت و نقش واقعی** | ⚠️ فیک | `personnel=[{name:'مدیر داخلی', on:true}]` فقط toggle UI، هیچ `agentId/role/prompt/tools` در DB ست نمی‌شود | جدول `Agent` واقعی (name/role/systemPrompt/tools/channels/rules) + اتصال به `AgentPermission` | `index.html:personnel`, `prisma:AgentPermission` |
| **تصمیم‌گیری خودمختار** | ❌ نیست | هیچ حلقه `observe → think (LLM) → act (tool) → audit` نیست، فقط webhook → createLead | Orchestrator با State Machine (PENDING → THINKING → TOOL_CALL → HUMAN_REVIEW → RESPONDED) | جایی نیست |
| **یادگیری** | ❌ نیست | هیچ فیدبکی از Approve/Reject انسان به پرامپت برنمی‌گردد | `humanReview → promptVersion++` + few-shot examples | `server.js:human-reviews` |

### 2.2 ابزارها (Tool Layer) — نیمه‌کاره 🟡 P0

| گپ | فعلی | حرفه‌ای |
|---|---|---|
| **۱۲ ابزار فقط** | `toolRegistry.js` فقط 12 تا (telegram.send, instagram.publish, basalam.getOrder...) | باید 30+ شود: `basalam.createProduct`, `basalam.updateInventory`, `basalam.getOrders` (polling), `customer.search`, `order.create`, `inventory.reserve`, `payment.create`, `media.upload`, `prompt.render` ... |
| **اجرا صوری** | `GET /api/integrations/tools` فقط لیست JSON برمی‌گرداند، هیچ `POST /api/agent/callTool` با RBAC/RateLimit/Audit نیست | `POST /api/agent/tools/:tool` با Zod + `AgentPermission` + `toolAudit` + Idempotency |
| **پرمیشن نمایشی** | `AgentPermission` مدل دارد ولی هیچ‌جا چک نمی‌شود (`requirePerm` فقط برای User، نه Agent) | `checkAgentPermission(agentId, provider, action)` قبل هر `sendTelegramMessage` |
| **هیچ سندباکس** | ایجنت می‌تواند هرچیزی بنویسد، XSS فقط `escapeXSS` ساده | Tool sandbox + JSON Schema validation + Output sanitizer |

### 2.3 اتوماسیون انجین — نیست 🔴 P0

| گپ | فعلی | باید |
|---|---|---|
| **صف/Job Queue** | ❌ هیچ صف نیست — همه `await prisma.$transaction` سینکرون | `BullMQ + Redis` یا `Agenda` برای: `telegram.send` (retry 200ms/800ms)، `followUp scheduler`، `basalam sync`، `content publish` |
| **زمان‌بند** | ❌ `ScheduledContent` فقط `status=PENDING_APPROVAL`، هیچ cron نیست | `cron 09:00 & 18:00` → `agentRunner.generateContent()` → HumanReview → `instagram.publish` اتومات |
| **تریگرها** | فقط webhook (تلگرام/باسلام) | + `order.created`, `inventory.low`, `lead.created`, `followUp.due`, `abandonedCart 15m`, `noReply 2h` |
| **Human-in-the-loop واقعی** | HumanReview دارد ولی UI فقط `Approve/Reject` بدون `Edit/Retry/Assign/Comment` | UI کامل: ویرایش کپشن/قیمت + `reprocess` با `productId` + تخصیص به انسان + کامنت |
| **فال‌بک** | کم | هر Tool باید `retry + exponential backoff + DEGRADED → HumanReview` داشته باشد (تلگرام الان دارد، باسلام/اینستا نه) |
| **Abandoned / Nurturing** | ❌ نیست | اتوماسیون: `سفارش PENDING 30m → یادآوری تلگرام`, `لید NEW 2h → پیگیری خودکار`, `VIP 7 روز بی‌خرید → پیشنهاد` |

### 2.4 عمق اینتگریشن‌ها — تست‌محور 🟡 P1

**باسلام:**
- ✅ Webhook + نگاشت حرفه‌ای
- ❌ **Polling sync نیست** (`POST /api/integrations/basalam/sync` فقط `count` برمی‌گرداند، هیچ `GET api.basalam.com/products` واقعی)
- ❌ Update محصول/موجودی به باسلام پوش نمی‌شود
- ❌ سفارش `SHIPPED` به باسلام اعلام نمی‌شود → مشتری کد رهگیری نمی‌گیرد

**تلگرام:**
- ✅ Webhook + Pipeline خوب
- ❌ **پاسخ هوش مصنوعی نیست** — فقط `createInboundMessage`، هیچ `agent.generateReply(context)` و `sendMessage`
- ❌ دکمه شیشه‌ای (InlineKeyboard) برای تایید سفارش از داخل تلگرام ندارد

**اینستاگرام:**
- ✅ OAuth skeleton + Webhook
- ❌ Publish فقط `providerId = ig_${Date.now()}` فیک — هیچ `POST graph.facebook.com/media` واقعی (با توکن dummy باید `NOT VERIFIED` بده که الان می‌دهد — درست، ولی برای حرفه‌ای باید واقعی شود)
- ❌ کامنت/Dm اتومات با LLM نیست، فقط ورودی ذخیره می‌شود

**وب‌سایت:**
- ✅ `website/messages` خوب
- ❌ **ویجت چت** ندارد — مشتری کجا پیام بدهد؟ فقط API
- ❌ سشن/کوکی/آنالیتیکس اتصال ندارد

### 2.5 هوش و محتوا — دموی ساده 🟡 P1

| گپ | فعلی | حرفه‌ای |
|---|---|---|
| **استودیو محتوا** | 3 کارت استاتیک با `onclick=publishContent` فیک | Pipeline واقعی: `BusinessSetting(brand) + PromptTemplate(marketing) + Product(purforosh) → LLM → image (DALL·E) + caption + hashtag → HumanReview → schedule → publish → analytics` |
| **زمان‌بند فردا** | DB دارد ولی cron ندارد | بالا |
| **Media Library** | جدول `MediaAsset` هست ولی هیچ آپلود/تگ/استفاده نیست | `POST /api/media/upload` (S3/R2) + تگ + انتخاب در محتوا |
| **شخصی‌سازی** | هیچ | محتوا بر اساس `Customer.segment` (VIP/NEW) متفاوت |

### 2.6 اتوماسیون بیزینس — ناقص 🟡 P1

- **سفارش → تسویه:** `order.status PATCH` دارد ولی هیچ اتوماسیون `CONFIRMED → Payment → Shipment → تلگرام به مشتری` نیست
- **انبار → تامین:** `inventory.low` نمایش دارد ولی هیچ `auto-create PurchaseOrder → تلگرام به تامین‌کننده` نیست
- **CRM → فروش:** Lead Score ساده است، هیچ `auto-assign به Sales + followUp 2h + اگر WON → order` نیست
- **آنالیتیکس:** KPI های داشبورد هاردکد یا `salesToday 0` — هیچ `revenue/profit/CR/AOV funnel` اتومات نیست

### 2.7 مشاهده‌پذیری (Observability) — کم 🔵 P1

- لاگ JSON دارد ولی **TraceId در کل Pipeline** نیست (از webhook تا publish)
- هیچ **داشبورد Agent** (چند پیام/چند Tool/چند HumanReview/میانگین تاخیر) نیست
- هیچ **آلرت** (تلگرام به مدیر وقتی `ERROR` یا `Inventory insufficient` یا `Instagram REAUTH_REQUIRED`) نیست
- Health فقط DB چک می‌کند، نه `telegram.getMe` / `basalam.getProducts` / `instagram me/accounts`

---

## 3) چی اضافه کن که حرفه‌ای شود — نقشه راه اولویت‌دار

### فاز 4.5 — فوری (1-2 روزه) — P0 باید همین الان

1. **Agent Runner واقعی** `lib/agent/runner.js`
   - `async runAgent({ channel, customerId, messageId })`: load (customer360 + last 10 messages + prompt) → LLM → toolCalls (Zod) → execute via ToolRegistry → reply → audit
   - وصل به `pipeline.createInboundMessage` بعد از `detectAndCreateLead`

2. **Tool Execution Endpoint** `POST /api/agent/tools/:name`
   - RBAC: `AgentPermission`, RateLimit per agent, Zod schema, Idempotency-Key, AuditLog

3. **Job Queue** (BullMQ + Redis یا `pg-boss` اگر Redis ندارید)
   - صف `telegram.outbound`, `instagram.publish`, `basalam.sync`, `followup.due`

4. **Cron های پایه**
   - `*/5 * * * *` چک `FollowUp.scheduledAt <= now && PENDING → RUNNING → (LLM generate reminder) → Telegram/WhatsApp`
   - `0 9,18 * * *` `generateDraftContentForTomorrow()`

5. **اتصال LLM + PromptTemplate**
   - `promptService.render('sales.reply', {customer, history, brand})` + نسخه‌بندی
   - کلید `OPENAI_API_KEY` یا `ANTHROPIC_API_KEY` در Central Control Plane (Encrypted)

### فاز 5 — حرفه‌ای (1-2 هفته) — P1

6. **Basalam Real Sync**
   - `GET /v1/vendors/{id}/products?limit=100` pagination + `upsert Product/Inventory` + `lastSyncAt`
   - `PATCH /v1/products/{id}/stock` وقتی سفارش تایید شد

7. **Telegram AI Responder + دکمه**
   - پاسخ LLM با تاریخچه + دکمه `✅ تایید سفارش #1042` (InlineKeyboard callback → `PATCH order/status`)

8. **Instagram Real Publish**
   - دو مرحله‌ای: `POST /{ig_user_id}/media` → `POST /{ig_user_id}/media_publish` + polling
   - Webhook کامنت → LLM → reply

9. **Website Widget**
   - `widget.js` سبک (bubble) → `POST /api/integrations/website/messages` + سشن

10. **CRM Automation**
    - `Lead NEW 15m → auto FollowUp`, `Order PENDING 24h → reminder`, `VIP 7d inactive → offer`
    - `Lead.score` با LLM intent (نه فقط keyword)

11. **HumanReview UI کامل**
    - صفحه `/human-reviews` با فیلتر provider/status + `Edit title/price` + `Approve with edit` + `Reprocess` واقعی

12. **Observability**
    - `GET /api/agent/metrics` (today: messages 42, toolCalls 18, humanReviews 3, avgLatency 1.2s)
    - آلرت تلگرام به CEO وقتی `DEGRADED/ERROR`

### فاز 6 — الیت (ماه بعد) — P2 لوکس

13. **Knowledge Base + RAG**
    - `BusinessSetting + Product.description + FAQ` → Vector (pgvector) → ایجنت جواب دقیق از دانش خودت، نه هذیان

14. **Voice / WhatsApp / Email**
    - `whatsapp.send` (Meta), `voice.call` (Kavenegar voice), `email.send`

15. **Analytics & Forecast**
    - داشبورد: `Revenue funnel, CR by source, AOV, Inventory forecast, Content ROI`

16. **A/B & Learning**
    - دو نسخه پرامپت → HumanReview Approve rate → auto promote winner

---

## 4) چک‌لیست سریع برای تو — تیک بزن

**الان داری ✅**
- [x] DB حرفه‌ای + CRM 360 + Pipeline + Idempotency + HumanReview + موجودی اتمیک + Central Control Plane

**همین الان اضافه کن (P0)**
- [ ] `lib/agent/runner.js` + LLM
- [ ] `POST /api/agent/tools/*` + AgentPermission check واقعی
- [ ] Queue (BullMQ) + Cron followUp/content
- [ ] PromptTemplate render + اتصال به Pipeline
- [ ] Basalam polling واقعی (نه count فیک)

**برای حرفه‌ای (P1)**
- [ ] Telegram دکمه تایید + پاسخ AI
- [ ] Instagram publish واقعی (Graph API)
- [ ] Website widget.js
- [ ] CRM nurturing اتومات
- [ ] HumanReview UI کامل + Metrics + Alert

---

## 5) پیشنهاد من برای شروع فردا (با کمترین ریسک)

اگر بخوای دقیقاً مثل درخواستت "بدون نقص و اتوماسیون دقیق" بریم، من پیشنهاد می‌کنم **همین ترتیب**:

**قدم 1 (امروز):** Agent Runner + 1 Tool واقعی (`telegram.send`) + 1 Prompt (`sales.reply`) → تست End-to-End: `پیام تلگرام → LLM → پاسخ تلگرام` با لاگ کامل.

**قدم 2 (فردا):** Queue + FollowUp cron → دیگه هیچ پیگیر‌ی‌ای جا نمی‌ماند.

**قدم 3:** Basalam sync واقعی + دکمه تایید تلگرامی → چرخه سفارش اتومات کامل.

این سه قدم سیستم را از "نمایشی" به "حرفه‌ایِ پول‌ساز" تبدیل می‌کند — بقیه (اینستا، ویجت، RAG) بعد.

> آماده‌ای قدم 1 را همین الان شروع کنیم؟ اگر بله، کلید LLM (OpenAI یا Claude) را بده یا بگو با Mock LLM شروع کنیم تا فردا کلید اصلی را بیاوری — من `lib/agent/runner.js` و اتصال PromptTemplate را می‌نویسم و تست Live می‌کنم.

