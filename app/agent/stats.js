'use strict';
// Статистика сервера из консольного лога CS2 (`log on`, `mp_logdetail 3`): убийства, смерти, урон, гранаты, время и карты.
// Выстрелы/пули в лог не попадают — для них нужен плагин (CounterStrikeSharp), см. README.
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const STEAM64_BASE = 76561197960265728n;
const toSteam64 = (id) => {
  let m = /^\[U:1:(\d+)\]$/.exec(id); if (m) return String(STEAM64_BASE + BigInt(m[1]));
  m = /^STEAM_[0-5]:([01]):(\d+)$/.exec(id); if (m) return String(STEAM64_BASE + BigInt(m[2]) * 2n + BigInt(m[1]));
  return null;
};
const P = String.raw`"(.*?)<(\d+)><([^>]*)><(\w*)>"`; // "name<uid><steamid><team>"
const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const POS = String.raw`(?:\s*\[${NUM} ${NUM} ${NUM}\])?`; // [x y z] — позиция игрока (CS2 пишет её в строках kill/attack/threw)
const RE = {
  kill: new RegExp(`${P}${POS} killed ${P}${POS} with "([\\w.-]+)"( \\(headshot\\))?`),
  attack: new RegExp(`${P}${POS} attacked ${P}${POS} with "([\\w.-]+)" \\(damage "(\\d+)"\\) \\(damage_armor "(\\d+)"\\) \\(health "(\\d+)"\\) \\(armor "(\\d+)"\\) \\(hitgroup "([^"]+)"\\)`),
  threw: new RegExp(`${P}${POS} threw (\\w+)`),
  enter: new RegExp(`${P} entered the game`),
  leave: new RegExp(`${P} disconnected`),
  map: /(?:Started|Loading) map "([^"]+)"/,
  round: /World triggered "Round_End"/,
};
const who = (name, sid) => { const id = toSteam64(sid); return id ? { id, name } : (sid === 'BOT' ? { bot: true, name } : null); };

/** Разбор одной строки лога → событие или null. */
function parseLine(line) {
  let m;
  const pos = (x, y) => (x === undefined || x === null ? null : [Number(x), Number(y)]);
  if ((m = RE.attack.exec(line))) { const a = who(m[1], m[3]); const v = who(m[8], m[10]); return { t: 'attack', a, v, weapon: m[15], damage: Number(m[16]), hitgroup: m[20] }; }
  if ((m = RE.kill.exec(line))) { const a = who(m[1], m[3]); const v = who(m[8], m[10]); return { t: 'kill', a, v, weapon: m[15], hs: !!m[16], ap: pos(m[5], m[6]), vp: pos(m[12], m[13]) }; }
  if ((m = RE.threw.exec(line))) return { t: 'threw', a: who(m[1], m[3]), kind: m[8] };
  if ((m = RE.enter.exec(line))) return { t: 'enter', a: who(m[1], m[3]) };
  if ((m = RE.leave.exec(line))) return { t: 'leave', a: who(m[1], m[3]) };
  if ((m = RE.map.exec(line))) return { t: 'map', map: m[1] };
  if (RE.round.test(line)) return { t: 'round' };
  return null;
}

const blank = (name) => ({ name, kills: 0, deaths: 0, headshots: 0, damage: 0, hits: 0, grenades: {}, weapons: {}, hitgroups: {}, seconds: 0, maps: {}, heat: {}, firstSeen: null, lastSeen: null });
const blankMap = () => ({ seconds: 0, rounds: 0, kills: 0, sessions: 0 });

const CELL = 256; // размер клетки тепловой карты, юниты CS2
const MAX_CELLS = 400; // клеток на игрока и карту
/** Фиксирует убийство (kills) или смерть (deaths) в клетке карты: heat[map]['gx,gy'] = [убийства, смерти]. */
function heatAdd(x, map, pos, idx) {
  if (!pos || !map || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return;
  const cells = (x.heat = x.heat || {})[map] = x.heat[map] || {};
  const key = `${Math.floor(pos[0] / CELL)},${Math.floor(pos[1] / CELL)}`;
  const c = cells[key] = cells[key] || [0, 0]; c[idx]++;
  const keys = Object.keys(cells);
  if (keys.length > MAX_CELLS) { keys.sort((a, b) => (cells[a][0] + cells[a][1]) - (cells[b][0] + cells[b][1])); for (const k of keys.slice(0, keys.length - MAX_CELLS + 20)) delete cells[k]; }
}

class Stats {
  constructor({ now = () => Date.now(), data } = {}) { this.now = now; this.data = data && data.players ? data : { since: new Date(now()).toISOString(), players: {}, maps: {} }; this.sessions = new Map(); this.map = null; this.dirty = false; }
  player(p) { const d = this.data.players; if (!d[p.id]) d[p.id] = blank(p.name); const x = d[p.id]; if (p.name) x.name = p.name; x.lastSeen = new Date(this.now()).toISOString(); x.firstSeen = x.firstSeen || x.lastSeen; return x; }
  mapOf(name) { const m = this.data.maps; if (!m[name]) m[name] = blankMap(); return m[name]; }
  pm(x) { const key = this.map || 'unknown'; if (!x.maps[key]) x.maps[key] = { seconds: 0, kills: 0, deaths: 0, damage: 0 }; return x.maps[key]; }
  closeSession(id) { const s = this.sessions.get(id); if (!s) return; const sec = Math.max(0, Math.round((this.now() - s.at) / 1000)); const x = this.data.players[id]; if (x) { x.seconds += sec; this.pm(x).seconds += sec; } if (s.map) this.mapOf(s.map).seconds += sec; this.sessions.delete(id); this.dirty = true; }
  /** Применяет событие из parseLine. */
  apply(e) {
    if (!e) return; this.dirty = true;
    if (e.t === 'map') { for (const id of [...this.sessions.keys()]) { this.closeSession(id); this.sessions.set(id, { at: this.now(), map: e.map }); } this.map = e.map; this.mapOf(e.map).sessions++; return; }
    if (e.t === 'round') { if (this.map) this.mapOf(this.map).rounds++; return; }
    if (e.t === 'enter' && e.a && e.a.id) { this.player(e.a); this.sessions.set(e.a.id, { at: this.now(), map: this.map }); return; }
    if (e.t === 'leave' && e.a && e.a.id) { this.player(e.a); this.closeSession(e.a.id); return; }
    if (e.t === 'kill') {
      if (e.a && e.a.id) { const x = this.player(e.a); x.kills++; heatAdd(x, this.map, e.ap, 0); if (e.hs) x.headshots++; x.weapons[e.weapon] = (x.weapons[e.weapon] || 0) + 1; this.pm(x).kills++; if (this.map) this.mapOf(this.map).kills++; }
      if (e.v && e.v.id) { const y = this.player(e.v); y.deaths++; heatAdd(y, this.map, e.vp, 1); this.pm(y).deaths++; }
      return;
    }
    if (e.t === 'attack' && e.a && e.a.id && (!e.v || e.v.id !== e.a.id)) { const x = this.player(e.a); x.damage += e.damage; x.hits++; x.hitgroups[e.hitgroup] = (x.hitgroups[e.hitgroup] || 0) + 1; this.pm(x).damage += e.damage; return; }
    if (e.t === 'threw' && e.a && e.a.id) { const x = this.player(e.a); const k = ({ hegrenade: 'he', flashbang: 'flash', smokegrenade: 'smoke', molotov: 'molotov', incgrenade: 'molotov', decoy: 'decoy' })[e.kind]; if (k) x.grenades[k] = (x.grenades[k] || 0) + 1; }
  }
  feed(line) { this.apply(parseLine(line)); }
  /** Закрывает сессии (при остановке/перезапуске лога), чтобы время не потерялось. */
  flush() { for (const id of [...this.sessions.keys()]) this.closeSession(id); }
  /** Сводка для API: время включает ещё идущие сессии. */
  summary(onlySteamid) {
    const live = new Map(); for (const [id, s] of this.sessions) live.set(id, Math.max(0, Math.round((this.now() - s.at) / 1000)));
    const players = Object.entries(this.data.players).filter(([id]) => !onlySteamid || id === onlySteamid).map(([id, p]) => ({
      steamid: id, name: p.name, kills: p.kills, deaths: p.deaths, kd: p.deaths ? +(p.kills / p.deaths).toFixed(2) : p.kills, headshots: p.headshots, hsPct: p.kills ? Math.round(100 * p.headshots / p.kills) : 0,
      firstSeen: p.firstSeen, lastSeen: live.has(id) ? new Date(this.now()).toISOString() : p.lastSeen, damage: p.damage, hits: p.hits, grenades: p.grenades, weapons: p.weapons, hitgroups: p.hitgroups, seconds: p.seconds + (live.get(id) || 0), online: live.has(id), maps: p.maps, ...(onlySteamid ? { heat: p.heat || {}, cell: CELL } : {}), firstSeen: p.firstSeen, lastSeen: p.lastSeen,
    })).sort((a, b) => b.kills - a.kills);
    const maps = Object.entries(this.data.maps).map(([map, m]) => ({ map, ...m })).sort((a, b) => b.seconds - a.seconds);
    return { since: this.data.since, map: this.map, players, maps };
  }
}

/** Подключает Stats к журналу cs2.service; сохраняет в файл раз в 30 с. Возвращает {stats, stop}. */
function startTracker({ file, readJson, writeJsonAtomic, log = () => {}, spawnFn = spawn }) {
  const stats = new Stats({ data: (() => { try { return readJson(file, null); } catch { return null; } })() });
  let child = null; let stopped = false; let buf = '';
  const run = () => {
    if (stopped) return;
    child = spawnFn('journalctl', ['-u', 'cs2.service', '-f', '-n', '0', '-o', 'cat', '--no-pager'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { stats.feed(buf.slice(0, i)); buf = buf.slice(i + 1); } if (buf.length > 65536) buf = ''; });
    child.on('exit', () => { stats.flush(); if (!stopped) setTimeout(run, 5000).unref(); });
    child.on('error', (e) => log('stats tracker:', e.message));
  };
  const save = () => { if (!stats.dirty) return; try { writeJsonAtomic(file, stats.data); stats.dirty = false; } catch (e) { log('stats save:', e.message); } };
  const timer = setInterval(save, 30_000); timer.unref();
  run();
  return { stats, save, stop() { stopped = true; clearInterval(timer); stats.flush(); save(); if (child) child.kill(); } };
}

module.exports = { parseLine, Stats, startTracker, toSteam64 };
