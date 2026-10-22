'use strict';
/** Controlled digital delivery — private files, never statically exposed. */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { authorizeDownload, recordDownload } = require('../lib/downloads');
const { downloadLimiter, audit } = require('../middleware/security');
const config = require('../config');

const router = express.Router();

router.get('/:token', downloadLimiter, (req, res) => {
  const result = authorizeDownload(String(req.params.token || ''), req.user);
  if (!result.ok) {
    audit(req, 'download_denied', { details: { reason: result.reason, token: String(req.params.token).slice(0, 8) + '…' } });
    const needLogin = /وارد حساب/.test(result.reason);
    if (needLogin && !req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return res.status(403).render('public/error', { title: 'دانلود مجاز نیست', code: 403, message: result.reason });
  }
  const { grant, file } = result;
  const full = path.join(config.privateFilesDir, path.basename(file.stored_name));
  if (!full.startsWith(config.privateFilesDir) || !fs.existsSync(full)) {
    audit(req, 'download_file_missing', { entity: 'grant', entityId: grant.id });
    return res.status(410).render('public/error', { title: 'فایل در دسترس نیست', code: 410, message: 'فایل این محصول روی سرور یافت نشد. با پشتیبانی تماس بگیرید.' });
  }
  recordDownload(grant, req);
  audit(req, 'download_success', { entity: 'grant', entityId: grant.id, details: { file: file.original_name } });
  res.download(full, file.original_name, (err) => {
    if (err && !res.headersSent) {
      res.status(500).render('public/error', { title: 'خطا در ارسال فایل', code: 500, message: 'ارسال فایل با خطا مواجه شد.' });
    }
  });
});

module.exports = router;
