const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const raw = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'CHANGE_THIS_ENCRYPTION_KEY_32_CHARS_MIN';
  // Derive 32 bytes via SHA256 if not 32
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) return Buffer.from(raw, 'hex').slice(0, 32);
  const hash = crypto.createHash('sha256').update(raw).digest();
  return hash; // 32 bytes
}

function encrypt(plaintext) {
  if (!plaintext) return null;
  const text = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv:tag:ciphertext all base64
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  try {
    const [ivB64, tagB64, encB64] = ciphertext.split(':');
    if (!ivB64 || !tagB64 || !encB64) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const enc = Buffer.from(encB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const text = dec.toString('utf8');
    // Try JSON parse
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    console.error('[DECRYPT_ERROR]', e.message);
    return null;
  }
}

function maskSecret(value) {
  if (!value) return '••••••••';
  const s = String(value);
  if (s.length <= 4) return '••••••••';
  return '••••••••••••' + s.slice(-4);
}

function maskCredentials(creds) {
  if (!creds || typeof creds !== 'object') return {};
  const masked = {};
  for (const [k, v] of Object.entries(creds)) {
    if (v == null) masked[k] = null;
    else if (typeof v === 'string' && (k.toLowerCase().includes('token') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('key') || k.toLowerCase().includes('password'))) {
      masked[k] = maskSecret(v);
    } else if (typeof v === 'object') {
      masked[k] = maskCredentials(v);
    } else masked[k] = v;
  }
  return masked;
}

module.exports = { encrypt, decrypt, maskSecret, maskCredentials, getKey };
