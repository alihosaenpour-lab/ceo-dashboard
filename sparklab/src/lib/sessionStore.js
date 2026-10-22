'use strict';
/** express-session store backed by the SQLite DB (persistent sessions). */
const session = require('express-session');
const { db } = require('../db');

class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expire = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      db.prepare(
        'INSERT INTO sessions (sid, sess, expire) VALUES (?,?,?) ' +
        'ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire'
      ).run(sid, JSON.stringify(sess), expire);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb && cb(null); }
    catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      const expire = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(expire, sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  /** housekeeping */
  static prune() {
    try { db.prepare('DELETE FROM sessions WHERE expire < ?').run(Date.now()); } catch (_) {}
  }
}

module.exports = SqliteSessionStore;
