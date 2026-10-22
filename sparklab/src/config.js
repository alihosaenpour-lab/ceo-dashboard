'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(ROOT, 'storage');

for (const d of [
  DATA_DIR,
  path.join(STORAGE_DIR, 'private', 'files'),
  path.join(STORAGE_DIR, 'private', 'attachments'),
  path.join(STORAGE_DIR, 'public-uploads'),
]) fs.mkdirSync(d, { recursive: true });

function ensureSecret(name, minLen = 32) {
  const v = process.env[name];
  if (v && v.length >= minLen) return { value: v, generated: false };
  const gen = crypto.randomBytes(48).toString('hex');
  return { value: gen, generated: true };
}

const sessionSecret = ensureSecret('SESSION_SECRET');
let encryptionKey = process.env.ENCRYPTION_KEY;
let encKeyGenerated = false;
if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
  // Derive a stable 32-byte key from the session secret so DB-stored secrets
  // remain decryptable across restarts even without an explicit ENCRYPTION_KEY.
  encryptionKey = crypto.createHash('sha256').update(sessionSecret.value).digest('hex');
  encKeyGenerated = true;
}

const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'sparklab.sqlite'),
  storageDir: STORAGE_DIR,
  privateFilesDir: path.join(STORAGE_DIR, 'private', 'files'),
  privateAttachDir: path.join(STORAGE_DIR, 'private', 'attachments'),
  publicUploadsDir: path.join(STORAGE_DIR, 'public-uploads'),
  sessionSecret: sessionSecret.value,
  sessionSecretGenerated: sessionSecret.generated,
  encryptionKey,
  encryptionKeyGenerated: encKeyGenerated,
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@sparklab.local',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || '',
  seedAdminName: process.env.SEED_ADMIN_NAME || 'مدیر اسپارک لب',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Spark Lab <noreply@sparklab.local>',
  },
  uploadLimits: {
    imageSizeMb: parseInt(process.env.UPLOAD_IMAGE_MB || '5', 10),
    productFileMb: parseInt(process.env.UPLOAD_PRODUCT_FILE_MB || '300', 10),
    attachmentMb: parseInt(process.env.UPLOAD_ATTACHMENT_MB || '10', 10),
  },
};

config.mailConfigured = Boolean(config.smtp.host && config.smtp.user);

module.exports = config;
