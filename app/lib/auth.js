'use strict';
// Password hashing (scrypt), sessions and login rate limiting for the admin panel.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { safeEqual } = require('./util');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const N = 16384;
  const key = crypto.scryptSync(String(password), salt, 64, { N, r: 8, p: 1 }).toString('hex');
  return `scrypt$${N}$${salt}$${key}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const key = crypto.scryptSync(String(password), parts[2], 64, { N, r: 8, p: 1 }).toString('hex');
  return safeEqual(key, parts[3]);
}

/**
 * Сессии входа. Живут долго и «скользят»: каждый заход продлевает срок (не чаще раза в renewAfterMs), поэтому активного
 * пользователя не выкидывает; неактивного — через ttlMs (30 дней); жёсткий потолок от входа — absMs (180 дней).
 * Хранятся на диске (файл 0600, ключи — SHA-256 от идентификатора, сам токен на диск не попадает), поэтому
 * перезапуск панели и деплой никого не разлогинивают.
 */
class Sessions {
  constructor({ ttlMs = 30 * 24 * 3600_000, absMs = 180 * 24 * 3600_000, renewAfterMs, file = null, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs; this.absMs = absMs; this.now = now; this.file = file;
    this.renewAfterMs = renewAfterMs ?? Math.min(3600_000, Math.max(1, Math.floor(ttlMs / 20)));
    this.map = new Map(); this.timer = null;
    this.load();
  }
  static key(id) { return crypto.createHash('sha256').update(String(id)).digest('hex'); }
  load() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const t = this.now();
      for (const [k, s] of Object.entries(raw.sessions || {})) if (s && typeof s.user === 'string' && s.exp > t && (s.born || 0) + this.absMs > t) this.map.set(k, s);
    } catch { /* нет файла или он повреждён: начинаем с чистого листа */ }
  }
  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ sessions: Object.fromEntries(this.map) }), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
      } catch { /* не критично: сессии останутся в памяти */ }
    }, 1000);
    if (this.timer.unref) this.timer.unref();
  }
  create(user, extra = {}) {
    const id = crypto.randomBytes(32).toString('hex'); const t = this.now();
    this.map.set(Sessions.key(id), { user, exp: t + this.ttlMs, born: t, seen: t, ...extra });
    this.save();
    return id;
  }
  get(id) {
    const k = Sessions.key(id); const s = this.map.get(k);
    if (!s) return null;
    const t = this.now();
    if (s.exp < t || (s.born || 0) + this.absMs < t) { this.map.delete(k); this.save(); return null; }
    if (t - (s.seen || 0) >= this.renewAfterMs) { // скользящее продление
      s.seen = t; s.exp = Math.min(t + this.ttlMs, (s.born || t) + this.absMs); s.renewed = true; this.save();
    }
    return s;
  }
  /** Сколько секунд осталось жить cookie этой сессии. */
  maxAgeSec(s) { return Math.max(1, Math.floor((s.exp - this.now()) / 1000)); }
  /** true один раз после продления: сервер в ответ выдаёт cookie с новым сроком. */
  takeRenewed(s) { if (!s.renewed) return false; s.renewed = false; return true; }
  destroy(id) { this.map.delete(Sessions.key(id)); this.save(); }
  destroyUser(user, exceptId) {
    const keep = exceptId ? Sessions.key(exceptId) : null;
    for (const [k, s] of this.map) if (s.user === user && k !== keep) this.map.delete(k);
    this.save();
  }
  sweep() { const t = this.now(); for (const [k, s] of this.map) if (s.exp < t || (s.born || 0) + this.absMs < t) this.map.delete(k); this.save(); }
}

/** Sliding-window limiter: at most `max` failures per `windowMs` per key. */
class FailureLimiter {
  constructor({ max = 6, windowMs = 10 * 60_000, now = () => Date.now() } = {}) {
    this.max = max; this.windowMs = windowMs; this.now = now; this.hits = new Map();
  }
  recent(key) {
    const t = this.now() - this.windowMs;
    const arr = (this.hits.get(key) || []).filter((x) => x > t);
    this.hits.set(key, arr);
    return arr;
  }
  blocked(key) { return this.recent(key).length >= this.max; }
  fail(key) { this.recent(key).push(this.now()); }
  reset(key) { this.hits.delete(key); }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = { hashPassword, verifyPassword, Sessions, FailureLimiter, parseCookies };
