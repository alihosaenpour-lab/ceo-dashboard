# ArshiaMarket.ir — Setup Checklist (آرشیا مارکت)

**Domain:** arshiamarket.ir (www.arshiamarket.ir)  
**Panel Title:** آرشیا مارکت - پنل مدیریت  
**Status:** Code ready, waiting for domain purchase tonight

---

## ✅ کارهای من (انجام شد)

- [x] عنوان پنل → `آرشیا مارکت | ArshiaMarket.ir`
- [x] `nginx-arshiamarket.conf` آماده (SSL, proxy, rate-limit)
- [x] `ecosystem.config.js` → name: arshiamarket, production env
- [x] تمام P0 ها فیکس + 254 تست پاس
- [x] Server روشن localhost:3000

## ⏳ کارهای تو (امشب)

### 1) خرید دامنه arshiamarket.ir
- nic.ir → جستجو `arshiamarket` → خرید 50 هزار تومان
- نمابر (فکس): `+98-21-12345678` یا خالی
- پرسش محرمانه (انگلیسی): `What is your favorite color?` / `Blue`

### 2) اتصال DNS به سرور
```
Type A | @   | 1.2.3.4 (IP سرورت)
Type A | www | 1.2.3.4
```
- اگر VPS نداری: از هاست 150k تومنی یا ngrok موقت استفاده کن

### 3) بعد اینکه خریدی به من بگو — من اینا رو میزنم (2 دقیقه)
```bash
sudo cp nginx-arshiamarket.conf /etc/nginx/sites-available/arshiamarket
sudo ln -s /etc/nginx/sites-available/arshiamarket /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d arshiamarket.ir -d www.arshiamarket.ir
# .env
NODE_ENV=production
ALLOWED_DOMAIN=arshiamarket.ir
TELEGRAM_BOT_TOKEN=...
BASALAM_TOKEN=...
pm2 restart arshiamarket --update-env
curl https://arshiamarket.ir/api/health  # باید ok بده
```

### 4) تست وب‌هوک
```
https://arshiamarket.ir/api/integrations/telegram/webhook
https://arshiamarket.ir/api/basalam-hook
```
- تلگرام: /setWebhook با همین URL
- چک `GET https://arshiamarket.ir/api/integrations/status` → همه CONNECTED

---

## فردا
- پیام تست تلگرام → باید لحظه‌ای بیاد
- OTP با KAVENEGAR_API_KEY واقعی

> هر جا گیر کردی اسکرین‌شات بفرست
