/**
 * تست واقعی باسلام - روی سیستم خودت اجرا کن
 * PHASE 0: توکن دیگر هاردکد نیست - از .env خوانده می‌شود
 * اجرا: node test-basalam-real.js
 * نیاز: .env حاوی BASALAM_TOKEN
 */
require('dotenv').config();
const TOKEN = process.env.BASALAM_TOKEN;
if(!TOKEN){
  console.error('❌ BASALAM_TOKEN در .env پیدا نشد');
  console.error('   1. فایل .env را بساز (از .env.example کپی کن)');
  console.error('   2. BASALAM_TOKEN=eyJ... را بگذار');
  process.exit(1);
}

async function test() {
  console.log("========================================");
  console.log("  تست واقعی باسلام");
  console.log("  Token:", TOKEN.slice(0,20) + "...");
  console.log("========================================\n");

  console.log("1️⃣ دریافت اطلاعات کاربر...");
  try {
    const r = await fetch("https://openapi.basalam.com/v1/users/me", {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" }
    });
    console.log(`   Status: ${r.status}`);
    const j = await r.json();
    console.log(`   ✅ پاسخ:`, JSON.stringify(j, null, 2).slice(0, 800));
    if (j.vendor) {
      console.log(`\n   🏪 غرفه: ${j.vendor.name}`);
      console.log(`   🔗 شناسه: ${j.vendor.identifier}`);
      console.log(`   🆔 Vendor ID: ${j.vendor.id}`);
      
      console.log("\n2️⃣ دریافت محصولات غرفه...");
      const r2 = await fetch(`https://openapi.basalam.com/v1/vendors/${j.vendor.id}/products?size=3`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" }
      });
      console.log(`   Status: ${r2.status}`);
      const j2 = await r2.json();
      console.log(`   📦 تعداد محصولات: ${j2.products?.length || 0}`);
      if (j2.products) {
        j2.products.slice(0,2).forEach(p => {
          console.log(`      - ${p.name} | ${p.price} تومان | موجودی ${p.stock}`);
        });
      }
      console.log("\n✅ تست کامل شد! اتصال باسلام سالمه");
    }
  } catch (e) {
    console.log(`   ❌ خطا: ${e.message}`);
  }
  console.log("\n========================================");
}

test();
