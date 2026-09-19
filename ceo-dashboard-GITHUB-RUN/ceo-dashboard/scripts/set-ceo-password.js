#!/usr/bin/env node
/**
 * Set CEO password securely (bcrypt)
 * Usage: node scripts/set-ceo-password.js "YourStrongPassword123!"
 * Or:    npm run set-password -- "YourStrongPassword123!"
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  const pwd = process.argv[2] || process.env.CEO_PASSWORD;
  if(!pwd || pwd.length < 8){
    console.error('❌ رمز را وارد کن: node scripts/set-ceo-password.js "رمز_قوی_حداقل_8"');
    console.error('   مثال: node scripts/set-ceo-password.js "Arshia-1234!Secure"');
    process.exit(1);
  }
  if(pwd.length > 64){
    console.error('❌ رمز خیلی طولانی (حداکثر 64)');
    process.exit(1);
  }
  const phone = process.env.CEO_PHONE || '09017909857';
  const hash = await bcrypt.hash(pwd, 10);
  let user = await prisma.user.findUnique({ where:{ phone } });
  if(!user){
    user = await prisma.user.create({ data:{ phone, role:'CEO', isActive:true, passwordHash: hash, passwordUpdatedAt: new Date() } });
    console.log(`✅ کاربر ${phone} ساخته شد با رمز جدید`);
  } else {
    await prisma.user.update({ where:{ phone }, data:{ passwordHash: hash, passwordUpdatedAt: new Date(), isActive:true } });
    console.log(`✅ رمز برای ${phone} بروز شد`);
  }
  console.log('🔒 hash:', hash.slice(0,20)+'...');
  console.log('⚠️  این رمز را جایی امن یادداشت کن - در لاگ یا گیت ذخیره نمی‌شود');
  await prisma.$disconnect();
}
main().catch(e=>{ console.error(e); process.exit(1); });
