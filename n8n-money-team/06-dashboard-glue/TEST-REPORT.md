# 🧪 گزارش تست واقعی — پل تلگرام به CRM

این گزارش از **اجرای واقعی** فایل `01-telegram-to-crm-delivery.json` به‌دست آمده است، نه از روی حدس.
کد گره‌های `Code` عیناً اجرا شده، `expression`ها ارزیابی شده و درخواست‌های HTTP واقعاً به یک سرور
mock که **دقیقاً همان قرارداد داشبورد** را پیاده کرده فرستاده شده است.

## چطور خودت هم اجرا کنی

```bash
# ترمینال ۱ — سرور mock داشبورد (بدون نیاز به Postgres)
node 06-dashboard-glue/test/mock-crm.js
# 🧪 Mock ceo-dashboard روی http://0.0.0.0:3000

# ترمینال ۲ — اجرای ۴ سناریو روی همان فایل ورک‌فلو
WF=./06-dashboard-glue/01-telegram-to-crm-delivery.json \
  node 06-dashboard-glue/test/simulate.js
```

> قبل از اجرا، سه جای `CHANGE_ME_*` را در فایل ورک‌فلو با مقادیر تست عوض کن
> (یا یک کپی بگیر) — همان کاری که در گزارش زیر انجام شده.

---

## نتیجهٔ اجرا

```
══════════════════════════════════════════════════════════════════════════════
🧪 سناریو ۱) استعلام قیمت (مسیر کامل)
▶ Webhook Telegram ← POST /webhook/telegram-crm
   • Code Normalize → 1 آیتم
   • IF Is Customer → شاخهٔ درست (true)
   ↳ CRM Webhook → POST /api/integrations/telegram/webhook ⇒ 200
   • Code Read CRM Result → 1 آیتم
   • IF CRM OK → شاخهٔ درست (true)
   • IF Duplicate → شاخهٔ نادرست (false)
   ↳ CRM Login → POST /api/auth/login ⇒ 200
   • Code Read Login → 1 آیتم
   • Wait Wait Agent → 7 seconds
   ↳ Fetch Messages → GET /api/customers/cus_mvaabrl01/messages?limit=8 ⇒ 200
   • Code Pick Reply → 1 آیتم
   • IF Has Reply → شاخهٔ درست (true)
   ↳ Send Telegram → POST /api/integrations/telegram/send ⇒ 200
   ↳ Tag Customer → POST /api/customers/cus_mvaabrl01/tags ⇒ 201
   • Respond Respond Done → HTTP 200

پاسخ نهایی:
{
  "success": true,
  "replied": true,
  "customerId": "cus_mvaabrl01",
  "leadId": "lead_mvaabrl03",
  "tag": "استعلام قیمت",
  "replyPreview": "سلام 🙂 ممنون از پیام شما. قیمت بستهٔ حرفه‌ای ما ۱۲٬۵۰۰٬۰۰۰ تومان است (شامل ۲۰ پ",
  "providerMessageId": "tg_mvaabx0b",
  "telegramSentOk": true,
  "tagApplied": true
}
```

```
══════════════════════════════════════════════════════════════════════════════
🧪 سناریو ۲) همان آپدیت تکراری
   • IF Duplicate → شاخهٔ درست (true)
   • Respond Respond Duplicate → HTTP 200
پاسخ: {"success":true,"duplicate":true,"customerId":null}      ✅ بدون اثر جانبی
```

```
══════════════════════════════════════════════════════════════════════════════
🧪 سناریو ۳) پست خودِ کانال (نباید مشتری شود)
   • IF Is Customer → شاخهٔ نادرست (false)
   • Respond Respond Skip → HTTP 200
پاسخ: {"success":true,"skipped":true,"reason":"پست خودِ کانال است، مشتری نیست","update_id":"900002"}
```

```
══════════════════════════════════════════════════════════════════════════════
🧪 سناریو ۴) سؤال موجودی از مشتری جدید
   ↳ Fetch Messages → GET /api/customers/cus_mvaabx0r7/messages?limit=8 ⇒ 200
   ↳ Send Telegram → POST /api/integrations/telegram/send ⇒ 200
   ↳ Tag Customer → POST /api/customers/cus_mvaabx0r7/tags ⇒ 201
پاسخ: {"success":true,"replied":true,"tag":"استعلام موجودی","telegramSentOk":true,"tagApplied":true}

نتیجه: 4 سناریو موفق، 0 ناموفق
```

---

## لاگ سمت CRM (mock) — اثبات زنجیرهٔ کامل

```
[crm] پیام از مریم رضایی دریافت شد → مشتری cus_mvaabrl01 + لید
[agent] پاسخ برای cus_mvaabrl01 ساخته شد (221 کاراکتر) — ولی ارسال نشد   ← جای خالی داشبورد
📤 پیام به مشتری cus_mvaabrl01 در تلگرام ارسال شد:                        ← کار این ورک‌فلو
   "سلام 🙂 ممنون از پیام شما. قیمت بستهٔ حرفه‌ای ما ۱۲٬۵۰۰٬۰۰۰ تومان است…"
[crm] برچسب «استعلام قیمت» روی مشتری cus_mvaabrl01 ثبت شد
```

جملهٔ `ولی ارسال نشد` و بعد `ارسال شد` دقیقاً نشان می‌دهد این ورک‌فلو چه چیزی را حل می‌کند.

---

## باگ‌هایی که همین تست پیدا کرد و اصلاح شدند

| # | مشکل | اصلاح |
|---|-------|-------|
| ۱ | سیم‌کشی شاخهٔ «تکراری» برعکس بود؛ آپدیت تکراری وارد مسیر اصلی می‌شد و آپدیت سالم به پاسخ تکراری می‌رفت | `Duplicate` حالا: true → پاسخ تکراری، false → ادامهٔ مسیر |
| ۲ | اگر CRM بدون `customerId` جواب ۲۰۰ می‌داد (مثلاً آپدیت تکراری)، آدرس می‌شد `/api/customers//messages` | شرط موفقیت به «کد ۲۰۰/۲۰۱ **و** وجود مشتری یا تکراری‌بودن» تغییر کرد |
| ۳ | پاسخ نهایی `providerMessageId` و وضعیت ارسال را گزارش نمی‌کرد | پاسخ نهایی حالا از گره‌های `Send Telegram` و `Tag Customer` می‌خواند |

---

## محدودیت‌های این تست (صادقانه)

- داشبورد واقعی به **Postgres** نیاز دارد و در این محیط Postgres/Docker نبود؛ بنابراین قرارداد API
  در یک سرور mock **عیناً** بازسازی شد (همان کدهای خطا، همان هدرها، همان ساختار پاسخ).
- این آزمون موتور n8n نیست؛ یک شبیه‌ساز است که **همان فایل** را با همان معناشناسی گره‌ها اجرا می‌کند.
  در محیط خودت، ورک‌فلو را در n8n ایمپورت کن و یک بار با `Execute Workflow` واقعی هم تست کن.
- gره‌های `Wait` و `IF` و `Code` طبق رفتار مستند n8n پیاده‌سازی شده‌اند؛ نودهای Credential-محور
  (مثل OpenAI) در این ورک‌فلو استفاده نشده تا همه‌چیز با HTTP خام و قابل‌کنترل بماند.
