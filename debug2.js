require('dotenv').config();
const crypto=require('crypto');
const prisma=require('./lib/prisma');
const BASE=process.env.BASE_URL||'http://localhost:3000';
const TELEGRAM_SECRET=process.env.TELEGRAM_WEBHOOK_SECRET||'test_telegram_secret_123';
async function fetchJSON(u,o){ const r=await fetch(u,o); const t=await r.text(); console.log('RAW TEXT JSON stringify', JSON.stringify(t).slice(0,600)); console.log('RAW TEXT raw', t.slice(0,600)); let d=null; try{d=JSON.parse(t);}catch(e){d=t; console.log('parse fail',e.message)} console.log('d type', typeof d, 'd', JSON.stringify(d).slice(0,600)); return {status:r.status,data:d,text:t}}
(async()=>{
  const uniq=Date.now().toString().slice(-7);
  const tgBase=710000+parseInt(uniq.slice(-4));
  const tgUpdateId=parseInt(Date.now().toString().slice(-9));
  let tgBody={ update_id: tgUpdateId, message:{ message_id: parseInt(uniq), from:{id: tgBase, username:'tguser', first_name:'Ali'}, chat:{id: tgBase}, text:'سلام قیمت چنده؟' }};
  console.log('uniq',uniq,'tgBase',tgBase,'tgUpdateId',tgUpdateId,'BASE',BASE);
  let r=await fetchJSON(`${BASE}/api/integrations/telegram/webhook`, {method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':TELEGRAM_SECRET}, body: JSON.stringify(tgBody)});
  console.log('r.data.received',r.data?.received, 'customerId',r.data?.customerId);
})();
