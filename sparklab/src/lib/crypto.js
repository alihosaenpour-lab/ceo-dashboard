'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

/* ---------- passwords ---------- */
function hashPassword(pw) {
  return bcrypt.hashSync(pw, 12);
}
function verifyPassword(pw, hash) {
  try { return bcrypt.compareSync(pw, hash); } catch (_) { return false; }
}

/* ---------- random tokens ---------- */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

/* ---------- HMAC signed tokens (download links, callbacks) ---------- */
function signPayload(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifySignedPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
}

/* ---------- AES-256-GCM encryption for secrets stored in DB ---------- */
const KEY = Buffer.from(config.encryptionKey, 'hex');
function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function decryptSecret(value) {
  if (!value || !value.startsWith('v1:')) return value || '';
  try {
    const [, iv, tag, data] = value.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch (_) { return ''; }
}

module.exports = {
  hashPassword, verifyPassword, randomToken, sha256,
  signPayload, verifySignedPayload, encryptSecret, decryptSecret,
};
