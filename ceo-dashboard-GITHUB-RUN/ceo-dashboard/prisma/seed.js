/**
 * Prisma Seed - DEV Data - PHASE 3 IDENTITY+CRM
 * فقط برای Development - هیچ secret واقعی ندارد
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normalizePhone(raw){
  if(!raw) return null;
  let s = raw.toString()
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0)-1728))
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0)-1584))
    .replace(/[\s\-\(\)]/g,'');
  s = s.replace(/^(\+98|0098|98)/,'');
  s = s.replace(/^0/,'');
  if(!/^\d{10}$/.test(s)) return null;
  if(!s.startsWith('9')) return null;
  return '0'+s;
}

async function main() {
  console.log('🌱 Seeding PHASE 3 DEV data...');

  const ceo = await prisma.user.upsert({
    where: { phone: '09017909857' },
    update: {},
    create: { phone: '09017909857', role: 'CEO', isActive: true },
  });
  console.log(`✅ User CEO: ${ceo.phone} (${ceo.id})`);

  // Normalize existing customers
  const allCustomers = await prisma.customer.findMany();
  for(const c of allCustomers){
    const norm = normalizePhone(c.phone);
    if(norm && c.normalizedPhone !== norm){
      try{ await prisma.customer.update({ where:{ id:c.id }, data:{ normalizedPhone: norm } }); }catch(e){}
    }
  }

  const customersData = [
    { phone: '09120000001', name: 'سارا احمدی', city: 'تهران', source: 'BASALAM', status:'CUSTOMER' },
    { phone: '09120000002', name: 'علی رضایی', city: 'اصفهان', source: 'INSTAGRAM', status:'LEAD' },
    { phone: '09120000003', name: 'مریم حسینی', city: 'شیراز', source: 'TELEGRAM', status:'ACTIVE' },
    { phone: '09120000004', name: 'رضا کریمی', city: 'تبریز', source: 'WEBSITE', status:'NEW' },
  ];
  for (const c of customersData) {
    const norm = normalizePhone(c.phone);
    await prisma.customer.upsert({
      where: { phone: c.phone },
      update: { normalizedPhone: norm, status: c.status },
      create: { phone: c.phone, normalizedPhone: norm, name: c.name, city: c.city, source: c.source, status: c.status },
    });
  }
  console.log('✅ Customers with normalizedPhone');

  const productsData = [
    { sku: 'SKU-001', name: 'هدفون بلوتوثی', slug: 'bluetooth-headphone', category: 'الکترونیک', price: 2450000, stock: 15 },
    { sku: 'SKU-002', name: 'پاوربانک 20000mAh', slug: 'powerbank-20000', category: 'الکترونیک', price: 890000, stock: 3 },
    { sku: 'SKU-003', name: 'هودی مشکی', slug: 'hoodie-black', category: 'پوشاک', price: 750000, stock: 7 },
    { sku: 'SKU-004', name: 'ماگ حرارتی', slug: 'thermal-mug', category: 'خانه', price: 420000, stock: 2 },
    { sku: 'SKU-005', name: 'کتاب مدیریت', slug: 'management-book', category: 'کتاب', price: 180000, stock: 25 },
  ];
  for (const p of productsData) {
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: { sku: p.sku, name: p.name, slug: p.slug, category: p.category, price: p.price, costPrice: Math.round(p.price*0.6), stock: p.stock, minStock:5, brand:'Generic', description:`توضیحات ${p.name} - DEV` },
    });
    await prisma.inventory.upsert({ where:{ productId: product.id }, update:{ quantity: p.stock }, create:{ productId: product.id, quantity: p.stock, reservedQuantity:0 } });
  }
  console.log('✅ Products + Inventories');

  const customer1 = await prisma.customer.findUnique({ where: { phone: '09120000001' } });
  const customer2 = await prisma.customer.findUnique({ where: { phone: '09120000002' } });
  const product1 = await prisma.product.findUnique({ where: { sku: 'SKU-001' } });
  const product2 = await prisma.product.findUnique({ where: { sku: 'SKU-002' } });

  // Order
  if (customer1 && product1) {
    const orderNumber = 'ORD-DEV-1001';
    const existing = await prisma.order.findUnique({ where: { orderNumber } });
    if (!existing) {
      await prisma.order.create({
        data: {
          orderNumber, customerId: customer1.id, status: 'PENDING', paymentStatus: 'PENDING', subtotal: product1.price, discount:0, shippingCost:0, total: product1.price, source:'BASALAM',
          items: { create: { productId: product1.id, quantity:1, unitPrice: product1.price, total: product1.price } },
          statusHistory: { create: { fromStatus: null, toStatus: 'PENDING', reason:'Seed' } },
        },
      });
      console.log('✅ Order DEV');
    }
  }

  // Tags
  const tagNames = ['مشتری جدید','مشتری VIP','پیگیری لازم','خرید فیلتر','سفارش بزرگ'];
  for(const n of tagNames){
    await prisma.tag.upsert({ where:{ name:n }, update:{}, create:{ name:n, color:'#3b82f6' } });
  }
  console.log('✅ Tags');

  // CustomerIdentity - for each customer create channel identity
  if(customer1){
    await prisma.customerIdentity.upsert({ where:{ channel_externalId: { channel:'PHONE', externalId:'09120000001' } }, update:{}, create:{ customerId: customer1.id, channel:'PHONE', externalId:'09120000001', displayName:customer1.name } });
    await prisma.customerIdentity.upsert({ where:{ channel_externalId: { channel:'BASALAM', externalId:'basalam_cust_1' } }, update:{}, create:{ customerId: customer1.id, channel:'BASALAM', externalId:'basalam_cust_1', username:'sara_bsl' } });
    await prisma.customerIdentity.upsert({ where:{ channel_externalId: { channel:'TELEGRAM', externalId:'tg_1001' } }, update:{}, create:{ customerId: customer1.id, channel:'TELEGRAM', externalId:'tg_1001', username:'sara_tg' } });
  }
  if(customer2){
    await prisma.customerIdentity.upsert({ where:{ channel_externalId: { channel:'PHONE', externalId:'09120000002' } }, update:{}, create:{ customerId: customer2.id, channel:'PHONE', externalId:'09120000002', displayName:customer2.name } });
    await prisma.customerIdentity.upsert({ where:{ channel_externalId: { channel:'INSTAGRAM', externalId:'ig_2002' } }, update:{}, create:{ customerId: customer2.id, channel:'INSTAGRAM', externalId:'ig_2002', username:'ali_insta' } });
  }
  console.log('✅ Identities');

  // CustomerTag assignment
  const tagVip = await prisma.tag.findUnique({ where:{ name:'مشتری VIP' } });
  const tagNew = await prisma.tag.findUnique({ where:{ name:'مشتری جدید' } });
  if(customer1 && tagVip){
    try{ await prisma.customerTag.create({ data:{ customerId: customer1.id, tagId: tagVip.id } }); }catch(e){}
    // timeline
    await prisma.customerTimeline.create({ data:{ customerId: customer1.id, eventType:'CUSTOMER_TAGGED', title:'برچسب VIP اضافه شد', description:'توسط سیستم', actorId: ceo.id, metadata:{ tag:'مشتری VIP' } } });
  }
  if(customer2 && tagNew){
    try{ await prisma.customerTag.create({ data:{ customerId: customer2.id, tagId: tagNew.id } }); }catch(e){}
  }

  // CustomerNote
  if(customer1){
    await prisma.customerNote.create({ data:{ customerId: customer1.id, authorId: ceo.id, content:'مشتری وفادار - خرید ممبران انجام داده، پیگیری ماهانه' } });
  }

  // Messages
  if(customer1){
    await prisma.message.create({ data:{ customerId: customer1.id, channel:'BASALAM', direction:'INBOUND', content:'سلام قیمت هدفون چنده؟', text:'سلام قیمت هدفون چنده؟', externalMessageId:'msg_bsl_001', status:'RECEIVED' } });
    await prisma.message.create({ data:{ customerId: customer1.id, channel:'BASALAM', direction:'OUTBOUND', content:'2450000 تومان - ارسال رایگان', text:'2450000 تومان', externalMessageId:'msg_bsl_002', status:'PROCESSED' } });
  }
  if(customer2){
    await prisma.message.create({ data:{ customerId: customer2.id, channel:'INSTAGRAM', direction:'INBOUND', content:'موجودی پاوربانک؟', text:'موجودی پاوربانک؟', externalMessageId:'msg_ig_001', status:'RECEIVED' } });
  }
  console.log('✅ Messages & Notes');

  // Leads
  if(customer1 && product1){
    const existingLead = await prisma.lead.findFirst({ where:{ customerId: customer1.id, intent:'price inquiry' } });
    if(!existingLead){
      await prisma.lead.create({ data:{ customerId: customer1.id, status:'QUALIFIED', source:'BASALAM', score:65, intent:'price inquiry', interestedProductId: product1.id, estimatedValue:2450000 } });
    }
  }
  if(customer2 && product2){
    const ex2 = await prisma.lead.findFirst({ where:{ customerId: customer2.id } });
    if(!ex2){
      await prisma.lead.create({ data:{ customerId: customer2.id, status:'NEW', source:'INSTAGRAM', score:30, intent:'stock inquiry', interestedProductId: product2.id, estimatedValue:890000 } });
    }
  }
  console.log('✅ Leads');

  // FollowUps
  const lead1 = await prisma.lead.findFirst({ where:{ customerId: customer1?.id } });
  if(customer1 && lead1){
    const fuExists = await prisma.followUp.findFirst({ where:{ customerId: customer1.id, leadId: lead1.id } });
    if(!fuExists){
      await prisma.followUp.create({ data:{ customerId: customer1.id, leadId: lead1.id, type:'CALL', scheduledAt: new Date(Date.now()+ 2*24*60*60*1000), status:'PENDING', reason:'پیگیری پیشنهاد قیمت', assignedToId: ceo.id } });
    }
  }
  console.log('✅ FollowUps');

  // Timelines for created customers
  for(const c of await prisma.customer.findMany({ take:3 })){
    const exists = await prisma.customerTimeline.findFirst({ where:{ customerId:c.id, eventType:'CUSTOMER_CREATED' } });
    if(!exists) await prisma.customerTimeline.create({ data:{ customerId:c.id, eventType:'CUSTOMER_CREATED', title:'مشتری ایجاد شد', description:`از ${c.source}`, actorId: ceo.id } });
  }

  // ScheduledContent
  const scCount = await prisma.scheduledContent.count();
  if(scCount===0){
    await prisma.scheduledContent.create({ data:{ topic:'معرفی پاوربانک 20000 با تخفیف 15% - DEV', platform:'INSTAGRAM', tone:'صمیمی', discount:'15%', status:'DRAFT', scheduledAt: new Date(Date.now()+24*60*60*1000) } });
  }
  console.log('✅ Timeline & ScheduledContent');
  console.log('🌱 Seed PHASE 3 done!');
}

main().catch(e=>{ console.error('❌ Seed error:', e); process.exit(1); }).finally(async()=>{ await prisma.$disconnect(); });
