'use strict';
/** Public project request form (guests + logged-in users) with file attachments. */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { run, get } = require('../db');
const { validator } = require('../middleware/validate');
const { jsonField } = require('../lib/helpers');
const { getSetting } = require('../lib/settings');
const { formLimiter, audit } = require('../middleware/security');
const { attachmentUpload } = require('../lib/uploads');
const { notify } = require('../lib/notify');
const config = require('../config');

const router = express.Router();
const now = () => new Date().toISOString();

const PROJECT_TYPES_FALLBACK = [
  { id: 'website', label: 'طراحی وب‌سایت' },
  { id: 'webapp', label: 'وب‌اپلیکیشن / نرم‌افزار تحت وب' },
  { id: 'mobile', label: 'اپلیکیشن موبایل' },
  { id: 'automation', label: 'اتوماسیون کسب‌وکار' },
  { id: 'management', label: 'نرم‌افزار مدیریتی / سازمانی' },
  { id: 'dashboard', label: 'داشبورد سازمانی / BI' },
  { id: 'ai', label: 'راهکار هوش مصنوعی' },
  { id: 'other', label: 'سایر موارد' },
];

function projectTypes() {
  const custom = jsonField(getSetting('projects.types_json', ''), null);
  return Array.isArray(custom) && custom.length ? custom : PROJECT_TYPES_FALLBACK;
}

function budgets() {
  return jsonField(getSetting('projects.budgets_json', ''), null) ?? [
    'کمتر از ۲۰ میلیون تومان',
    '۲۰ تا ۵۰ میلیون تومان',
    '۵۰ تا ۱۵۰ میلیون تومان',
    '۱۵۰ تا ۵۰۰ میلیون تومان',
    'بیش از ۵۰۰ میلیون تومان',
    'نیاز به مشاوره و برآورد دارم',
  ];
}

function renderForm(req, res, { values = {}, errors = {}, attachments = [] } = {}, status = 200) {
  res.status(status).render('public/project-request', {
    title: 'ثبت سفارش پروژه | اسپارک لب',
    metaDescription: 'فرم ثبت درخواست پروژه نرم‌افزاری — شرح نیاز، نوع پروژه، بودجه و زمان مورد انتظار را بنویسید تا کارشناسان اسپارک لب بررسی و برآورد کنند.',
    values, errors, attachments,
    types: projectTypes(), budgets: budgets(),
  });
}

router.get('/new', (req, res) => {
  const values = req.user ? { name: req.user.name, email: req.user.email, phone: req.user.phone || '' } : {};
  renderForm(req, res, { values });
});

const upload = attachmentUpload.array('attachments', 3);

router.post('/new', (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      audit(req, 'project_upload_rejected', { details: { message: err.message } });
      req.session.flash = { type: 'bad', text: err.message };
      return renderForm(req, res, { values: req.body, errors: {} }, 400);
    }
    // formLimiter equivalent (manual to run after multer)
    const v = validator(req.body);
    const name = v.string('name', 'نام و نام خانوادگی', { min: 3, max: 100 });
    const email = v.email('email');
    const phone = v.phone('phone', 'شماره موبایل', { required: true });
    const projectType = v.enum('project_type', 'نوع پروژه', projectTypes().map((t) => t.id));
    const title = v.string('title', 'عنوان پروژه', { min: 4, max: 150 });
    const description = v.string('description', 'شرح نیاز', { min: 20, max: 8000 });
    const budgetRange = v.string('budget_range', 'بودجه تقریبی', { min: 1, max: 100, required: false });
    const timeline = v.string('timeline', 'زمان مورد انتظار', { min: 1, max: 100, required: false });

    const files = (req.files || []).map((f) => ({
      name: f.originalname.slice(0, 150),
      path: path.relative(config.storageDir, f.path),
      size: f.size,
    }));

    if (!v.ok()) {
      for (const f of files) fs.rm(path.join(config.storageDir, f.path), { force: true }, () => {});
      return renderForm(req, res, { values: { ...req.body, email, phone }, errors: v.errors }, 400);
    }

    const refNo = `PR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 90 + 10)}`;
    const id = run(
      `INSERT INTO project_requests
       (ref_no, user_id, name, email, phone, project_type, title, description, budget_range, timeline, attachments_json, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      refNo, req.user?.id || null, name, email, phone, projectType, title, description,
      budgetRange, timeline, JSON.stringify(files), 'received', now()
    ).lastId;

    audit(req, 'project_request_created', { entity: 'project', entityId: id, details: { ref: refNo, type: projectType } });
    if (req.user) {
      notify(req.user.id, 'project', `درخواست پروژه ${refNo} ثبت شد`,
        'درخواست شما دریافت شد و پس از بررسی اولیه، برآورد هزینه ارسال می‌شود.', `/account/projects/${id}`);
    }
    // notify admins
    const admins = require('../db').all(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`);
    for (const a of admins) notify(a.id, 'project_new', `درخواست پروژه جدید: ${title}`, `${name} — ${refNo}`, `/admin/projects/${id}`);

    req.session.flash = { type: 'ok', text: `درخواست شما با کد پیگیری ${refNo} ثبت شد. کارشناسان ما به‌زودی با شما تماس می‌گیرند.` };
    if (req.user) res.redirect(`/account/projects/${id}`);
    else res.redirect(`/projects/new?done=${encodeURIComponent(refNo)}`);
  });
});

module.exports = router;
