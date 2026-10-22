'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { get, all, run } = require('../../db');
const { validator, clean } = require('../../middleware/validate');
const { jsonField } = require('../../lib/helpers');
const { audit } = require('../../middleware/security');
const { canTransition, projectStatusFlow } = require('../../lib/orders');
const { notify } = require('../../lib/notify');
const { attachmentUpload } = require('../../lib/uploads');
const config = require('../../config');

const router = express.Router();
const NOW = () => new Date().toISOString();

const ALL_STATUSES = [...projectStatusFlow(), 'rejected', 'cancelled'];

router.get('/', (req, res) => {
  const status = ALL_STATUSES.includes(req.query.status) ? req.query.status : '';
  const q = String(req.query.q || '').trim().slice(0, 100);
  const where = []; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (q) { where.push('(ref_no LIKE ? OR title LIKE ? OR name LIKE ? OR email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const projects = all(
    `SELECT * FROM project_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`,
    ...params
  );
  const counts = { all: get('SELECT COUNT(*) AS c FROM project_requests').c };
  for (const s of ALL_STATUSES) counts[s] = get('SELECT COUNT(*) AS c FROM project_requests WHERE status = ?', s).c;
  res.render('admin/projects', { title: 'درخواست‌های پروژه | اسپارک لب', adminSection: 'projects', projects, status, q, counts });
});

router.get('/:id(\\d+)', (req, res) => {
  const p = get('SELECT * FROM project_requests WHERE id = ?', parseInt(req.params.id, 10));
  if (!p) return res.status(404).send('not found');
  p.attachments = jsonField(p.attachments_json);
  const messages = all('SELECT * FROM project_messages WHERE project_id = ? ORDER BY id', p.id);
  const user = p.user_id ? get('SELECT id, name, email, phone FROM users WHERE id = ?', p.user_id) : null;
  const types = { website: 'طراحی وب‌سایت', webapp: 'وب‌اپلیکیشن', mobile: 'اپلیکیشن موبایل', automation: 'اتوماسیون کسب‌وکار', management: 'نرم‌افزار مدیریتی', dashboard: 'داشبورد سازمانی', ai: 'راهکار هوش مصنوعی', other: 'سایر' };
  res.render('admin/project-detail', {
    title: `پروژه ${p.ref_no} | اسپارک لب`, adminSection: 'projects',
    project: p, messages, user, types, flow: projectStatusFlow(), allStatuses: ALL_STATUSES,
  });
});

router.post('/:id(\\d+)/status', (req, res) => {
  const p = get('SELECT * FROM project_requests WHERE id = ?', parseInt(req.params.id, 10));
  if (!p) return res.status(404).send('not found');
  const to = String(req.body.status || '');
  if (!ALL_STATUSES.includes(to)) {
    req.session.flash = { type: 'bad', text: 'وضعیت نامعتبر.' };
    return res.redirect(`/admin/projects/${p.id}`);
  }
  if (!canTransition(p.status, to)) {
    req.session.flash = { type: 'bad', text: `انتقال از «${p.status}» به «${to}» طبق گردش کار مجاز نیست (حرکت رو به جلو یک مرحله‌ای، یا رد/لغو در مراحل اولیه).` };
    return res.redirect(`/admin/projects/${p.id}`);
  }
  const note = clean(req.body.note).slice(0, 500);
  run('UPDATE project_requests SET status = ?, admin_notes = COALESCE(admin_notes || ?, ?), updated_at = ? WHERE id = ?',
    to, note ? `\n[${NOW()}] ${note}` : '', note ? `\n[${NOW()}] ${note}` : null, NOW(), p.id);
  if (p.user_id) {
    const labels = { received: 'دریافت درخواست', reviewing: 'بررسی اولیه', estimating: 'برآورد هزینه', approved: 'تأیید', in_progress: 'در حال انجام', delivered: 'تحویل', completed: 'تکمیل', rejected: 'رد', cancelled: 'لغو' };
    notify(p.user_id, 'project_status', `وضعیت پروژه ${p.ref_no}: ${labels[to] || to}`,
      note || 'برای جزئیات به پنل حساب مراجعه کنید.', `/account/projects/${p.id}`);
  }
  audit(req, 'project_status_changed', { entity: 'project', entityId: p.id, details: { from: p.status, to, note } });
  req.session.flash = { type: 'ok', text: 'وضعیت پروژه به‌روزرسانی شد و به مشتری اطلاع داده شد.' };
  res.redirect(`/admin/projects/${p.id}`);
});

router.post('/:id(\\d+)/estimate', (req, res) => {
  const p = get('SELECT * FROM project_requests WHERE id = ?', parseInt(req.params.id, 10));
  if (!p) return res.status(404).send('not found');
  const v = validator(req.body);
  const amount = v.int('estimate_amount', 'مبلغ برآورد', { min: 0, max: 100000000000, required: false });
  const note = v.string('estimate_note', 'توضیح برآورد', { min: 0, max: 1500, required: false });
  if (!v.ok()) {
    req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] };
    return res.redirect(`/admin/projects/${p.id}`);
  }
  run('UPDATE project_requests SET estimate_amount = ?, estimate_note = ?, updated_at = ? WHERE id = ?',
    clean(req.body.estimate_amount) === '' ? null : amount, note, NOW(), p.id);
  if (p.user_id) {
    notify(p.user_id, 'project_estimate', `برآورد هزینه پروژه ${p.ref_no} ثبت شد`,
      note || 'برآورد هزینه پروژه شما در پنل حساب قابل مشاهده است.', `/account/projects/${p.id}`);
  }
  audit(req, 'project_estimate_set', { entity: 'project', entityId: p.id, details: { amount } });
  req.session.flash = { type: 'ok', text: 'برآورد هزینه ثبت و به مشتری اطلاع داده شد.' };
  res.redirect(`/admin/projects/${p.id}`);
});

router.post('/:id(\\d+)/message', attachmentUpload.single('attachment'), (req, res) => {
  const p = get('SELECT * FROM project_requests WHERE id = ?', parseInt(req.params.id, 10));
  if (!p) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return res.status(404).send('not found');
  }
  const body = clean(req.body.body).slice(0, 3000);
  const internal = req.body.is_internal ? 1 : 0;
  if (!body && !req.file) {
    req.session.flash = { type: 'bad', text: 'پیام خالی است.' };
    return res.redirect(`/admin/projects/${p.id}`);
  }
  run(`INSERT INTO project_messages (project_id, sender_role, sender_id, body, attachment_path, attachment_name, is_internal, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    p.id, 'admin', req.user.id, body || '(فایل پیوست)',
    req.file ? path.relative(config.storageDir, req.file.path) : null,
    req.file ? req.file.originalname.slice(0, 150) : null, internal, NOW());
  if (!internal && p.user_id) {
    notify(p.user_id, 'project_message', `پیام جدید در پروژه ${p.ref_no}`, body.slice(0, 120) || 'فایل جدیدی برای شما ارسال شد.', `/account/projects/${p.id}`);
  }
  audit(req, 'project_message_admin', { entity: 'project', entityId: p.id, details: { internal: !!internal } });
  req.session.flash = { type: 'ok', text: internal ? 'یادداشت داخلی ثبت شد (برای مشتری نمایش داده نمی‌شود).' : 'پیام ارسال شد.' };
  res.redirect(`/admin/projects/${p.id}`);
});

/* Serve private attachments to admins only */
router.get('/:id(\\d+)/attachment/:idx(\\d+)', (req, res) => {
  const p = get('SELECT * FROM project_requests WHERE id = ?', parseInt(req.params.id, 10));
  if (!p) return res.status(404).send('not found');
  const attachments = jsonField(p.attachments_json);
  const a = attachments[parseInt(req.params.idx, 10)];
  if (!a) return res.status(404).send('not found');
  const full = path.join(config.storageDir, a.path);
  if (!full.startsWith(config.privateAttachDir) || !fs.existsSync(full)) return res.status(410).send('file missing');
  audit(req, 'project_attachment_viewed', { entity: 'project', entityId: p.id, details: { file: a.name } });
  res.download(full, a.name);
});

router.get('/:id(\\d+)/message/:mid(\\d+)/attachment', (req, res) => {
  const m = get('SELECT * FROM project_messages WHERE id = ? AND project_id = ?', parseInt(req.params.mid, 10), parseInt(req.params.id, 10));
  if (!m || !m.attachment_path) return res.status(404).send('not found');
  const full = path.join(config.storageDir, m.attachment_path);
  if (!full.startsWith(config.privateAttachDir) || !fs.existsSync(full)) return res.status(410).send('file missing');
  res.download(full, m.attachment_name || 'file');
});

module.exports = router;
