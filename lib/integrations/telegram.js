/**
 * Telegram Adapter — Phase 4
 * verify, parse, send
 */
const crypto = require('crypto');

function verifyTelegramWebhook(req, secret){
  if(!secret) return { ok:true }; // if not configured, allow (but log)
  const header = req.headers['x-telegram-bot-api-secret-token'] || req.headers['x-telegram-secret'] || req.headers['x-webhook-secret'];
  if(!header) return { ok:false, code:401, message:'Missing Telegram secret' };
  if(header !== secret) return { ok:false, code:401, message:'Invalid Telegram secret' };
  return { ok:true };
}

function parseTelegramUpdate(body){
  if(!body || typeof body !== 'object') return { error:'Invalid body' };
  const update_id = body.update_id;
  if(update_id === undefined || update_id === null) return { error:'Missing update_id' };
  // message can be in message, edited_message, channel_post, callback_query
  let msg = body.message || body.edited_message || body.channel_post || null;
  let from = null, chat = null, text = null, message_id = null, username = null, first_name=null, last_name=null;
  if(body.callback_query){
    msg = body.callback_query.message;
    from = body.callback_query.from;
    text = body.callback_query.data;
    message_id = body.callback_query.id; // use callback id as message id
    // but also need original message id
    if(msg) message_id = msg.message_id;
  } else if(msg){
    from = msg.from || msg.chat;
    chat = msg.chat;
    text = msg.text || msg.caption || '';
    message_id = msg.message_id;
    if(from){
      username = from.username;
      first_name = from.first_name;
      last_name = from.last_name;
    }
    if(!from && chat){
      // channel post without from
      from = chat;
      username = chat.username;
      first_name = chat.title || chat.first_name;
    }
  } else {
    // unknown update type — treat as no message but still idempotent
    return { update_id: String(update_id), noMessage:true };
  }
  if(!from) return { error:'Missing from/chat' };
  const externalId = String(from.id || chat?.id);
  if(!externalId || externalId==='undefined') return { error:'Missing externalId' };
  // text can be empty for e.g. photo — but we need content
  if(text === null || text === undefined) text = '';
  // if it's non-text (photo, sticker), use caption or fallback
  if(!text && msg){
    if(msg.photo) text = '[photo]';
    else if(msg.sticker) text = '[sticker]';
    else if(msg.document) text = '[document]';
    else text = '[message]';
  }
  return {
    update_id: String(update_id),
    externalId,
    username,
    first_name,
    last_name,
    chatId: String((chat || from).id),
    message_id: String(message_id || update_id),
    text: String(text),
    raw: body,
  };
}

function normalizeMessage(text){
  if(typeof text !== 'string') return '';
  // limit metadata, escape XSS, trim
  const trimmed = text.slice(0,2000).trim();
  return trimmed.replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function resolveIdentity(externalId){ return { channel:'TELEGRAM', externalId: String(externalId) }; }
function healthCheck({ token, webhookUrl, lastEvent, lastError } = {}){
  if(!token) return { status:'DISCONNECTED', reason:'TELEGRAM_BOT_TOKEN missing' };
  if(lastError && (Date.now() - new Date(lastError).getTime()) < 5*60*1000) return { status:'ERROR', reason: String(lastError).slice(0,80) };
  if(!webhookUrl) return { status:'DEGRADED', reason:'webhookUrl not set' };
  if(lastEvent && (Date.now() - new Date(lastEvent).getTime()) > 7*24*60*60*1000) return { status:'DEGRADED', reason:'no event 7d' };
  return { status:'CONNECTED' };
}
async function publish(){ return sendTelegramMessage.apply(null, arguments); }

async function sendTelegramMessage({ token, chatId, text, parseMode }){
  if(!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
  if(!chatId) throw new Error('chatId missing');
  if(!text) throw new Error('text missing');
  // timeout 5s, exponential retry handled in server.js (not here)
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = { chat_id: chatId, text, parse_mode: parseMode || undefined };
  const controller = new AbortController();
  const timeout = setTimeout(()=> controller.abort(), 5000);
  try{
    const res = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await res.json().catch(()=>({}));
    clearTimeout(timeout);
    if(!res.ok){
      const err = new Error(data.description || `Telegram API ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data; // contains result.message_id
  }catch(e){
    clearTimeout(timeout);
    if(e.name==='AbortError'){
      const err = new Error('Telegram timeout');
      err.status = 408;
      throw err;
    }
    throw e;
  }
}

module.exports = { verifyTelegramWebhook, parseTelegramUpdate, sendTelegramMessage, normalizeMessage, resolveIdentity, healthCheck, publish, channel:'TELEGRAM' };
