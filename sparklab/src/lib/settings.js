'use strict';
const { get, run } = require('../db');
const { encryptSecret, decryptSecret } = require('./crypto');

const now = () => new Date().toISOString();

function getSetting(key, fallback = '') {
  const row = get('SELECT value, is_secret FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  return row.is_secret ? (decryptSecret(row.value) || fallback) : (row.value ?? fallback);
}

function setSetting(key, value, isSecret = false) {
  const stored = isSecret ? encryptSecret(value) : (value === undefined || value === null ? '' : String(value));
  const existing = get('SELECT key, is_secret FROM settings WHERE key = ?', key);
  if (existing) {
    run('UPDATE settings SET value = ?, is_secret = ?, updated_at = ? WHERE key = ?',
      stored, isSecret ? 1 : 0, now(), key);
  } else {
    run('INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?,?,?,?)',
      key, stored, isSecret ? 1 : 0, now());
  }
}

function allSettings({ includeSecrets = false } = {}) {
  const rows = require('../db').all('SELECT key, value, is_secret FROM settings ORDER BY key');
  const out = {};
  for (const r of rows) {
    if (r.is_secret) {
      out[r.key] = includeSecrets ? decryptSecret(r.value) : (r.value ? '••••••' : '');
    } else out[r.key] = r.value;
  }
  return out;
}

/** Convenience bundle for views */
function siteSettings() {
  const s = (k, f = '') => getSetting(k, f);
  return {
    name: s('site.name', 'Spark Lab'),
    nameFa: s('site.name_fa', 'اسپارک لب'),
    tagline: s('site.tagline', ''),
    description: s('site.description', ''),
    phone: s('contact.phone', ''),
    email: s('contact.email', ''),
    address: s('contact.address', ''),
    workhours: s('contact.workhours', ''),
    socials: {
      instagram: s('social.instagram', ''),
      telegram: s('social.telegram', ''),
      linkedin: s('social.linkedin', ''),
      github: s('social.github', ''),
      x: s('social.x', ''),
      whatsapp: s('social.whatsapp', ''),
    },
    currency: s('order.currency', 'تومان'),
    enamad: s('trust.enamad', ''),
  };
}

module.exports = { getSetting, setSetting, allSettings, siteSettings };
