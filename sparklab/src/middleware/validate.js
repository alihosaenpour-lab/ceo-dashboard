'use strict';
/** Small server-side validation helpers. */

const fa = {
  digits: (s) => String(s ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)),
};

function clean(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/\u0000/g, '').trim();
}

class ValidationError extends Error {
  constructor(fieldErrors) {
    super('validation failed');
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

function validator(body = {}, errors = {}) {
  const api = {
    errors,
    ok: () => Object.keys(errors).length === 0,
    fail: () => { throw new ValidationError(errors); },

    required(field, label) {
      const v = clean(body[field]);
      if (!v) errors[field] = `${label} الزامی است.`;
      return v;
    },
    string(field, label, { min = 0, max = 5000, required = true } = {}) {
      const v = clean(fa.digits(body[field]));
      if (!v) { if (required) errors[field] = `${label} الزامی است.`; return ''; }
      if (v.length < min) errors[field] = `${label} باید حداقل ${min} نویسه باشد.`;
      if (v.length > max) errors[field] = `${label} باید حداکثر ${max} نویسه باشد.`;
      return v;
    },
    email(field = 'email', label = 'ایمیل') {
      const v = clean(body[field]).toLowerCase();
      if (!v) { errors[field] = `${label} الزامی است.`; return ''; }
      if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(v) || v.length > 254) {
        errors[field] = `${label} معتبر نیست.`;
        return '';
      }
      return v;
    },
    phone(field = 'phone', label = 'شماره موبایل', { required = false } = {}) {
      let v = clean(fa.digits(body[field])).replace(/[\s\-()]/g, '');
      if (!v) { if (required) errors[field] = `${label} الزامی است.`; return ''; }
      if (v.startsWith('0098')) v = '0' + v.slice(4);
      if (v.startsWith('+98')) v = '0' + v.slice(3);
      if (v.startsWith('98') && v.length === 12) v = '0' + v.slice(2);
      if (!/^09\d{9}$/.test(v)) errors[field] = `${label} معتبر نیست (مثال: 09121234567).`;
      return v;
    },
    password(field = 'password', label = 'رمز عبور', { min = 8 } = {}) {
      const v = String(body[field] ?? '');
      if (!v) { errors[field] = `${label} الزامی است.`; return ''; }
      if (v.length < min) errors[field] = `${label} باید حداقل ${min} نویسه باشد.`;
      if (v.length > 128) errors[field] = `${label} بیش از حد طولانی است.`;
      return v;
    },
    int(field, label, { min = -Infinity, max = Infinity, required = true, def = 0 } = {}) {
      const raw = clean(fa.digits(body[field]));
      if (raw === '') { if (required) errors[field] = `${label} الزامی است.`; return def; }
      const n = Number(raw);
      if (!Number.isInteger(n)) { errors[field] = `${label} باید عدد صحیح باشد.`; return def; }
      if (n < min || n > max) { errors[field] = `${label} باید بین ${min} و ${max} باشد.`; return def; }
      return n;
    },
    enum(field, label, allowed, { required = true, def = '' } = {}) {
      const v = clean(body[field]);
      if (!v) { if (required) errors[field] = `${label} الزامی است.`; return def; }
      if (!allowed.includes(v)) { errors[field] = `${label} نامعتبر است.`; return def; }
      return v;
    },
    slug(field, label, { required = true } = {}) {
      const v = clean(body[field]).toLowerCase().replace(/\s+/g, '-');
      if (!v) { if (required) errors[field] = `${label} الزامی است.`; return ''; }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) || v.length > 120) {
        errors[field] = `${label} فقط می‌تواند شامل حروف انگلیسی کوچک، عدد و خط تیره باشد.`;
        return '';
      }
      return v;
    },
    url(field, label, { required = false } = {}) {
      const v = clean(body[field]);
      if (!v) { if (required) errors[field] = `${label} الزامی است.`; return ''; }
      try {
        const u = new URL(v);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad protocol');
        return u.toString();
      } catch (_) { errors[field] = `${label} معتبر نیست.`; return ''; }
    },
    bool(field) {
      const v = body[field];
      return v === true || v === 'true' || v === '1' || v === 1 || v === 'on';
    },
  };
  return api;
}

module.exports = { validator, ValidationError, clean };
