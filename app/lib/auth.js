'use strict';
// Password hashing (scrypt), sessions and login rate limiting for the admin panel.
const crypto = require('node:crypto');
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

class Sessions {
  constructor({ ttlMs = 12 * 3600_000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new Map();
  }
  create(user, extra = {}) {
    const id = crypto.randomBytes(32).toString('hex');
    this.map.set(id, { user, exp: this.now() + this.ttlMs, ...extra });
    return id;
  }
  get(id) {
    const s = this.map.get(id);
    if (!s) return null;
    if (s.exp < this.now()) { this.map.delete(id); return null; }
    return s;
  }
  destroy(id) { this.map.delete(id); }
  destroyUser(user, exceptId) {
    for (const [id, s] of this.map) if (s.user === user && id !== exceptId) this.map.delete(id);
  }
  sweep() { for (const [id, s] of this.map) if (s.exp < this.now()) this.map.delete(id); }
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
