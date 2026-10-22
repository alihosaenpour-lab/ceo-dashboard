'use strict';
/** Download grants: signed expiring tokens + access control + logging. */
const crypto = require('crypto');
const { get, run, all } = require('../db');
const { getSetting } = require('./settings');

const now = () => new Date().toISOString();

function makeToken() { return crypto.randomBytes(24).toString('base64url'); }

/** Create one grant per (order, deliverable product file). Called exactly once, after verified payment. */
function createGrantsForOrder(order) {
  const items = JSON.parse(order.items_json || '[]');
  const expiryHours = parseInt(getSetting('download.expiry_hours', '168'), 10) || 168;
  const maxDownloads = parseInt(getSetting('download.max_downloads', '10'), 10) || 10;
  const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000).toISOString();
  const created = [];
  for (const it of items) {
    const file = get(
      'SELECT * FROM product_files WHERE product_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
      it.product_id
    );
    if (!file) continue; // nothing deliverable
    const existing = get(
      'SELECT id FROM download_grants WHERE order_id = ? AND product_file_id = ?',
      order.id, file.id
    );
    if (existing) { created.push(existing.id); continue; }
    const id = run(
      `INSERT INTO download_grants
       (order_id, user_id, product_id, product_file_id, token, expires_at, max_downloads, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      order.id, order.user_id, it.product_id, file.id, makeToken(), expiresAt, maxDownloads, now()
    ).lastId;
    created.push(id);
  }
  return created;
}

function grantsForUser(userId) {
  return all(
    `SELECT g.*, p.title AS product_title, p.slug AS product_slug, p.cover_image,
            f.original_name, f.size, f.mime, f.version, o.order_no
     FROM download_grants g
     JOIN products p ON p.id = g.product_id
     JOIN product_files f ON f.id = g.product_file_id
     JOIN orders o ON o.id = g.order_id
     WHERE g.user_id = ?
     ORDER BY g.id DESC`,
    userId
  );
}

function grantsForOrder(orderId) {
  return all(
    `SELECT g.*, p.title AS product_title, f.original_name, f.size, f.version
     FROM download_grants g
     JOIN products p ON p.id = g.product_id
     JOIN product_files f ON f.id = g.product_file_id
     WHERE g.order_id = ?`,
    orderId
  );
}

/**
 * Validate a download attempt.
 * Access rule: grant must be unrevoked, unexpired, under max downloads,
 * the parent order must be 'paid', and the requester must be the grant owner.
 */
function authorizeDownload(token, user) {
  const g = get(
    `SELECT g.*, o.status AS order_status FROM download_grants g
     JOIN orders o ON o.id = g.order_id WHERE g.token = ?`,
    token
  );
  if (!g) return { ok: false, reason: 'لینک دانلود یافت نشد.' };
  if (g.revoked) return { ok: false, reason: 'این لینک دانلود لغو شده است.' };
  if (g.order_status !== 'paid') return { ok: false, reason: 'سفارش مرتبط در وضعیت پرداخت‌شده نیست؛ تحویل محصول ممکن نیست.' };
  if (g.expires_at && new Date(g.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'لینک دانلود منقضی شده است. از پنل حساب، لینک جدید درخواست دهید.' };
  }
  if (g.max_downloads && g.downloads_count >= g.max_downloads) {
    return { ok: false, reason: 'سقف تعداد دانلود این لینک پر شده است.' };
  }
  if (g.user_id) {
    if (!user || user.id !== g.user_id) return { ok: false, reason: 'این فایل فقط برای خریدار آن سفارش قابل دانلود است. وارد حساب خود شوید.' };
  }
  const file = get('SELECT * FROM product_files WHERE id = ?', g.product_file_id);
  if (!file) return { ok: false, reason: 'فایل محصول در دسترس نیست.' };
  return { ok: true, grant: g, file };
}

function recordDownload(grant, req) {
  run('UPDATE download_grants SET downloads_count = downloads_count + 1 WHERE id = ?', grant.id);
  run(
    'INSERT INTO download_logs (grant_id, user_id, ip, user_agent, created_at) VALUES (?,?,?,?,?)',
    grant.id, req.user?.id ?? null, (req.ip || '').slice(0, 64), String(req.get('user-agent') || '').slice(0, 300), now()
  );
}

/** Re-issue a fresh token for an existing grant (customer request / admin action). */
function regenerateGrant(grantId) {
  const expiryHours = parseInt(getSetting('download.expiry_hours', '168'), 10) || 168;
  const maxDownloads = parseInt(getSetting('download.max_downloads', '10'), 10) || 10;
  run('UPDATE download_grants SET token = ?, expires_at = ?, downloads_count = 0, max_downloads = ?, revoked = 0 WHERE id = ?',
    makeToken(), new Date(Date.now() + expiryHours * 3600 * 1000).toISOString(), maxDownloads, grantId);
  return get('SELECT * FROM download_grants WHERE id = ?', grantId);
}

module.exports = { createGrantsForOrder, grantsForUser, grantsForOrder, authorizeDownload, recordDownload, regenerateGrant };
