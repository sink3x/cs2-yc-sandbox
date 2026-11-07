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

module.exports = { DATA, MAP_IDS, CalloutMaps, isWebp, BASE };
