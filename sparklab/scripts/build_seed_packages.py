#!/usr/bin/env python3
"""Builds the seeded digital products' delivery packages (real zip files)
into sparklab/storage/private/files/. Each package contains a Persian setup
guide (README-fa.md), a license file, version info and product-specific payload."""
import os, zipfile, json, datetime

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'storage', 'private', 'files')
os.makedirs(BASE, exist_ok=True)

PRODUCTS = {
  'spark-pos-cloud': dict(ver='2.4.0', title='داشبورد فروش ابری اسپارک', extra={
    'schema/pos_schema.sql': "-- Spark POS Cloud v2.4 — PostgreSQL schema\nCREATE TABLE sales (id BIGSERIAL PRIMARY KEY, branch_id INT NOT NULL, total BIGINT NOT NULL, paid_at TIMESTAMPTZ DEFAULT now());\nCREATE TABLE products (id SERIAL PRIMARY KEY, sku TEXT UNIQUE, name TEXT, price BIGINT);\n",
    'config/sample.env': "DB_URL=postgres://user:pass@localhost:5432/sparkpos\nJWT_SECRET=change-me\nBRANCH_CODE=tehran-01\n",
    'docs/deploy.md': "# راهنمای استقرار\n1. دیتابیس را با فایل schema بسازید.\n2. متغیرهای محیطی را در config/.env تنظیم کنید.\n3. سرویس را با docker compose up -d اجرا کنید.\n",
  }),
  'spark-crm-suite': dict(ver='3.1.2', title='سوئیت مدیریت ارتباط با مشتری اسپارک', extra={
    'schema/crm_schema.sql': "-- Spark CRM v3.1 — schema\nCREATE TABLE leads (id BIGSERIAL PRIMARY KEY, name TEXT, phone TEXT, stage TEXT DEFAULT 'new');\nCREATE TABLE activities (id BIGSERIAL PRIMARY KEY, lead_id BIGINT REFERENCES leads(id), note TEXT, at TIMESTAMPTZ DEFAULT now());\n",
    'docs/pipeline.md': "# تعریف مراحل پایپلاین فروش\nمراحل پیش‌فرض: جدید → تماس اولیه → پیشنهاد → مذاکره → برد/باخت\n",
  }),
  'nova-commerce-theme': dict(ver='1.8.3', title='قالب فروشگاهی نوا', extra={
    'theme.json': json.dumps({"name": "Nova Commerce", "version": "1.8.3", "rtl": True, "palette": {"primary": "#22D3EE", "dark": "#0B1220"}, "layouts": ["home", "shop", "product", "cart", "checkout"]}, ensure_ascii=False, indent=2),
    'docs/customize.md': "# شخصی‌سازی\nرنگ‌ها و فونت‌ها از theme.json قابل تغییر است. بخش‌های صفحه اصلی با ویجت‌های قابل拖 و رها تنظیم می‌شوند.\n".replace("拖 و رها", "کشیدن و رها کردن"),
  }),
  'sparkgo-delivery-app': dict(ver='2.0.1', title='اپلیکیشن سفارش و پیک اسپارک‌گو', extra={
    'src/README.md': "# ساختار سورس\n- app/ : لایه UI (React Native)\n- server/ : API سمت سرور (Node.js)\n- docs/api.md : مستند endpoints\n",
    'docs/api.md': "# API\nPOST /api/orders — ثبت سفارش\nGET /api/couriers/:id/location — موقعیت زنده پیک\n",
  }),
  'spark-ai-assistant': dict(ver='1.5.0', title='دستیار هوشمند کسب‌وکار اسپارک', extra={
    'config/assistants.sample.json': json.dumps([{"id": "support", "persona": "پشتیبان فروشگاه", "tools": ["faq", "order-status"]}, {"id": "sales", "persona": "کارشناس فروش", "tools": ["catalog", "quote"]}], ensure_ascii=False, indent=2),
    'docs/setup.md': "# راه‌اندازی\nکلید مدل زبانی خود را در config/.env قرار دهید. سرویس به‌صورت پیش‌فرض روی پورت 8080 بالا می‌آید.\n",
  }),
  'spark-flow-studio': dict(ver='2.2.0', title='اتوماسیون فرآیند اسپارک فلو', extra={
    'flows/sample-invoice-flow.json': json.dumps({"trigger": "new_invoice", "steps": [{"action": "validate"}, {"action": "notify_accounting"}, {"action": "archive"}]}, ensure_ascii=False, indent=2),
    'docs/flow-syntax.md': "# زبان تعریف فرآیند\nهر فرآیند یک trigger و فهرستی از step ها دارد. step می‌تواند action، condition یا webhook باشد.\n",
  }),
  'orbit-ui-kit': dict(ver='4.0.0', title='کیت رابط کاربری اوربیت', extra={
    'tokens/design-tokens.json': json.dumps({"colors": {"brand-500": "#22D3EE", "brand-700": "#0E7490", "surface": "#0F1B30"}, "radius": {"md": "12px", "lg": "18px"}, "spacing": [4, 8, 12, 16, 24, 32]}, ensure_ascii=False, indent=2),
    'components.md': "# فهرست کامپوننت‌ها\nButton، Card، Table، Modal، Toast، Tabs، Form inputs، Chart wrappers — همگی RTL و Dark-ready.\n",
  }),
  'spark-booking': dict(ver='1.9.2', title='سامانه نوبت‌دهی و رزرو اسپارک', extra={
    'schema/booking_schema.sql': "-- Spark Booking v1.9\nCREATE TABLE services (id SERIAL PRIMARY KEY, title TEXT, duration_min INT, price BIGINT);\nCREATE TABLE appointments (id BIGSERIAL PRIMARY KEY, service_id INT REFERENCES services(id), starts_at TIMESTAMPTZ, customer TEXT, status TEXT DEFAULT 'booked');\n",
    'docs/sms-gateway.md': "# اتصال به سرویس پیامک\nکلید API سرویس پیامکی خود را در تنظیمات پنل وارد کنید؛ قالب پیامک یادآوری به‌صورت پیش‌فرض موجود است.\n",
  }),
  'spark-bi-analytics': dict(ver='2.0.0', title='تحلیل هوش تجاری اسپارک BI', extra={
    'dashboards/sample-kpis.json': json.dumps({"kpis": ["درآمد روزانه", "نرخ تبدیل", "میانگین سبد", "بازگشت مشتری"], "sources": ["postgres", "mysql", "csv"]}, ensure_ascii=False, indent=2),
    'docs/connect-db.md': "# اتصال به پایگاه داده\nاتصال‌ها فقط سمت سرور ذخیره می‌شوند (رمزنگاری‌شده). حداقل دسترسی read-only توصیه می‌شود.\n",
  }),
}

def readme(name, ver, title):
    return f"""# {title} — نسخه {ver}

به محصول شما خوش آمدید. این بسته توسط «اسپارک لب» منتشر شده است.

## نصب سریع
1. فایل‌های بسته را در سرور/محیط کاری خود استخراج کنید.
2. پیش‌نیازهای ذکر شده در صفحه محصول را فراهم کنید.
3. طبق پوشه docs/ مراحل راه‌اندازی را دنبال کنید.

## پشتیبانی
- مدت پشتیبانی رایگان: ۶ ماه از تاریخ خرید
- کانال پشتیبانی: تیکت از پنل حساب اسپارک لب
- به‌روزرسانی‌ها: از بخش «دانلودهای من» در پنل حساب دریافت کنید.

## مجوز
فایل LICENSE.txt را مطالعه کنید. کلید مجوز شما پس از پرداخت در صفحه رسید نمایش داده می‌شود.

تاریخ بسته: {datetime.date.today().isoformat()}
"""

LICENSE = """SPARK LAB STANDARD LICENSE v1

- This package is licensed to the original purchaser only.
- Redistribution, resale or public sharing of the files is prohibited.
- One production deployment per license (standard), unless noted otherwise.
- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

(c) Spark Lab — sparklab.local
"""

for slug, info in PRODUCTS.items():
    out = os.path.join(BASE, f"seed-{slug}-{info['ver']}.zip")
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('README-fa.md', readme(slug, info['ver'], info['title']))
        z.writestr('LICENSE.txt', LICENSE)
        z.writestr('VERSION', info['ver'] + '\n')
        for p, c in info.get('extra', {}).items():
            z.writestr(p, c)
    print('built', os.path.basename(out), os.path.getsize(out), 'bytes')
