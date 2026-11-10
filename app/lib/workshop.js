'use strict';
// Сведения о картах Workshop: название, превью, размер, теги. Источник — Steam Web API (метод без ключа), ответ хранится в файле.
// Нужны, чтобы у любой карты из Workshop (в том числе добавленной по ссылке) была картинка и подпись.
const { readJson, writeJsonAtomic } = require('./util');

const API = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
const ID_RE = /^\d{6,12}$/;
const IMG_RE = /^https:\/\/(images\.steamusercontent\.com|steamuserimages-a\.akamaihd\.net)\/ugc\/[0-9]+\/[0-9A-Fa-f]+\/?$/;
const TAGS = { classic: 'classic', deathmatch: 'dm', wingman: 'wingman', armsrace: 'armsrace', custom: 'custom', training: 'training', hostage: 'hostage' };

/** Ответ Steam → { id: { ok, title, img, mb, tags, updated } }. Чужие поля и адреса картинок с других хостов отбрасываем. */
function parseDetails(json) {
  const out = {};
  const list = json && json.response && Array.isArray(json.response.publishedfiledetails) ? json.response.publishedfiledetails : [];
  for (const d of list) {
    const id = String(d.publishedfileid || '');
    if (!ID_RE.test(id)) continue;
    if (Number(d.result) !== 1) { out[id] = { ok: false }; continue; }
    const img = String(d.preview_url || '');
    out[id] = {
      ok: true,
      title: String(d.title || '').replace(/[\u0000-\u001f<>"\\]/g, '').trim().slice(0, 80),
      img: IMG_RE.test(img) ? img.replace(/\/?$/, '/') : '',
      mb: Math.max(0, Math.round((Number(d.file_size) || 0) / 1e6)),
      tags: [...new Set((Array.isArray(d.tags) ? d.tags : []).map((t) => TAGS[String(t && t.tag).toLowerCase()]).filter(Boolean))],
      updated: Number(d.time_updated) || 0,
    };
  }
  return out;
}

function createWorkshopMeta({ file, fetchImpl = fetch, now = Date.now, ttlMs = 7 * 86400e3, retryMs = 3600e3, log = () => {} }) {
  let cache = null; let busy = null;
  const load = () => { if (!cache) { const c = readJson(file, {}); cache = c && typeof c === 'object' ? c : {}; } return cache; };
  const fresh = (e) => e && now() - e.at < (e.ok ? ttlMs : retryMs);

  async function fetchBatch(ids) {
    const body = new URLSearchParams({ itemcount: String(ids.length) });
    ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));
    const res = await fetchImpl(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`steam HTTP ${res.status}`);
    return parseDetails(await res.json());
  }

  /** Сведения по списку ID. Устаревшие и неизвестные спрашиваем у Steam; при ошибке сети отдаём то, что есть. */
  async function get(ids) {
    const want = [...new Set(ids.map(String).filter((x) => ID_RE.test(x)))].slice(0, 200);
    const c = load();
    const stale = want.filter((id) => !fresh(c[id]));
    if (stale.length) {
      if (!busy) {
        busy = (async () => {
          try {
            for (let i = 0; i < stale.length; i += 50) {
              const part = stale.slice(i, i + 50); const got = await fetchBatch(part);
              for (const id of part) c[id] = { ...(got[id] || { ok: false }), at: now() };
            }
            writeJsonAtomic(file, c);
          } catch (e) { log('workshop meta:', e.message); for (const id of stale) if (!c[id]) c[id] = { ok: false, at: now() - ttlMs + 60e3, pending: true }; }
        })().finally(() => { busy = null; });
      }
      await busy;
    }
    const out = {};
    for (const id of want) { const e = c[id]; if (e && e.ok) out[id] = { title: e.title, img: e.img, mb: e.mb, tags: e.tags, updated: e.updated }; else if (e && !e.pending) out[id] = { missing: true }; }
    return out;
  }
  return { get };
}

module.exports = { createWorkshopMeta, parseDetails, ID_RE, IMG_RE };
