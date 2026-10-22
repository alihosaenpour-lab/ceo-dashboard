'use strict';
const express = require('express');
const { get, all, run } = require('../../db');
const { validator, clean } = require('../../middleware/validate');
const { hashPassword } = require('../../lib/crypto');
const { audit } = require('../../middleware/security');
const { notify } = require('../../lib/notify');

const router = express.Router();
const NOW = () => new Date().toISOString();

/* users management: full admin only */
router.get('/', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('forbidden');
  const q = String(req.query.q || '').trim().slice(0, 100);
  const where = q ? 'WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  const users = all(
    `SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count,
        (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id = u.id AND o.status='paid') AS paid_total
     FROM users u ${where} ORDER BY u.id DESC LIMIT 300`, ...params
  );
  res.render('admin/users', { title: 'کاربران | اسپارک لب', adminSection: 'users', users, q });
});

router.post('/:id(\\d+)/role', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('forbidden');
  const id = parseInt(req.params.id, 10);
  const target = get('SELECT * FROM users WHERE id = ?', id);
  if (!target) return res.status(404).send('not found');
  const role = ['admin', 'staff', 'customer'].includes(req.body.role) ? req.body.role : null;
  if (!role) { req.session.flash = { type: 'bad', text: 'نقش نامعتبر.' }; return res.redirect('/admin/users'); }
  if (id === req.user.id && role !== 'admin') {
    req.session.flash = { type: 'bad', text: 'نمی‌توانید نقش مدیریتی خود را کاهش دهید.' };
    return res.redirect('/admin/users');
  }
  run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', role, NOW(), id);
  audit(req, 'user_role_changed', { entity: 'user', entityId: id, details: { from: target.role, to: role } });
  req.session.flash = { type: 'ok', text: 'نقش کاربر به‌روزرسانی شد.' };
  res.redirect('/admin/users');
});

router.post('/:id(\\d+)/toggle', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('forbidden');
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    req.session.flash = { type: 'bad', text: 'نمی‌توانید حساب خود را غیرفعال کنید.' };
    return res.redirect('/admin/users');
  }
  const target = get('SELECT * FROM users WHERE id = ?', id);
  if (!target) return res.status(404).send('not found');
  run('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', target.is_active ? 0 : 1, NOW(), id);
  if (target.is_active) {
    // kill active sessions of deactivated user
    run('DELETE FROM sessions WHERE sess LIKE ?', `%"userId":${id}%`);
  }
  audit(req, 'user_toggled', { entity: 'user', entityId: id, details: { active: !target.is_active } });
  req.session.flash = { type: 'ok', text: target.is_active ? 'کاربر غیرفعال شد (نشست‌های فعال او باطل شد).' : 'کاربر فعال شد.' };
  res.redirect('/admin/users');
});

router.post('/:id(\\d+)/reset-password', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('forbidden');
  const id = parseInt(req.params.id, 10);
  const target = get('SELECT * FROM users WHERE id = ?', id);
  if (!target) return res.status(404).send('not found');
  const v = validator(req.body);
  const password = v.password('new_password', 'رمز جدید', { min: 8 });
  if (!v.ok()) { req.session.flash = { type: 'bad', text: Object.values(v.errors)[0] }; return res.redirect('/admin/users'); }
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(password), NOW(), id);
  run('DELETE FROM sessions WHERE sess LIKE ?', `%"userId":${id}%`);
  audit(req, 'user_password_reset_by_admin', { entity: 'user', entityId: id });
  req.session.flash = { type: 'ok', text: 'رمز کاربر بازنشانی شد و همه نشست‌های او باطل گردید.' };
  res.redirect('/admin/users');
});

router.post('/:id(\\d+)/delete', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('forbidden');
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    req.session.flash = { type: 'bad', text: 'نمی‌توانید حساب خود را حذف کنید.' };
    return res.redirect('/admin/users');
  }
  const target = get('SELECT * FROM users WHERE id = ?', id);
  if (!target) return res.status(404).send('not found');
  const hasOrders = get('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?', id).c > 0;
  if (hasOrders) {
    run('UPDATE users SET is_active = 0 WHERE id = ?', id);
    run('DELETE FROM sessions WHERE sess LIKE ?', `%"userId":${id}%`);
    req.session.flash = { type: 'ok', text: 'این کاربر سابقه سفارش دارد؛ برای حفظ سوابق مالی حذف نشد و غیرفعال گردید.' };
    audit(req, 'user_soft_deleted', { entity: 'user', entityId: id });
    return res.redirect('/admin/users');
  }
  run('DELETE FROM users WHERE id = ?', id);
  audit(req, 'user_deleted', { entity: 'user', entityId: id });
  req.session.flash = { type: 'ok', text: 'کاربر حذف شد.' };
  res.redirect('/admin/users');
});

module.exports = router;
