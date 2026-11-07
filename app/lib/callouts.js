'use strict';
// Callouts: данные мест (lib/callouts.json) и картинки схем карт. Картинки лежат в публичном репозитории
// sink3x/cs2-callouts; сервер забирает их один раз и кэширует на диске (в бандл панели они не входят).
const fs = require('fs');
const path = require('path');

const DATA = require('./callouts.json');

const BASE = 'https://raw.githubusercontent.com/sink3x/cs2-callouts/main/maps';
const MAP_IDS = Object.keys(DATA.maps);

const isWebp = (b) => Buffer.isBuffer(b) && b.length > 1000 && b.length < 2 * 1024 * 1024 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';

async function defaultFetchBuf(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

class CalloutMaps {
  constructor({ dir, fetchBuf = defaultFetchBuf } = {}) {
    this.dir = dir; this.fetchBuf = fetchBuf; this.mem = new Map(); this.inflight = new Map();
  }

  /** Картинка схемы карты (Buffer) или null, если такой карты нет. Бросает ошибку со status 503, если ни кэша, ни сети. */
  async get(id) {
    if (!MAP_IDS.includes(id)) return null; // белый список: путь из запроса на диск не попадает
    if (this.mem.has(id)) return this.mem.get(id);
    const file = this.dir ? path.join(this.dir, `${id}.webp`) : null;
    if (file && fs.existsSync(file)) {
      const b = fs.readFileSync(file);
      if (isWebp(b)) { this.mem.set(id, b); return b; }
    }
    if (!this.inflight.has(id)) {
      this.inflight.set(id, (async () => {
        const b = await this.fetchBuf(`${BASE}/${id}.webp`);
        if (!isWebp(b)) throw new Error('not a webp image');
        if (file) {
          try {
            fs.mkdirSync(this.dir, { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, b); fs.renameSync(tmp, file);
          } catch { /* best effort */ }
        }
        this.mem.set(id, b); return b;
      })().finally(() => { this.inflight.delete(id); }));
    }
    try { return await this.inflight.get(id); } catch (e) {
      throw Object.assign(new Error(`callout map unavailable: ${e.message}`), { status: 503 });
    }
  }
}

const NAME_BAD = /[\u0000-\u001f<>]/;
const ADDED_ID_RE = /^c[0-9a-z]{1,8}$/;
const coord = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000 ? Math.round(v * 10) / 10 : null);
const cleanName = (v) => String(v == null ? '' : v).trim();

/**
 * Пользовательские правки callouts: { rename: { 'карта|Place': 'Название' }, move: { 'карта|Place': [x, y] }, added: { карта: [{ id, name, x, y, side }] } }.
 * Пустое название = сброс. Неизвестные места и неверные значения — ошибка, правки целиком не применяются.
 */
function validateCustom(input) {
  const errors = []; const out = { rename: {}, move: {}, added: {} };
  const inp = input && typeof input === 'object' ? input : {};
  const known = (key) => { const [m, en] = String(key).split('|'); const map = DATA.maps[m]; return !!(map && map.places.some((p) => p[0] === en)); };
  const rn = inp.rename && typeof inp.rename === 'object' ? Object.entries(inp.rename) : [];
  const mv = inp.move && typeof inp.move === 'object' ? Object.entries(inp.move) : [];
  if (rn.length > 600 || mv.length > 600) errors.push('too many entries');
  else {
    for (const [k, v] of rn) {
      if (!known(k)) { errors.push(`rename: unknown place ${k}`); continue; }
      const name = cleanName(v); if (!name) continue;
      if (name.length > 40 || NAME_BAD.test(name)) { errors.push(`rename: bad name for ${k}`); continue; }
      out.rename[k] = name;
    }
    for (const [k, v] of mv) {
      if (!known(k)) { errors.push(`move: unknown place ${k}`); continue; }
      const x = Array.isArray(v) ? coord(v[0]) : null; const y = Array.isArray(v) ? coord(v[1]) : null;
      if (x == null || y == null) { errors.push(`move: bad position for ${k}`); continue; }
      out.move[k] = [x, y];
    }
  }
  const ad = inp.added && typeof inp.added === 'object' ? Object.entries(inp.added) : [];
  for (const [m, arr] of ad) {
    if (!DATA.maps[m] || !Array.isArray(arr) || arr.length > 60) { errors.push(`added: bad map ${m}`); continue; }
    const list = []; const ids = new Set();
    for (const a of arr) {
      const id = String((a && a.id) || ''); const name = cleanName(a && a.name); const x = coord(a && a.x); const y = coord(a && a.y);
      if (!ADDED_ID_RE.test(id) || ids.has(id) || !name || name.length > 40 || NAME_BAD.test(name) || x == null || y == null) { errors.push(`added: bad entry ${id} on ${m}`); continue; }
      ids.add(id); list.push({ id, name, x, y, side: ['t', 'm', 'ct'].includes(a.side) ? a.side : 'm' });
    }
    if (list.length) out.added[m] = list;
  }
  return { ok: errors.length === 0, errors, custom: out };
}

const EMPTY_CUSTOM = () => ({ rename: {}, move: {}, added: {} });

module.exports = { DATA, MAP_IDS, CalloutMaps, isWebp, BASE, validateCustom, EMPTY_CUSTOM };
