'use strict';
// Пользователи панели (карточки, slug) и «сетапы» игроков: cfg, параметры запуска, мышь/DPI, видео, слепки настроек.
const crypto = require('node:crypto');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });

// ------------------------------------------------------------------ slug пользователей
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
function slugify(name) {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return s || 'user';
}
/** Каждому пользователю — постоянный уникальный slug (хранится в записи, переименование логина его не меняет). Возвращает true, если что-то добавлено. */
function ensureSlugs(users) {
  const taken = new Set(Object.values(users).map((u) => u && u.slug).filter(Boolean));
  let changed = false;
  const names = Object.keys(users).sort((a, b) => String((users[a] || {}).created || '').localeCompare(String((users[b] || {}).created || '')) || a.localeCompare(b));
  for (const name of names) {
    const u = users[name]; if (!u || u.slug) continue;
    const base = slugify(u.persona && /[a-z0-9]/i.test(u.persona) ? u.persona : name);
    let s = base; let i = 2;
    while (taken.has(s)) { s = `${base.slice(0, 36)}-${i++}`; }
    u.slug = s; taken.add(s); changed = true;
  }
  return changed;
}
const findBySlug = (users, slug) => Object.entries(users).find(([, u]) => u && u.slug === slug) || null;

/** Что видно о пользователе в списке/карточке. Почта и пароль — только админам и самому пользователю. */
function publicUser(name, u, { full = false, inGameAdmin = false } = {}) {
  const sid = /^\d{17}$/.test(String(u.steamid || '')) ? String(u.steamid) : '';
  const out = {
    slug: u.slug, name, displayName: u.persona || name, avatar: /^https:\/\/avatars(\.akamai)?\.steamstatic\.com\//.test(u.avatar || '') ? u.avatar : '',
    role: u.role === 'player' ? 'player' : 'admin', steamid: sid, steamUrl: sid ? `https://steamcommunity.com/profiles/${sid}` : '',
    created: u.created || '', lastLogin: u.lastLogin || '', inGameAdmin: !!inGameAdmin,
  };
  if (full) { out.email = u.email || ''; out.links = Array.isArray(u.links) ? u.links : []; }
  return out;
}

const SORTS = { name: (a, b) => a.displayName.localeCompare(b.displayName), login: (a, b) => String(b.lastLogin).localeCompare(String(a.lastLogin)), created: (a, b) => String(b.created).localeCompare(String(a.created)) };
/** Список с фильтром/сортировкой/страницами. Параметры приходят из query string, поэтому всё проверяется по белому списку. */
function listUsers(cards, q = {}) {
  const role = ['admin', 'player'].includes(q.role) ? q.role : '';
  const sort = Object.hasOwn(SORTS, q.sort) ? q.sort : 'login';
  const text = String(q.q || '').slice(0, 40).toLowerCase().trim();
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 30));
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  let r = cards.filter((c) => (!role || c.role === role) && (!text || [c.displayName, c.name, c.steamid, c.slug].some((x) => String(x).toLowerCase().includes(text))));
  r = r.sort(SORTS[sort]);
  return { total: r.length, page, limit, sort, role, q: text, users: r.slice((page - 1) * limit, page * limit) };
}

// ------------------------------------------------------------------ сетапы
const MAX_SETUPS_PER_USER = 50;
const MAX_FILES = 5;
const MAX_FILE = 64 * 1024;
const ID_RE = /^[a-z0-9]{8}$/;
const KINDS = ['cfg', 'launch', 'mouse', 'video', 'full'];
const VIS = ['private', 'users', 'all'];

const cleanText = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
const numIn = (v, min, max, what) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${what}: число от ${min} до ${max}`);
  return n;
};
const newId = () => crypto.randomBytes(6).toString('hex').slice(0, 8).replace(/[^a-z0-9]/g, '0');
/** «a1b2c3d4-мой-сетап» → «a1b2c3d4»; всё остальное — 400. */
function parseSetupRef(ref) {
  const m = /^([a-z0-9]{8})(?:-[a-z0-9-]{0,60})?$/.exec(String(ref || '')); if (!m) throw bad('setup: некорректная ссылка');
  return m[1];
}
const setupSlug = (s) => `${s.id}-${slugify(s.title).slice(0, 30)}`;

/** Достаём из cfg/видео-файлов то, что можно показать: чувствительность, eDPI, разрешение, FPS и т.д. Без исполнения чего-либо. */
function parseCfg(text) {
  const found = {}; const crosshair = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim(); if (!line) continue;
    const m = /^([a-z_][a-z0-9_]*)\s+"?([^";]*?)"?\s*;?$/i.exec(line); if (!m) continue;
    const k = m[1].toLowerCase(); const v = m[2].trim();
    if (['sensitivity', 'zoom_sensitivity_ratio', 'm_rawinput', 'm_yaw', 'fps_max', 'fps_max_ui', 'volume', 'viewmodel_fov', 'viewmodel_offset_x', 'viewmodel_offset_y', 'viewmodel_offset_z', 'cl_bob_lower_amt', 'rate', 'cl_interp_ratio', 'cl_updaterate', 'cl_cmdrate'].includes(k)) found[k] = v;
    if (k.startsWith('cl_crosshair') || k === 'crosshair') crosshair[k] = v;
  }
  return { found, crosshair };
}
/** cs2_video.txt: пары "setting.xxx" "value". */
function parseVideo(text) {
  const out = {};
  const re = /"setting\.([a-z0-9_.]+)"\s+"([^"]*)"/gi; let m;
  while ((m = re.exec(String(text || '')))) out[m[1].toLowerCase()] = m[2];
  return out;
}

function validateFiles(files) {
  if (files == null) return [];
  if (!Array.isArray(files)) throw bad('files: список');
  if (files.length > MAX_FILES) throw bad(`files: не больше ${MAX_FILES}`);
  const seen = new Set();
  return files.map((f) => {
    const name = String((f && f.name) || '').trim();
    if (!/^[\w.-]{1,60}\.(cfg|txt|vcfg|json)$/i.test(name) || name.startsWith('.')) throw bad('files: имя вида autoexec.cfg / cs2_video.txt / cs2_user_convars_0_slot0.vcfg');
    if (seen.has(name.toLowerCase())) throw bad(`files: дубль ${name}`);
    seen.add(name.toLowerCase());
    const text = cleanText(f.text, MAX_FILE + 1);
    if (text.length > MAX_FILE) throw bad(`files: ${name} больше 64 КБ`);
    return { name, text };
  });
}

/** Проверка и нормализация сетапа из тела запроса. Неизвестные поля отбрасываются. */
function validateSetup(body, { slugs = new Set() } = {}) {
  const b = body || {};
  const title = cleanText(b.title, 60).replace(/[<>]/g, '').trim();
  if (!title) throw bad('title: 1–60 символов');
  const kind = KINDS.includes(b.kind) ? b.kind : 'full';
  const visibility = VIS.includes(b.visibility) ? b.visibility : 'private';
  const sharedWith = visibility === 'users' ? [...new Set((Array.isArray(b.sharedWith) ? b.sharedWith : []).map(String).filter((s) => SLUG_RE.test(s)))].slice(0, 30) : [];
  for (const s of sharedWith) if (slugs.size && !slugs.has(s)) throw bad(`sharedWith: нет пользователя ${s}`, 404);
  const m = b.mouse || {}; const v = b.video || {};
  const mouse = {
    model: cleanText(m.model, 60).replace(/[<>]/g, '').trim(), dpi: numIn(m.dpi, 100, 32000, 'dpi'), sens: numIn(m.sens, 0.01, 100, 'sens'), zoomSens: numIn(m.zoomSens, 0.01, 10, 'zoomSens'),
    pollingHz: numIn(m.pollingHz, 125, 8000, 'pollingHz'), rawInput: m.rawInput == null ? null : !!m.rawInput, windowsSens: numIn(m.windowsSens, 1, 11, 'windowsSens'),
  };
  const video = {
    resolution: /^(\d{3,5})x(\d{3,5})$/.test(String(v.resolution || '').trim()) ? String(v.resolution).trim() : '', aspect: ['', '16:9', '16:10', '4:3', '5:4'].includes(v.aspect) ? v.aspect : '',
    mode: ['', 'fullscreen', 'windowed', 'borderless'].includes(v.mode) ? v.mode : '', refreshHz: numIn(v.refreshHz, 24, 1000, 'refreshHz'), notes: cleanText(v.notes, 1500),
  };
  if (String(v.resolution || '').trim() && !video.resolution) throw bad('resolution: вид 1920x1080');
  return {
    title, kind, visibility, sharedWith, mouse, video,
    launch: cleanText(b.launch, 400).replace(/\n/g, ' ').trim(),
    crosshair: cleanText(b.crosshair, 80).replace(/\s/g, ''),
    notes: cleanText(b.notes, 2000),
    files: validateFiles(b.files),
  };
}

/** Производные значения слепка: eDPI и найденные в cfg параметры. */
function derive(s) {
  const found = {}; let crosshair = {}; let video = {};
  for (const f of s.files || []) {
    if (/\.(cfg|vcfg)$/i.test(f.name)) { const p = parseCfg(f.text); Object.assign(found, p.found); Object.assign(crosshair, p.crosshair); }
    if (/video/i.test(f.name)) Object.assign(video, parseVideo(f.text));
  }
  const dpi = s.mouse && s.mouse.dpi; const sens = (s.mouse && s.mouse.sens) != null ? s.mouse.sens : (found.sensitivity != null ? Number(found.sensitivity) : null);
  const edpi = dpi && Number.isFinite(sens) && sens != null ? Math.round(dpi * sens * 100) / 100 : null;
  return { edpi, found, crosshair, video };
}

/** Кто может смотреть: владелец и админы панели всегда; остальным — по видимости. */
function canView(s, { user, slug, role }) {
  if (s.owner === user || role === 'admin') return true;
  if (s.visibility === 'all') return true;
  return s.visibility === 'users' && (s.sharedWith || []).includes(slug);
}
const canEdit = (s, { user }) => s.owner === user;

function summary(s, ownerCard) {
  return { id: s.id, ref: setupSlug(s), title: s.title, kind: s.kind, visibility: s.visibility, owner: ownerCard, created: s.created, updated: s.updated,
    edpi: derive(s).edpi, dpi: s.mouse && s.mouse.dpi, resolution: s.video && s.video.resolution, files: (s.files || []).length, launch: !!s.launch };
}

module.exports = { slugify, ensureSlugs, findBySlug, publicUser, listUsers, validateSetup, validateFiles, parseCfg, parseVideo, derive, canView, canEdit, summary, parseSetupRef, setupSlug, newId,
  SLUG_RE, ID_RE, KINDS, VIS, MAX_SETUPS_PER_USER };
