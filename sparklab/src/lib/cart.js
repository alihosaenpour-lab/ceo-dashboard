'use strict';
/** Server-side persistent cart (DB), keyed by user id or session id. */
const { get, run } = require('../db');
const { getSetting } = require('./settings');

const now = () => new Date().toISOString();

function ownerKey(req) {
  return req.user ? `u:${req.user.id}` : `s:${req.sessionID}`;
}

function ensureCart(req) {
  const key = ownerKey(req);
  let cart = get('SELECT * FROM carts WHERE owner_key = ?', key);
  if (!cart) {
    const id = run('INSERT INTO carts (owner_key, user_id, items_json, updated_at) VALUES (?,?,?,?)',
      key, req.user ? req.user.id : null, '[]', now()).lastId;
    cart = get('SELECT * FROM carts WHERE id = ?', id);
  }
  return cart;
}

function readCart(req) {
  const cart = ensureCart(req);
  let items = [];
  try { items = JSON.parse(cart.items_json || '[]'); } catch (_) { items = []; }
  return { cart, items };
}

function saveCart(req, items, couponCode) {
  const cart = ensureCart(req);
  run('UPDATE carts SET items_json = ?, coupon_code = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(items), couponCode === undefined ? cart.coupon_code : (couponCode || null), now(), cart.id);
}

/** Merge guest cart into the user's cart at login. */
function mergeIntoUserCart(sessionId, userId) {
  const guest = get('SELECT * FROM carts WHERE owner_key = ?', `s:${sessionId}`);
  if (!guest) return;
  let guestItems = [];
  try { guestItems = JSON.parse(guest.items_json || '[]'); } catch (_) {}
  if (!guestItems.length) { run('DELETE FROM carts WHERE id = ?', guest.id); return; }
  const key = `u:${userId}`;
  let userCart = get('SELECT * FROM carts WHERE owner_key = ?', key);
  if (!userCart) {
    run('INSERT INTO carts (owner_key, user_id, items_json, coupon_code, updated_at) VALUES (?,?,?,?,?)',
      key, userId, JSON.stringify(guestItems), guest.coupon_code, now());
  } else {
    let items = [];
    try { items = JSON.parse(userCart.items_json || '[]'); } catch (_) {}
    for (const gi of guestItems) {
      const ex = items.find((i) => i.product_id === gi.product_id);
      if (ex) ex.qty = Math.min(9, (ex.qty || 1) + (gi.qty || 1));
      else items.push(gi);
    }
    run('UPDATE carts SET items_json = ?, coupon_code = COALESCE(coupon_code, ?), updated_at = ? WHERE id = ?',
      JSON.stringify(items), guest.coupon_code, now(), userCart.id);
  }
  run('DELETE FROM carts WHERE id = ?', guest.id);
}

function addItem(req, productId, qty = 1) {
  const { items } = readCart(req);
  const ex = items.find((i) => i.product_id === productId);
  if (ex) ex.qty = Math.min(9, ex.qty + qty);
  else items.push({ product_id: productId, qty: Math.max(1, Math.min(9, qty)) });
  saveCart(req, items);
}

function setQty(req, productId, qty) {
  let { items } = readCart(req);
  if (qty <= 0) items = items.filter((i) => i.product_id !== productId);
  else {
    const ex = items.find((i) => i.product_id === productId);
    if (ex) ex.qty = Math.min(9, qty);
  }
  saveCart(req, items);
}

function removeItem(req, productId) {
  let { items } = readCart(req);
  items = items.filter((i) => i.product_id !== productId);
  saveCart(req, items);
}

function clearCart(req) {
  saveCart(req, [], null);
}

/** Recompute cart lines from DB (live prices/availability) + coupon. */
function cartDetails(reqOrItems, couponCodeArg) {
  const items = Array.isArray(reqOrItems) ? reqOrItems : readCart(reqOrItems).items;
  const couponCode = couponCodeArg !== undefined
    ? couponCodeArg
    : (Array.isArray(reqOrItems) ? null : readCart(reqOrItems).cart.coupon_code);

  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const p = get(
      `SELECT p.id, p.title, p.slug, p.price, p.discount_price, p.cover_image, p.is_active,
              p.version, p.license_type, c.name AS category_name,
              (SELECT COUNT(*) FROM product_files f WHERE f.product_id = p.id AND f.is_active = 1) AS has_file
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
      it.product_id
    );
    if (!p || !p.is_active) continue;
    const unit = p.discount_price && p.discount_price > 0 && p.discount_price < p.price ? p.discount_price : p.price;
    const qty = Math.max(1, Math.min(9, it.qty || 1));
    const lineTotal = unit * qty;
    subtotal += lineTotal;
    lines.push({ product: p, qty, unit, lineTotal });
  }

  let discountTotal = 0;
  let coupon = null;
  let couponError = null;
  if (couponCode && lines.length) {
    coupon = get('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE', String(couponCode).trim());
    if (!coupon || !coupon.is_active) couponError = 'کد تخفیف معتبر نیست.';
    else if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) couponError = 'کد تخفیف منقضی شده است.';
    else if (coupon.max_uses && coupon.used_count >= coupon.max_uses) couponError = 'ظرفیت استفاده از این کد تکمیل شده است.';
    else if (coupon.min_total && subtotal < coupon.min_total) {
      couponError = `حداقل مبلغ خرید برای این کد ${Number(coupon.min_total).toLocaleString('fa-IR')} تومان است.`;
    } else {
      if (coupon.type === 'percent') {
        discountTotal = Math.round(subtotal * Math.min(100, coupon.value) / 100);
        if (coupon.max_discount && discountTotal > coupon.max_discount) discountTotal = coupon.max_discount;
      } else discountTotal = Math.min(subtotal, coupon.value);
    }
    if (couponError) { coupon = null; discountTotal = 0; }
  }

  const total = Math.max(0, subtotal - discountTotal);
  const currency = getSetting('order.currency', 'تومان');
  return { lines, subtotal, discountTotal, total, coupon, couponCode: coupon ? coupon.code : (couponCode || null), couponError, currency, count: lines.reduce((s, l) => s + l.qty, 0) };
}

/** Count for header badge (works for guests too). */
function cartCount(req) {
  try { return cartDetails(req).count; } catch (_) { return 0; }
}

module.exports = {
  ensureCart, readCart, saveCart, mergeIntoUserCart,
  addItem, setQty, removeItem, clearCart, cartDetails, cartCount,
};
