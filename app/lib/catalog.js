'use strict';
// Skin / agent / music-kit catalog for the admin panel's skin editor.
// The data comes from the community ByMykel/CSGO-API JSON files (too big for the 256 KB app bundle),
// is fetched by the panel at runtime, compacted and cached on disk.
const { readJson, writeJsonAtomic } = require('./util');

const BASE = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';
const IMG_PREFIX = 'https://community.akamai.steamstatic.com/economy/image/';
const TTL_MS = 7 * 24 * 3600 * 1000;
const CATALOG_VERSION = 4;

const CATEGORY_KIND = { Knives: 'knife', Gloves: 'glove' };

const shortImg = (u) => {
  const s = String(u || '');
  return s.startsWith(IMG_PREFIX) ? s.slice(IMG_PREFIX.length) : s;
};

/**
 * Compact the three source files.
 * skins:   [paint, weaponIndex, patternName, rarityIndex, minFloat, maxFloat, statTrak(0|1), image]
 * weapons: { id: 'weapon_ak47', def: 7, name: 'AK-47', cat: 'Rifles', kind: 'weapon'|'knife'|'glove' }
 */
function buildCatalog({ skins = [], agents = [], music = [], base = [] }) {
  const weapons = [];
  const weaponIdx = new Map();
  const rarities = [];
  const rarityIdx = new Map();
  const out = [];
  const seen = new Set();

  const weaponIndex = (w, cat) => {
    const key = `${w.id}:${w.weapon_id}`;
    if (weaponIdx.has(key)) return weaponIdx.get(key);
    const i = weapons.length;
    weapons.push({ id: String(w.id), def: w.weapon_id, name: String(w.name || w.id), cat, kind: CATEGORY_KIND[cat] || 'weapon' });
    weaponIdx.set(key, i);
    return i;
  };
  const rarityIndex = (r) => {
    const name = String((r && r.name) || '—');
    if (rarityIdx.has(name)) return rarityIdx.get(name);
    const i = rarities.length;
    rarities.push({ n: name, c: String((r && r.color) || '#b0c3d9') });
    rarityIdx.set(name, i);
    return i;
  };

  for (const s of skins) {
    const w = s && s.weapon;
    if (!w || !w.id || !Number.isInteger(w.weapon_id)) continue;
    if (String(w.id).startsWith('sfui_wpnhud')) continue; // duplicate "vanilla knife" rows of the HUD
    const cat = (s.category && s.category.name) || 'Other';
    const vanilla = s.paint_index == null;
    const paint = vanilla ? 0 : Number(s.paint_index);
    if (!Number.isInteger(paint) || paint < 0) continue;
    if (vanilla && cat !== 'Knives') continue;
    const key = `${w.weapon_id}:${paint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const wi = weaponIndex(w, cat);
    const name = vanilla ? 'Ваниль (без скина)' : String((s.pattern && s.pattern.name) || s.name || paint);
    out.push([paint, wi, name, rarityIndex(s.rarity), Number(s.min_float ?? 0), Number(s.max_float ?? 1), s.stattrak ? 1 : 0, shortImg(s.image)]);
  }

  const agentList = agents
    .filter((a) => a && a.model_player && /^\d+$/.test(String(a.def_index)))
    .map((a) => ({
      def: Number(a.def_index), name: String(a.name), team: a.team && a.team.id === 'counter-terrorists' ? 'ct' : 't',
      model: String(a.model_player), img: shortImg(a.image), rarity: rarityIndex(a.rarity),
    }));

  // В каталоге у каждого набора есть двойник «StatTrak™ Music Kit» с тем же def_index: в базе плагина они неразличимы, поэтому оставляем один.
  const musicSeen = new Set();
  const musicList = music
    .filter((m) => m && /^\d+$/.test(String(m.def_index)) && !/stattrak/i.test(String(m.name)) && !/_st$/.test(String(m.id || '')))
    .filter((m) => { const k = String(m.def_index); if (musicSeen.has(k)) return false; musicSeen.add(k); return true; })
    .map((m) => ({ id: Number(m.def_index), name: String(m.name), img: shortImg(m.image) }));

  // Картинки «голого» оружия (без скина) — для списка моделей: def_index → image
  const baseImg = new Map((Array.isArray(base) ? base : []).filter((b) => b && Number.isInteger(b.def_index) && b.image).map((b) => [b.def_index, shortImg(b.image)]));
  for (const w of weapons) { const im = baseImg.get(w.def); if (im) w.img = im; }

  return { v: CATALOG_VERSION, imgBase: IMG_PREFIX, weapons, rarities, skins: out, agents: agentList, music: musicList };
}

// ---- Стикеры: ~11 тыс. штук (17 МБ исходного JSON) — храним сжато на диске панели и отдаём страницами с поиском -------------------
const STICKER_IMG = 'https://cdn.steamstatic.com/apps/730/icons/econ/stickers/';
const STICKER_VERSION = 1;
const STICKER_TYPES = ['Autograph', 'Team', 'Event', 'Other'];
const sIdx = (arr, map, v) => { const k = String(v || '—'); if (!map.has(k)) { map.set(k, arr.length); arr.push(k); } return map.get(k); };
/** items: [id, name, rarityIdx, effectIdx, typeIdx, eventIdx, img] */
function buildStickers(list = []) {
  const rarities = []; const rmap = new Map(); const effects = []; const emap = new Map(); const events = []; const vmap = new Map();
  const items = [];
  for (const s of Array.isArray(list) ? list : []) {
    const id = Number(s && s.def_index);
    if (!Number.isInteger(id) || id <= 0 || !s.image) continue;
    const img = String(s.image);
    if (!img.startsWith(STICKER_IMG)) continue;
    const ri = sIdx(rarities, rmap, s.rarity && s.rarity.name);
    if (rarities[ri] && !rarities.colors) rarities.colors = {};
    if (s.rarity && s.rarity.color) (rarities.colors = rarities.colors || {})[ri] = String(s.rarity.color);
    items.push([id, String(s.name || id).replace(/^Sticker \| /, '').slice(0, 80), ri, sIdx(effects, emap, s.effect),
      Math.max(0, STICKER_TYPES.indexOf(s.type)), sIdx(events, vmap, s.tournament && s.tournament.name), img.slice(STICKER_IMG.length)]);
  }
  const colors = rarities.colors || {};
  return { v: STICKER_VERSION, imgBase: STICKER_IMG, rarities: rarities.map((n, i) => ({ n, c: colors[i] || '#b0c3d9' })), effects, events, types: STICKER_TYPES, items };
}

/** Фильтр + страница. q ищется по подстроке имени и по турниру, без учёта регистра. */
function queryStickers(data, { q = '', type = '', effect = '', event = '', ids = '', page = 0, size = 60 } = {}) {
  const shape = (it) => ({ id: it[0], name: it[1], rarity: data.rarities[it[2]].n, color: data.rarities[it[2]].c, effect: data.effects[it[3]], type: data.types[it[4]], event: data.events[it[5]], img: it[6] });
  if (ids) {
    const want = new Set(String(ids).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 10));
    return { total: want.size, items: data.items.filter((it) => want.has(it[0])).map(shape) };
  }
  const ql = String(q).trim().toLowerCase().slice(0, 60);
  const ti = type ? data.types.indexOf(type) : -1; const ei = effect ? data.effects.indexOf(effect) : -1; const vi = event ? data.events.indexOf(event) : -1;
  const hit = data.items.filter((it) => (ti < 0 || it[4] === ti) && (ei < 0 || it[3] === ei) && (vi < 0 || it[5] === vi)
    && (!ql || it[1].toLowerCase().includes(ql) || data.events[it[5]].toLowerCase().includes(ql) || String(it[0]) === ql));
  const sz = Math.min(Math.max(Number(size) || 60, 1), 120); const pg = Math.max(Number(page) || 0, 0);
  return { total: hit.length, items: hit.slice(pg * sz, pg * sz + sz).map(shape) };
}

class StickerCache {
  constructor({ file, fetchJson = defaultFetchJson, now = () => Date.now(), ttlMs = TTL_MS } = {}) {
    this.file = file; this.fetchJson = fetchJson; this.now = now; this.ttlMs = ttlMs; this.mem = null; this.inflight = null;
  }
  async get() {
    const t = this.now();
    if (this.mem && t - this.mem.at < this.ttlMs) return this.mem.data;
    const disk = this.file ? readJson(this.file, null) : null;
    if (disk && disk.data && disk.data.v === STICKER_VERSION && t - disk.at < this.ttlMs) { this.mem = disk; return disk.data; }
    if (!this.inflight) {
      this.inflight = (async () => {
        const data = buildStickers(await this.fetchJson(`${BASE}/stickers.json`));
        if (!data.items.length) throw new Error('sticker source returned nothing');
        const rec = { at: this.now(), data };
        if (this.file) { try { writeJsonAtomic(this.file, rec); } catch { /* best effort */ } }
        this.mem = rec; return data;
      })().finally(() => { this.inflight = null; });
    }
    try { return await this.inflight; } catch (e) {
      const stale = (this.mem && this.mem.data) || (disk && disk.data && disk.data.v === STICKER_VERSION ? disk.data : null);
      if (stale) return stale;
      throw Object.assign(new Error(`sticker catalog unavailable: ${e.message}`), { status: 503 });
    }
  }
}

async function defaultFetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

class CatalogCache {
  constructor({ file, fetchJson = defaultFetchJson, now = () => Date.now(), ttlMs = TTL_MS } = {}) {
    this.file = file; this.fetchJson = fetchJson; this.now = now; this.ttlMs = ttlMs;
    this.mem = null; this.inflight = null;
  }

  async get() {
    const t = this.now();
    if (this.mem && t - this.mem.at < this.ttlMs) return this.mem.data;
    const disk = this.file ? readJson(this.file, null) : null;
    if (disk && disk.data && disk.data.v === CATALOG_VERSION && t - disk.at < this.ttlMs) { this.mem = disk; return disk.data; }
    if (!this.inflight) {
      this.inflight = (async () => {
        const [skins, agents, music, base] = await Promise.all(['skins', 'agents', 'music_kits', 'base_weapons'].map((n) => this.fetchJson(`${BASE}/${n}.json`).catch((e) => { if (n !== 'base_weapons') throw e; return []; })));
        const data = buildCatalog({ skins, agents, music, base });
        if (!data.skins.length) throw new Error('catalog source returned no skins');
        const rec = { at: this.now(), data };
        if (this.file) { try { writeJsonAtomic(this.file, rec); } catch { /* cache is best effort */ } }
        this.mem = rec;
        return data;
      })().finally(() => { this.inflight = null; });
    }
    try {
      return await this.inflight;
    } catch (e) {
      const stale = (this.mem && this.mem.data) || (disk && disk.data && disk.data.v === CATALOG_VERSION ? disk.data : null);
      if (stale) return stale;
      throw Object.assign(new Error(`skin catalog unavailable: ${e.message}`), { status: 503 });
    }
  }
}

module.exports = { buildCatalog, CatalogCache, buildStickers, queryStickers, StickerCache, shortImg, IMG_PREFIX, CATALOG_VERSION };
