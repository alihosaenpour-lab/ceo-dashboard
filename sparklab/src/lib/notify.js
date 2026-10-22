'use strict';
/** In-app notifications + optional SMTP email (status shown honestly in admin). */
const { run, all, get } = require('../db');
const config = require('../config');

const now = () => new Date().toISOString();

function notify(userId, type, title, body, url) {
  if (!userId) return;
  run('INSERT INTO notifications (user_id, type, title, body, url, created_at) VALUES (?,?,?,?,?,?)',
    userId, type, title, body || '', url || '', now());
}

function userNotifications(userId, limit = 50) {
  return all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);
}

function markAllRead(userId) {
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', userId);
}

let transporter = null;
let lastMailError = null;
function getTransporter() {
  if (!config.mailConfigured) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) {
    lastMailError = 'SMTP پیکربندی نشده است';
    // log to console so test environments can still use flows like password reset
    console.log(`[mail:not-configured] to=${to} subject=${subject}`);
    return { sent: false, reason: 'SMTP پیکربندی نشده است' };
  }
  try {
    await t.sendMail({ from: config.smtp.from, to, subject, html });
    return { sent: true };
  } catch (e) {
    lastMailError = e.message;
    console.error('[mail:error]', e.message);
    return { sent: false, reason: e.message };
  }
}

function mailStatus() {
  return {
    configured: config.mailConfigured,
    host: config.smtp.host || null,
    lastError: lastMailError,
  };
}

/** The reset link is persisted (hashed) regardless; for environments without SMTP
 *  the link is also written to the server log — never rendered to another user. */
function getResetForTest(email) {
  const u = get('SELECT id FROM users WHERE email = ?', String(email).toLowerCase());
  if (!u) return null;
  return null; // tokens are hashed at rest; retrieval only via email/log
}

module.exports = { notify, userNotifications, markAllRead, sendMail, mailStatus };
