'use strict';
const express = require('express');
const { get, all, run } = require('../../db');
const { getSetting, setSetting, allSettings } = require('../../lib/settings');
const { clean } = require('../../middleware/validate');
const { audit } = require('../../middleware/security');
const { gatewayStatus, GATEWAYS } = require('../../lib/payments');
const { mailStatus } = require('../../lib/notify');
const { jsonField } = require('../../lib/helpers');

const router = express.Router();

router.get('/', (req, res) => {
  const s = allSettings();
  res.render('admin/settings', {
    title: 'تنظیمات سایت | اسپارک لب', adminSection: 'settings', s,
    gw: gatewayStatus(), mail: mailStatus(),
    services: jsonField(getSetting('services.items_json', '[]')),
  });
});

router.post('/site', (req, res) => {
  const b = req.body;
  const keys = {
    'site.name': 60, 'site.name_fa': 60, 'site.tagline': 200, 'site.description': 500,
    'contact.phone': 40, 'contact.email': 120, 'contact.address': 400, 'contact.workhours': 200,
    'social.instagram': 300, 'social.telegram': 300, 'social.linkedin': 300,
    'social.github': 300, 'social.x': 300, 'social.whatsapp': 40,
    'trust.enamad': 1000,
    'home.meta_title': 200, 'home.meta_description': 400,
    'home.hero_title': 200, 'home_hero_subtitle': 400,
    'order.currency': 30,
  };
  for (const [k, max] of Object.entries(keys)) {
    if (b[k] !== undefined) setSetting(k, clean(b[k]).slice(0, max));
  }
  if (b['home.stats_json'] !== undefined) setSetting('home.stats_json', String(b['home.stats_json']).slice(0, 4000));
  if (b['services.items_json'] !== undefined) setSetting('services.items_json', String(b['services.items_json']).slice(0, 20000));
  audit(req, 'settings_site_updated', {});
  req.session.flash = { type: 'ok', text: 'تنظیمات سایت ذخیره شد.' };
  res.redirect('/admin/settings');
});

router.post('/delivery', (req, res) => {
  const expiry = Math.min(24 * 365, Math.max(1, parseInt(clean(req.body.expiry_hours), 10) || 168));
  const maxDl = Math.min(1000, Math.max(1, parseInt(clean(req.body.max_downloads), 10) || 10));
  setSetting('download.expiry_hours', String(expiry));
  setSetting('download.max_downloads', String(maxDl));
  audit(req, 'settings_delivery_updated', { details: { expiry, maxDl } });
  req.session.flash = { type: 'ok', text: 'تنظیمات تحویل فایل ذخیره شد.' };
  res.redirect('/admin/settings');
});

/* ---------- payment gateway settings ---------- */
router.post('/gateway', (req, res) => {
  const active = ['none', 'zarinpal', 'test'].includes(req.body.active) ? req.body.active : 'none';
  const merchant = clean(req.body.zarinpal_merchant_id);
  const mode = req.body.zarinpal_mode === 'production' ? 'production' : 'sandbox';
  const testEnabled = req.body.test_enabled ? '1' : '0';

  if (active === 'zarinpal' && merchant.length < 10) {
    req.session.flash = { type: 'bad', text: 'برای فعال‌کردن زرین‌پال، شناسه پذیرنده (Merchant ID) معتبر لازم است.' };
    return res.redirect('/admin/settings');
  }
  setSetting('gateway.active', active);
  // keep previously stored secret if the field shows the mask
  if (merchant && !merchant.startsWith('••')) setSetting('gateway.zarinpal.merchant_id', merchant, true);
  setSetting('gateway.zarinpal.mode', mode);
  setSetting('gateway.test.enabled', testEnabled);
  audit(req, 'settings_gateway_updated', { details: { active, mode, testEnabled, merchantChanged: Boolean(merchant && !merchant.startsWith('••')) } });
  req.session.flash = { type: 'ok', text: 'تنظیمات درگاه پرداخت ذخیره شد.' };
  res.redirect('/admin/settings');
});

router.post('/gateway/test-connection', async (req, res) => {
  const key = ['zarinpal', 'test'].includes(req.body.gateway) ? req.body.gateway : null;
  if (!key) return res.status(400).json({ ok: false, message: 'درگاه نامعتبر' });
  const gw = GATEWAYS[key];
  const r = await gw.healthCheck();
  audit(req, 'gateway_health_check', { details: { gateway: key, ok: r.ok } });
  req.session.flash = { type: r.ok ? 'ok' : 'bad', text: `[${key}] ${r.message}` };
  res.redirect('/admin/settings');
});

/* ---------- backup ---------- */
router.get('/backup', (req, res) => {
  // SQLite WAL checkpoint + file download for administrators
  try { run('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
  const fs = require('fs');
  const config = require('../../config');
  if (!fs.existsSync(config.dbFile)) return res.status(404).send('db missing');
  audit(req, 'backup_downloaded', {});
  res.download(config.dbFile, `sparklab-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
});

module.exports = router;
