'use strict';
// Skin editor backend: reads and writes the WeaponPaints MySQL tables on the game VM.
// All statements are built from validated values only (numbers, allow-listed strings), and the set of
// columns is introspected, so a plugin update that adds or drops columns does not break the editor.
const { execFile } = require('node:child_process');

const DB = 'weaponpaints';
const TABLES = {
  wp_player_skins: { key: ['steamid', 'weapon_team', 'weapon_defindex'] },
  wp_player_knife: { key: ['steamid', 'weapon_team'] },
  wp_player_gloves: { key: ['steamid', 'weapon_team'] },
  wp_player_agents: { key: ['steamid'] },
  wp_player_music: { key: ['steamid', 'weapon_team'] },
  wp_player_pins: { key: ['steamid', 'weapon_team'] },
};

const STEAMID = /^7656119\d{10}$/;
const NAMETAG = /^[\p{L}\p{N} _.\-!?+*#@()]{0,20}$/u;
const KNIFE_ID = /^weapon_[a-z0-9_]{2,40}$/;
const AGENT_MODEL = /^agents\/models\/[a-z0-9_/]{3,120}\.vmdl$/;

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const isSteamId = (s) => STEAMID.test(String(s));

const sqlStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const sqlVal = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : sqlStr(v));

function unescapeCell(c) {
  if (c === undefined || c === 'NULL') return null;
  return c.replace(/\\(t|n|\\|0)/g, (_m, k) => ({ t: '\t', n: '\n', '\\': '\\', 0: '\0' }[k]));
}

/** Parse `mysql -B` output (header line + tab-separated rows). */
function parseTsv(text) {
  const lines = String(text || '').split('\n').filter((l) => l.length);
  if (!lines.length) return [];
  const head = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, unescapeCell(cells[i])]));
  });
}

function int(v, min, max, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw err(`${name}: целое число ${min}–${max}`);
  return n;
}
function teamsOf(v) {
  const list = v === undefined || v === null ? [2, 3] : (Array.isArray(v) ? v : [v]);
  const out = [...new Set(list.map((t) => int(t, 2, 3, 'team')))];
  if (!out.length) throw err('team: нужна хотя бы одна команда (2 = T, 3 = CT)');
  return out;
}

const flt = (v, lo, hi, name, dflt) => {
  const n = v === undefined || v === null || v === '' ? dflt : Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw err(`${name}: число ${lo}…${hi}`);
  return Math.round(n * 1e4) / 1e4;
};
/** Стикеры WeaponPaints: до 5 слотов, формат колонки «id;schema;x;y;wear;scale;rotation». null/0 — пустой слот. */
function validateStickers(list) {
  if (!Array.isArray(list) || list.length > 5) throw err('stickers: массив до 5 слотов');
  return Array.from({ length: 5 }, (_x, i) => {
    const st = list[i];
    if (!st || !st.id) return null;
    return { id: int(st.id, 1, 999999, `stickers[${i}].id`), schema: int(st.schema ?? i, 0, 4, `stickers[${i}].schema`),
      x: flt(st.x, -3, 3, `stickers[${i}].x`, 0), y: flt(st.y, -3, 3, `stickers[${i}].y`, 0), wear: flt(st.wear, 0, 1, `stickers[${i}].wear`, 0),
      scale: flt(st.scale, 0.05, 5, `stickers[${i}].scale`, 1), rotation: flt(st.rotation, -360, 360, `stickers[${i}].rotation`, 0) };
  });
}
const stickerCell = (st) => (st ? [st.id, st.schema, st.x, st.y, st.wear, st.scale, st.rotation].join(';') : '0;0;0;0;0;0;0');
function parseStickerCell(v) {
  const p = String(v || '').split(';'); const id = Number(p[0]);
  if (!Number.isFinite(id) || id <= 0) return null;
  const n = (i, d) => { const x = Number(p[i]); return Number.isFinite(x) ? x : d; };
  return { id, schema: n(1, 0), x: n(2, 0), y: n(3, 0), wear: n(4, 0), scale: n(5, 1), rotation: n(6, 0) };
}

/** Validate and normalise the operations received from the panel. */
function validateOps(ops) {
  if (!Array.isArray(ops) || !ops.length || ops.length > 40) throw err('ops: от 1 до 40 операций');
  return ops.map((o) => {
    switch (o && o.op) {
      case 'skin': {
        const wear = Number(o.wear ?? 0.01);
        if (!Number.isFinite(wear) || wear < 0 || wear > 1) throw err('wear: число 0–1');
        const nametag = String(o.nametag ?? '');
        if (!NAMETAG.test(nametag)) throw err('nametag: до 20 символов (буквы, цифры, пробел и _ . - ! ? + * # @ ( ))');
        const out = {
          op: 'skin', teams: teamsOf(o.teams), def: int(o.def, 1, 99999, 'def'), paint: int(o.paint, 0, 99999, 'paint'),
          wear: Math.round(wear * 1e6) / 1e6, seed: int(o.seed ?? 0, 0, 1000, 'seed'), nametag,
          stattrak: o.stattrak ? 1 : 0, stattrakCount: int(o.stattrakCount ?? 0, 0, 9999999, 'stattrakCount'),
        };
        if (o.stickers !== undefined) out.stickers = validateStickers(o.stickers);
        return out;
      }
      case 'stattrak-reset': return { op: 'stattrak-reset', teams: teamsOf(o.teams), def: int(o.def, 1, 99999, 'def') };
      case 'unskin': return { op: 'unskin', teams: teamsOf(o.teams), def: int(o.def, 1, 99999, 'def') };
      case 'knife': {
        if (o.knife === null || o.knife === '' || o.knife === undefined) return { op: 'knife', teams: teamsOf(o.teams), knife: null };
        if (!KNIFE_ID.test(String(o.knife))) throw err('knife: id вида weapon_knife_karambit');
        return { op: 'knife', teams: teamsOf(o.teams), knife: String(o.knife) };
      }
      case 'gloves': return { op: 'gloves', teams: teamsOf(o.teams), def: int(o.def ?? 0, 0, 99999, 'def') };
      case 'agents': {
        const out = { op: 'agents' };
        for (const k of ['ct', 't']) {
          if (o[k] === undefined) continue;
          if (o[k] === null || o[k] === '') out[k] = null;
          else if (AGENT_MODEL.test(String(o[k]))) out[k] = String(o[k]);
          else throw err(`agents.${k}: путь модели agents/models/….vmdl`);
        }
        if (out.ct === undefined && out.t === undefined) throw err('agents: укажите ct и/или t');
        return out;
      }
      case 'music': return { op: 'music', teams: teamsOf(o.teams), id: int(o.id ?? 0, 0, 99999, 'id') };
      case 'reset': return { op: 'reset' };
      default: throw err(`unknown op: ${o && o.op}`);
    }
  });
}

/** Defaults for NOT NULL columns without a default that we do not set ourselves (schema drift safety). */
function fillerFor(col) {
  const t = String(col.type || '').toLowerCase();
  if (/int|decimal|float|double|bit|bool/.test(t)) return 0;
  return '';
}

function tableSql(schema, table, key, values, { update = true } = {}) {
  const cols = schema[table];
  if (!cols) throw err(`таблица ${table} ещё не создана плагином — запустите сервер и дождитесь загрузки WeaponPaints`, 503);
  const have = new Map(cols.map((c) => [c.name, c]));
  const row = {};
  for (const [k, v] of Object.entries({ ...key, ...values })) if (have.has(k)) row[k] = v;
  for (const c of cols) if (!(c.name in row) && !c.nullable && c.def === null && !c.auto) row[c.name] = fillerFor(c);
  const names = Object.keys(row);
  if (!names.length) throw err(`таблица ${table}: нет подходящих колонок`, 500);
  const keyCols = new Set(Object.keys(key));
  const upd = names.filter((n) => !keyCols.has(n));
  const tail = update && upd.length ? ` ON DUPLICATE KEY UPDATE ${upd.map((n) => `${n}=VALUES(${n})`).join(', ')}` : '';
  return `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((n) => sqlVal(row[n])).join(', ')})${tail};`;
}

function deleteSql(schema, table, steamid, where = {}) {
  const cols = schema[table];
  if (!cols) return null;
  const have = new Set(cols.map((c) => c.name));
  const conds = [`steamid=${sqlStr(steamid)}`];
  for (const [k, v] of Object.entries(where)) {
    if (!have.has(k)) continue;
    conds.push(Array.isArray(v) ? `${k} IN (${v.map(sqlVal).join(',')})` : `${k}=${sqlVal(v)}`);
  }
  return `DELETE FROM ${table} WHERE ${conds.join(' AND ')};`;
}

function updateSql(schema, table, steamid, where, set) {
  const cols = schema[table]; if (!cols) return null;
  const have = new Set(cols.map((c) => c.name));
  const sets = Object.entries(set).filter(([k]) => have.has(k)).map(([k, v]) => `${k}=${sqlVal(v)}`);
  if (!sets.length) return null;
  const conds = [`steamid=${sqlStr(steamid)}`];
  for (const [k, v] of Object.entries(where)) if (have.has(k)) conds.push(Array.isArray(v) ? `${k} IN (${v.map(sqlVal).join(',')})` : `${k}=${sqlVal(v)}`);
  return `UPDATE ${table} SET ${sets.join(', ')} WHERE ${conds.join(' AND ')};`;
}

/** Turn normalised ops into a list of SQL statements. `schema`: table -> [{name,type,nullable,def,auto}] | null. */
function buildSql(steamid, ops, schema) {
  if (!isSteamId(steamid)) throw err('steamid: SteamID64 вида 7656119XXXXXXXXXX');
  const out = [];
  const k1 = (team) => ({ steamid, weapon_team: team });
  for (const o of ops) {
    switch (o.op) {
      case 'skin':
        if (o.paint === 0 && !(o.stickers && o.stickers.some(Boolean))) { out.push(deleteSql(schema, 'wp_player_skins', steamid, { weapon_defindex: o.def, weapon_team: o.teams })); break; }
        for (const t of o.teams) {
          const vals = {
            weapon_paint_id: o.paint, weapon_wear: o.wear, weapon_seed: o.seed, weapon_nametag: o.nametag || null,
            weapon_stattrak: o.stattrak, weapon_stattrak_count: o.stattrakCount,
          };
          if (o.stickers) o.stickers.forEach((st, i) => { vals[`weapon_sticker_${i}`] = stickerCell(st); });
          out.push(tableSql(schema, 'wp_player_skins', { ...k1(t), weapon_defindex: o.def }, vals));
        }
        break;
      case 'stattrak-reset':
        out.push(updateSql(schema, 'wp_player_skins', steamid, { weapon_defindex: o.def, weapon_team: o.teams }, { weapon_stattrak_count: 0 }));
        break;
      case 'unskin': out.push(deleteSql(schema, 'wp_player_skins', steamid, { weapon_defindex: o.def, weapon_team: o.teams })); break;
      case 'knife':
        if (o.knife === null) out.push(deleteSql(schema, 'wp_player_knife', steamid, { weapon_team: o.teams }));
        else for (const t of o.teams) out.push(tableSql(schema, 'wp_player_knife', k1(t), { knife: o.knife }));
        break;
      case 'gloves':
        if (o.def === 0) out.push(deleteSql(schema, 'wp_player_gloves', steamid, { weapon_team: o.teams }));
        else for (const t of o.teams) out.push(tableSql(schema, 'wp_player_gloves', k1(t), { weapon_defindex: o.def }));
        break;
      case 'agents': {
        const vals = {};
        for (const k of ['ct', 't']) if (o[k] !== undefined) vals[`agent_${k}`] = o[k];
        const cols = schema.wp_player_agents;
        if (cols) for (const c of cols) if (c.name in vals && vals[c.name] === null && !c.nullable) vals[c.name] = '';
        out.push(tableSql(schema, 'wp_player_agents', { steamid }, vals));
        break;
      }
      case 'music':
        if (o.id === 0) out.push(deleteSql(schema, 'wp_player_music', steamid, { weapon_team: o.teams }));
        else for (const t of o.teams) out.push(tableSql(schema, 'wp_player_music', k1(t), { music_id: o.id }));
        break;
      case 'reset':
        for (const t of Object.keys(TABLES)) out.push(deleteSql(schema, t, steamid));
        break;
      default: throw err(`unknown op: ${o.op}`);
    }
  }
  return out.filter(Boolean);
}

/** Normalise raw DB rows into the loadout shape used by the panel. */
function shapeLoadout(steamid, rows) {
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const skins = (rows.wp_player_skins || []).map((r) => ({
    team: num(r.weapon_team), def: num(r.weapon_defindex), paint: num(r.weapon_paint_id), wear: num(r.weapon_wear), seed: num(r.weapon_seed),
    nametag: r.weapon_nametag || '', stattrak: num(r.weapon_stattrak) ? 1 : 0, stattrakCount: num(r.weapon_stattrak_count) || 0,
    stickers: [0, 1, 2, 3, 4].map((i) => parseStickerCell(r[`weapon_sticker_${i}`])),
  }));
  const agent = (rows.wp_player_agents || [])[0] || null;
  return {
    steamid, skins,
    knives: (rows.wp_player_knife || []).map((r) => ({ team: num(r.weapon_team), knife: r.knife })),
    gloves: (rows.wp_player_gloves || []).map((r) => ({ team: num(r.weapon_team), def: num(r.weapon_defindex) })),
    agents: agent ? { ct: agent.agent_ct || null, t: agent.agent_t || null } : { ct: null, t: null },
    music: (rows.wp_player_music || []).map((r) => ({ team: num(r.weapon_team), id: num(r.music_id) })),
    pins: (rows.wp_player_pins || []).map((r) => ({ team: num(r.weapon_team), id: num(r.id) })),
  };
}

/** Best-effort parse of the `css_players` console output into [{steamid, name}]. */
function parseOnlinePlayers(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /(7656119\d{10})/.exec(line);
    if (!m) continue;
    const nm = /"([^"]*)"/.exec(line);
    out.push({ steamid: m[1], name: nm ? nm[1] : null });
  }
  return out;
}

function defaultRun(sql) {
  return new Promise((resolve, reject) => {
    execFile('mysql', ['-uroot', '--default-character-set=utf8mb4', '-B', DB, '-e', sql], { timeout: 30000, maxBuffer: 4 << 20 }, (e, stdout, stderr) => {
      if (e) reject(err(`mysql: ${String(stderr || e.message).trim().slice(0, 300)}`, 502)); else resolve(String(stdout));
    });
  });
}

function createSkinsService({ run = defaultRun, schemaTtlMs = 60000, now = () => Date.now() } = {}) {
  let cache = { at: 0, schema: null };

  async function schema(force = false) {
    if (!force && cache.schema && now() - cache.at < schemaTtlMs) return cache.schema;
    const s = {};
    for (const t of Object.keys(TABLES)) {
      try {
        s[t] = parseTsv(await run(`SHOW COLUMNS FROM ${t}`)).map((r) => ({ name: r.Field, type: r.Type, nullable: r.Null === 'YES', def: r.Default, auto: /auto_increment/i.test(r.Extra || '') }));
      } catch { s[t] = null; }
    }
    cache = { at: now(), schema: s };
    return s;
  }

  async function loadout(steamid) {
    if (!isSteamId(steamid)) throw err('steamid: SteamID64 вида 7656119XXXXXXXXXX');
    const s = await schema();
    if (!s.wp_player_skins) return { available: false, steamid, reason: 'Таблицы WeaponPaints ещё не созданы: запустите сервер и дождитесь загрузки плагина.' };
    const rows = {};
    for (const t of Object.keys(TABLES)) if (s[t]) rows[t] = parseTsv(await run(`SELECT * FROM ${t} WHERE steamid=${sqlStr(steamid)}`));
    return { available: true, ...shapeLoadout(steamid, rows) };
  }

  async function apply(steamid, rawOps) {
    const ops = validateOps(rawOps);
    const s = await schema();
    const statements = buildSql(steamid, ops, s);
    if (!statements.length) return { changed: 0 };
    await run(`START TRANSACTION; ${statements.join(' ')} COMMIT;`);
    return { changed: statements.length };
  }

  async function knownPlayers() {
    const s = await schema();
    const parts = Object.keys(TABLES).filter((t) => s[t]).map((t) => `SELECT steamid FROM ${t}`);
    if (!parts.length) return [];
    return parseTsv(await run(`${parts.join(' UNION ')} LIMIT 200`)).map((r) => r.steamid).filter(isSteamId);
  }

  return { schema, loadout, apply, knownPlayers };
}

module.exports = { createSkinsService, validateOps, validateStickers, parseStickerCell, stickerCell, buildSql, parseTsv, parseOnlinePlayers, shapeLoadout, isSteamId, TABLES };
