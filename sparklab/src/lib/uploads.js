'use strict';
/** Upload handling: multer with strict type/size limits; private vs public storage. */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
const DOC_MIME = [
  'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
  'application/vnd.rar', 'application/gzip', 'application/x-tar', 'application/x-7z-compressed',
  'application/pdf', 'text/plain',
  'application/octet-stream', // archive types often arrive generic — extension whitelist still applies
];
const FILE_EXT = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.pdf', '.txt'];
const ATTACH_EXT = ['.zip', '.rar', '.7z', '.pdf', '.txt', '.png', '.jpg', '.jpeg', '.doc', '.docx'];

function makeStorage(destDir, allowedExt) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = allowedExt.includes(ext) ? ext : '';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
    },
  });
}

function fileFilter(allowedExt, allowedMime) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!allowedExt.includes(ext)) {
      return cb(new Error(`نوع فایل «${ext || 'نامعلوم'}» مجاز نیست. انواع مجاز: ${allowedExt.join('، ')}`));
    }
    if (allowedMime && allowedMime.length && !allowedMime.includes(mime)) {
      return cb(new Error(`نوع محتوای فایل (${mime}) مجاز نیست.`));
    }
    cb(null, true);
  };
}

const imageUpload = multer({
  storage: makeStorage(config.publicUploadsDir, IMAGE_EXT),
  limits: { fileSize: config.uploadLimits.imageSizeMb * 1024 * 1024, files: 6 },
  fileFilter: fileFilter(IMAGE_EXT, IMAGE_MIME),
});

const productFileUpload = multer({
  storage: makeStorage(config.privateFilesDir, FILE_EXT),
  limits: { fileSize: config.uploadLimits.productFileMb * 1024 * 1024, files: 1 },
  fileFilter: fileFilter(FILE_EXT, DOC_MIME),
});

const attachmentUpload = multer({
  storage: makeStorage(config.privateAttachDir, ATTACH_EXT),
  limits: { fileSize: config.uploadLimits.attachmentMb * 1024 * 1024, files: 3 },
  fileFilter: fileFilter(ATTACH_EXT, null),
});

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

module.exports = { imageUpload, productFileUpload, attachmentUpload, sha256File, IMAGE_EXT, FILE_EXT, ATTACH_EXT };
