'use strict';
// Страна по IP для журнала действий. Нулевые зависимости: запрос к публичному сервису делает сервер панели (браузер ничего не знает),
// результат кэшируется в файле, чтобы один и тот же адрес не уходил наружу дважды. Частные и служебные адреса наружу не отправляются.
const fs = require('node:fs');
const path = require('node:path');

const DAY = 86400000;
const OK_TTL = 30 * DAY; // страна адреса почти не меняется
const FAIL_TTL = 15 * 60000; // сбой сервиса — повторяем не чаще раза в 15 минут
const MAX_CACHE = 5000;
const PER_CALL = 25; // сколько новых адресов спрашиваем за один запрос журнала; остальное доберётся при следующем

/** Приводит адрес к каноничному виду; пустая строка — это не IP (например, «-» у системных записей). */
function normalize(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (s.startsWith('::ffff:') && s.includes('.')) s = s.slice(7);
  return /^[0-9a-f:.]{2,45}$/.test(s) && (s.includes('.') || s.includes(':')) ? s : '';
}

/** Публичный ли адрес: частные, loopback, link-local, CGNAT, документационные диапазоны наружу не уходят. */
function isPublic(ip) {
  const s = normalize(ip);
  if (!s) return false;
  if (s.includes(':')) {
    if (s === '::' || s === '::1') return false;
    const first = parseInt(s.split(':')[0] || '0', 16);
    return !(((first & 0xfe00) === 0xfc00) || ((first & 0xffc0) === 0xfe80) || first === 0x2001 && s.startsWith('2001:db8') || (first & 0xff00) === 0xff00);
  }
  const p = s.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && p[2] === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if ((a === 192 && b === 0 && p[2] === 2) || (a === 198 && b === 51 && p[2] === 100) || (a === 203 && b === 0 && p[2] === 113)) return false;
  return true;
}

/**
 * @param {{file?: string, lookup: (ip: string) => Promise<string>, now?: () => number}} o
 *   lookup возвращает двухбуквенный код страны или '' (неизвестно); исключение = сбой сервиса.
 */
function createGeo({ file, lookup, now = Date.now }) {
  let cache = {};
  try { if (file) cache = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { cache = {}; }
  const failed = new Map();
  const inflight = new Map();
  let dirty = false;

  function save() {
    if (!file || !dirty) return;
    dirty = false;
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE) for (const k of keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - MAX_CACHE)) delete cache[k];
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 }); fs.renameSync(tmp, file); } catch { /* кэш — удобство, не данные */ }
  }

  const cached = (ip) => { const e = cache[ip]; return e && now() - e.t < OK_TTL ? e.c : undefined; };

  async function one(ip) {
    if (inflight.has(ip)) return inflight.get(ip);
    const p = (async () => {
      try {
        const c = String(await lookup(ip) || '').toUpperCase();
        const cc = /^[A-Z]{2}$/.test(c) ? c : '';
        cache[ip] = { c: cc, t: now() }; dirty = true;
        return cc;
      } catch { failed.set(ip, now()); return ''; } finally { inflight.delete(ip); }
    })();
    inflight.set(ip, p);
    return p;
  }

  /**
   * Страны для списка адресов. Возвращает {map: ip → код ('' = неизвестно/частный), pending: сколько адресов ещё не опрошено}.
   * Опрашивает не больше PER_CALL новых адресов за вызов, по 5 параллельно.
   */
  async function resolve(ips) {
    const map = {}; const todo = [];
    for (const raw of new Set(ips)) {
      const ip = normalize(raw);
      if (!ip) continue;
      if (!isPublic(ip)) { map[raw] = ''; continue; }
      const c = cached(ip);
      if (c !== undefined) { map[raw] = c; continue; }
      map[raw] = '';
      if (!(failed.has(ip) && now() - failed.get(ip) < FAIL_TTL)) todo.push([raw, ip]);
    }
    const batch = todo.slice(0, PER_CALL);
    for (let i = 0; i < batch.length; i += 5) {
      await Promise.all(batch.slice(i, i + 5).map(async ([raw, ip]) => { const c = await one(ip); if (cache[ip]) map[raw] = c; }));
    }
    save();
    return { map, pending: todo.length - batch.length + batch.filter(([, ip]) => !cache[ip]).length };
  }

  return { resolve, normalize, isPublic };
}

module.exports = { createGeo, normalize, isPublic };
