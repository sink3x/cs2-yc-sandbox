'use strict';
// Admin panel backend. Runs on the small always-on VM: logs users in, starts/stops the CS2 VM through
// the Yandex Cloud Compute API (service account of this VM) and proxies a whitelist of calls to the agent.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Sessions, FailureLimiter, verifyPassword, hashPassword, parseCookies } = require('../lib/auth');
const { readBody, readJsonBody, send, matchRoute } = require('../lib/http');
const { readJson, writeJsonAtomic, loadEnvFile, makeLogger, sleep } = require('../lib/util');
const { PRESETS, MAPS, CATALOG, WORKSHOP_MAPS, WORKSHOP_CATS } = require('../lib/presets');
const { YandexCompute } = require('../lib/yc');
const { CatalogCache } = require('../lib/catalog');
const practice = require('../lib/practice');
const stateLib = require('../lib/state');
const account = require('../lib/account');
const people = require('../lib/people');
const crypto = require('node:crypto');

const log = makeLogger('admin');
const ETC = process.env.CS2ADMIN_ETC || '/etc/cs2-admin';
const VAR = process.env.CS2ADMIN_VAR || '/var/lib/cs2-admin';
const PUBLIC_DIR = path.join(__dirname, 'public');
const NAME_OK = /^[a-z0-9_-]{1,32}$/;
function validateUserPresets(input) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('presets: объект');
  const out = {};
  const ids = Object.keys(input);
  if (ids.length > 40) throw bad('presets: не больше 40');
  for (const id of ids) {
    const p = input[id];
    if (!NAME_OK.test(id)) throw bad(`id пресета: a-z, 0-9, _ и - (до 32): ${id}`);
    const cvars = {};
    const entries = Object.entries((p && p.cvars) || {});
    if (entries.length > 100) throw bad('cvars: не больше 100');
    for (const [k, v] of entries) {
      if (!practice.CVAR_NAME.test(k)) throw bad(`bad cvar: ${k}`);
      if (!/^[A-Za-z0-9_.,:+\-/ ]{0,64}$/.test(String(v))) throw bad(`bad value for ${k}`);
      cvars[k] = String(v);
    }
    const label = String((p && p.label) || id).slice(0, 40);
    if (/[<>]/.test(label)) throw bad('label: без < >');
    out[id] = { label, note: String((p && p.note) || '').slice(0, 120).replace(/[<>]/g, ''), gameType: Number(p && p.gameType) || 0, gameMode: Number(p && p.gameMode) || 0, cvars };
  }
  return out;
}
const IMG_HOSTS = /^https:\/\/(community\.akamai\.steamstatic\.com|cdn\.steamstatic\.com|raw\.githubusercontent\.com)\//;
function validateCustomSkins(input) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!Array.isArray(input) || input.length > 300) throw bad('skins: массив до 300');
  return input.map((s) => {
    const def = Number(s && s.def); const paint = Number(s && s.paint);
    if (!Number.isInteger(def) || def < 1 || def > 99999) throw bad('def: 1–99999');
    if (!Number.isInteger(paint) || paint < 1 || paint > 99999) throw bad('paint ID: 1–99999');
    const name = String((s && s.name) || '').trim();
    if (!name || name.length > 40 || /[<>]/.test(name)) throw bad('name: 1–40 символов, без < >');
    const img = String((s && s.img) || '');
    if (img && !IMG_HOSTS.test(img)) throw bad('img: только steamstatic или raw.githubusercontent.com (https)');
    const weaponName = String((s && s.weaponName) || '').slice(0, 40).replace(/[<>]/g, '');
    const kind = ['weapon', 'knife', 'glove'].includes(s && s.kind) ? s.kind : 'weapon';
    return { def, paint, name, img, weaponName, kind, weaponId: String((s && s.weaponId) || '').replace(/[^a-z0-9_]/g, '').slice(0, 48) };
  });
}
// Что разрешено роли «игрок»: только свои скины, профиль и общая информация о сервере.
const PLAYER_OK = new Set(['POST /api/link-account', 'GET /api/me', 'GET /api/public-info', 'GET /api/profile', 'PUT /api/profile', 'GET /api/skins/catalog', 'GET /api/skins/loadout/:steamid',
  'POST /api/skins/apply/:steamid', 'GET /api/faceit/:steamid', 'GET /api/custom-skins', 'GET /api/stats/:steamid',
  'GET /api/users/:slug', 'GET /api/people', 'GET /api/setups', 'GET /api/setups/:ref', 'POST /api/setups', 'PUT /api/setups/:ref', 'DELETE /api/setups/:ref', 'POST /api/setups/:ref/copy']);
const SELF_ONLY = new Set(['GET /api/stats/:steamid', 'GET /api/skins/loadout/:steamid', 'POST /api/skins/apply/:steamid', 'GET /api/faceit/:steamid']);
const MAX_PLAYER_ACCOUNTS = 300;
const DEFAULT_SETTINGS = { autoStopIdleMinutes: 30, startupGraceMinutes: 20 };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/png', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

function createApp(deps = {}) {
  const config = deps.config || readJson(path.join(ETC, 'config.json'), {});
  const secrets = deps.secrets || loadEnvFile(path.join(ETC, 'secrets.env'));
  const usersFile = deps.usersFile || path.join(VAR, 'users.json');
  const settingsFile = deps.settingsFile || path.join(VAR, 'settings.json');
  const auditFile = deps.auditFile || path.join(VAR, 'audit.log');
  const compute = deps.compute || new YandexCompute({ instanceId: config.instanceId });
  const now = deps.now || (() => Date.now());
  const sessions = deps.sessions || new Sessions({ now });
  const limiter = deps.limiter || new FailureLimiter({ now });

  const stateCacheFile = deps.stateCacheFile || path.join(VAR, 'state-cache.json');
  const userPresetsFile = deps.userPresetsFile || path.join(VAR, 'user-presets.json');
  const customSkinsFile = deps.customSkinsFile || path.join(VAR, 'custom-skins.json');
  const catalogCache = deps.catalogCache || new CatalogCache({ file: path.join(VAR, 'skin-catalog.json') });
  const keysBlocked = (ip) => limiter.blocked(`ip:${ip}`);
  const loadUsers = () => (readJson(usersFile, { users: {} }).users) || {};
  const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}), playerLogin: readJson(settingsFile, {}).playerLogin !== false });
  // ---- профиль: почта, Steam, Faceit ----------------------------------------------------------
  const brandFile = deps.brandFile || path.join(VAR, 'brand.json');
  const brandLogoFile = deps.brandLogoFile || path.join(VAR, 'brand-logo.bin');
  const loadBrand = () => { const b = readJson(brandFile, {}); return { name: String(b.name || 'sandbox-cs-1').slice(0, 40), tagline: String(b.tagline || '').slice(0, 80), logoType: b.logoType || '', v: b.v || 0 }; };
  const statsCacheFile = deps.statsCacheFile || path.join(VAR, 'stats-cache.json');
  const faceitFile = deps.faceitFile || path.join(VAR, 'faceit.json');
  const httpGet = deps.httpGet || (async (url, headers) => { const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) }); const text = await r.text().catch(() => ''); let json = null; try { json = JSON.parse(text); } catch { /* не JSON */ } return { status: r.status, json, text }; });
  const httpPost = deps.httpPost || (async (url, form) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(12000) }); return r.text(); });
  const steamNonces = new Map(); const linkTokens = new Map(); const faceitCache = new Map();
  const roleOf = (name) => ((loadUsers()[name] || {}).role === 'player' ? 'player' : 'admin');
  const playerLoginOn = () => readJson(settingsFile, {}).playerLogin !== false;
  const saveUsers = (users) => writeJsonAtomic(usersFile, { users }, 0o600);
  const touchLogin = (name) => { const us = loadUsers(); if (us[name]) { us[name].lastLogin = new Date(now()).toISOString(); saveUsers(us); } };
  const setupsFile = deps.setupsFile || path.join(VAR, 'setups.json');
  const loadSetups = () => { const r = readJson(setupsFile, { items: [] }); return Array.isArray(r.items) ? r.items : []; };
  const saveSetups = (items) => writeJsonAtomic(setupsFile, { items }, 0o600);
  /** Пользователи с постоянными slug (недостающие выдаются и сохраняются). */
  const usersWithSlugs = () => { const us = loadUsers(); if (people.ensureSlugs(us)) saveUsers(us); return us; };
  const inGameAdminIds = () => new Set((((readJson(stateCacheFile, null) || {}).state || {}).admins || []).map((a) => String(a.steamid)));
  /** Ник и аватар из публичного Steam-профиля → в запись пользователя (best effort, вход не блокирует). */
  async function refreshPersona(users, name, steamid) {
    const p = await account.steamProfile(steamid, httpGet);
    if (p && p.name) { users[name].persona = p.name; users[name].avatar = p.avatar || ''; saveUsers(users); }
  }
  /**
   * Вход через Steam: ищем панельный аккаунт для SteamID64 игрового админа. Только для SteamID из списка админов сервера
   * (его ведёт владелец), иначе любой с похожим ником мог бы занять чужой аккаунт. Порядок: имя админа = логин → ник Steam = логин →
   * единственный свободный аккаунт-админ без привязки Steam.
   */
  function autoLinkTarget(users, steamid, persona) {
    const c = readStateCache(); const adm = ((c && c.state && c.state.admins) || []).find((a) => String(a.steamid) === String(steamid));
    if (!adm) return null;
    const free = Object.keys(users).filter((n) => users[n].role !== 'player' && !users[n].steamid);
    const byName = (v) => (v ? free.find((n) => n.toLowerCase() === String(v).toLowerCase()) : null);
    return byName(adm.name) || byName(persona) || (free.length === 1 ? free[0] : null);
  }
  const profileOf = (name) => { const u = loadUsers()[name] || {}; return { user: name, displayName: u.persona || name, avatar: u.avatar || '', email: u.email || '', steamid: u.steamid || '', links: u.links || [], faceitKey: !!readJson(faceitFile, {}).key }; };
  async function faceitFor(steamid) {
    const hit = faceitCache.get(steamid);
    if (hit && hit.exp > now()) return hit.v;
    const v = await account.faceitLookup(steamid, readJson(faceitFile, {}).key, httpGet);
    faceitCache.set(steamid, { v, exp: now() + 10 * 60_000 }); return v;
  }
  const originOf = (req, secure) => (config.publicUrl ? String(config.publicUrl).replace(/\/+$/, '') : `${secure ? 'https' : 'http'}://${req.headers.host}`);

  const audit = (user, ip, action, detail) => {
    try {
      fs.mkdirSync(path.dirname(auditFile), { recursive: true });
      fs.appendFileSync(auditFile, JSON.stringify({ ts: new Date(now()).toISOString(), user, ip, action, detail: detail || null }) + '\n');
    } catch (e) { log('audit write failed:', e.message); }
  };

  // ---- agent client ---------------------------------------------------------------------------
  const agent = deps.agent || (async (method, apiPath, body, timeoutMs = 20000) => {
    const res = await fetch(`${config.agentUrl}${apiPath}`, {
      method, headers: { Authorization: `Bearer ${secrets.AGENT_TOKEN}`, 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}), signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
    if (!res.ok) throw Object.assign(new Error(j.error || `agent HTTP ${res.status}`), { status: res.status === 401 ? 502 : res.status });
    return j;
  });

  // ---- state cache: settings live on the CS2 VM, but the panel must show (and accept) them while it is off ----
  // The last state seen from the agent is kept on the panel disk. Edits made while the agent is unreachable are
  // validated here, applied to the cached copy and queued; they are replayed to the agent once it is back.
  const readStateCache = () => readJson(stateCacheFile, null);
  const writeStateCache = (c) => { try { fs.mkdirSync(path.dirname(stateCacheFile), { recursive: true }); writeJsonAtomic(stateCacheFile, c, 0o600); } catch (e) { log('state cache write failed:', e.message); } };
  const isOffline = (e) => !e.status; // errors from a reachable agent carry an HTTP status

  async function flushPending() {
    const c = readStateCache();
    if (!c || !c.pending || !c.pending.length) return;
    const rest = [...c.pending];
    while (rest.length) {
      try { await agent('PUT', '/state', { state: rest[0] }); } catch (e) {
        if (isOffline(e)) { writeStateCache({ ...c, pending: rest }); throw e; }
        log('queued settings change rejected by agent, dropped:', e.message);
      }
      rest.shift();
    }
    writeStateCache({ ...c, pending: [] });
  }

  async function getState() {
    try {
      await flushPending();
      const r = await agent('GET', '/state');
      writeStateCache({ state: r.state, plugins: r.plugins, admin_flags: r.admin_flags, protectedAdmins: r.protectedAdmins || [], savedAt: now(), pending: [] });
      return r;
    } catch (e) {
      if (!isOffline(e)) throw e;
      const c = readStateCache();
      if (!c) throw Object.assign(new Error('state cache empty'), { status: 503 });
      return { state: c.state, plugins: c.plugins, admin_flags: c.admin_flags, protectedAdmins: c.protectedAdmins || [], offline: true, savedAt: c.savedAt, pending: (c.pending || []).length };
    }
  }

  async function putState(body) {
    try {
      await flushPending();
      const r = await agent('PUT', '/state', body);
      const c = readStateCache();
      if (c) writeStateCache({ ...c, state: r.state, savedAt: now(), pending: [] });
      return r;
    } catch (e) {
      if (!isOffline(e)) throw e;
      const c = readStateCache();
      if (!c) throw Object.assign(new Error('state cache empty'), { status: 503 });
      const v = stateLib.validateState(body.state, c.state, { protect: c.protectedAdmins || [] });
      if (!v.ok) throw Object.assign(new Error(v.errors.join('; ')), { status: 400 });
      writeStateCache({ ...c, state: v.state, pending: [...(c.pending || []), body.state] });
      return { state: v.state, applied: { changed: [] }, needsRestart: false, offline: true, queued: true };
    }
  }

  async function stateSyncTick() {
    const c = readStateCache();
    const stale = !c || !c.savedAt || now() - c.savedAt > 10 * 60_000 || (c.pending && c.pending.length);
    if (!stale || vmState.busy) return;
    let d; try { d = await vmDescribe(); } catch { return; }
    if (d.status !== 'RUNNING') return;
    await getState().catch(() => {});
  }

  // ---- VM control with a background "busy" flag -------------------------------------------------
  const vmState = { busy: null, busySince: null, lastError: null, runningSince: null, idleSince: null, lastAutoStop: null };

  async function vmDescribe() {
    const d = await compute.describe();
    if (d.status === 'RUNNING') { if (!vmState.runningSince) vmState.runningSince = now(); } else { vmState.runningSince = null; vmState.idleSince = null; }
    return d;
  }

  async function startVm(user, ip) {
    const d = await vmDescribe();
    if (d.status === 'RUNNING' || d.status === 'STARTING') return { status: d.status };
    if (d.status !== 'STOPPED') throw Object.assign(new Error(`VM is ${d.status}, cannot start now`), { status: 409 });
    await compute.start();
    vmState.runningSince = now();
    audit(user, ip, 'vm.start');
    return { status: 'STARTING' };
  }

  async function stopVm(user, ip, reason = 'manual') {
    if (vmState.busy) throw Object.assign(new Error(`busy: ${vmState.busy}`), { status: 409 });
    const d = await vmDescribe();
    if (d.status === 'STOPPED' || d.status === 'STOPPING') return { status: d.status };
    if (d.status !== 'RUNNING') throw Object.assign(new Error(`VM is ${d.status}, cannot stop now`), { status: 409 });
    vmState.busy = 'stopping'; vmState.busySince = now(); vmState.lastError = null;
    audit(user, ip, 'vm.stop', reason);
    (async () => {
      try {
        try { await agent('POST', '/prepare-stop', { delaySec: reason === 'manual' ? 5 : 15 }, 170000); } catch (e) { log('prepare-stop failed (continuing):', e.message); }
        await compute.stop();
      } catch (e) { vmState.lastError = e.message; log('stop failed:', e.message); }
      finally { vmState.busy = null; vmState.busySince = null; vmState.idleSince = null; }
    })();
    return { status: 'STOPPING' };
  }

  async function idleTick() {
    const st = loadSettings();
    if (!st.autoStopIdleMinutes || vmState.busy) return;
    let d; try { d = await vmDescribe(); } catch { return; }
    if (d.status !== 'RUNNING') return;
    if (now() - vmState.runningSince < st.startupGraceMinutes * 60_000) { vmState.idleSince = null; return; }
    let server = null; try { server = await agent('GET', '/status', null, 6000); } catch { /* agent down */ }
    if (!server || !server.live) { vmState.idleSince = null; return; }
    if (server.live.humans > 0) { vmState.idleSince = null; return; }
    if (!vmState.idleSince) vmState.idleSince = now();
    if (now() - vmState.idleSince >= st.autoStopIdleMinutes * 60_000) {
      vmState.lastAutoStop = new Date(now()).toISOString();
      log(`no players for ${st.autoStopIdleMinutes} min, stopping the VM`);
      try { await stopVm('system', 'local', 'auto-idle'); } catch (e) { log('auto stop failed:', e.message); }
    }
  }

  // Статистика лежит на игровой ВМ; последнюю копию держим здесь, чтобы страница работала при выключенном сервере.
  async function statsGet(p, only) {
    const cache = readJson(statsCacheFile, {});
    try {
      const r = await agent('GET', p, null, 8000);
      if (!only) { cache.all = { ...r, savedAt: new Date(now()).toISOString() }; writeJsonAtomic(statsCacheFile, cache); }
      return r;
    } catch (e) {
      if (!cache.all) throw e;
      const all = cache.all; const players = only ? all.players.filter((x) => x.steamid === only) : all.players;
      return { ...all, players, offline: true };
    }
  }
  async function overview() {
    const out = { vm: null, server: null, busy: vmState.busy, lastError: vmState.lastError, settings: loadSettings(), idleSince: vmState.idleSince ? new Date(vmState.idleSince).toISOString() : null, lastAutoStop: vmState.lastAutoStop };
    try { out.vm = await vmDescribe(); } catch (e) { out.vmError = e.message; return out; }
    if (out.vm.status === 'RUNNING') {
      const t0 = Date.now();
      try { out.server = await agent('GET', '/status', null, 5000); out.agentMs = Date.now() - t0; } catch (e) { out.agentError = e.message; }
    }
    out.connect = out.vm.publicIp ? `connect ${out.vm.publicIp}:${config.gamePort || 27015}` : null;
    out.glance = await glance(out);
    return out;
  }

  /** Карта по id из статуса: подпись и картинка из каталога (воркшоп/своя карта — без картинки, будет монограмма). */
  function mapInfo(id) {
    if (!id) return { id: null, label: null, img: null };
    const std = MAPS.find((m) => m.id === id);
    if (std) return { id, label: std.label, img: std.img };
    const num = (String(id).match(/\d{6,}/) || [])[0];
    const ws = num && WORKSHOP_MAPS.find((m) => m.id === num);
    if (ws) return { id, label: ws.label, img: null, workshop: true };
    return { id, label: id, img: null, workshop: /workshop/i.test(String(id)) };
  }

  let glanceStats = { at: 0, value: null };
  /** Краткая сводка для страницы «Сервер»: пинг, карта, игроки, счётчики статистики. Одинакова для админа и игрока. */
  async function glance(o) {
    const live = o.server && o.server.live;
    const g = { status: o.vm ? o.vm.status : null, connect: o.connect || null, agentMs: o.agentMs != null ? o.agentMs : null, map: mapInfo(live ? live.map : null) };
    if (live) {
      Object.assign(g, { humans: live.humans, bots: live.bots, maxPlayers: live.maxPlayers, rttMs: live.rttMs != null ? live.rttMs : null, pingAvg: live.pingAvg, pingMax: live.pingMax, hostname: live.hostname || null,
        players: (live.players || []).filter((x) => !x.bot).slice(0, 16).map((x) => ({ name: x.name, ping: x.ping, time: x.time })) });
    }
    if (o.server) g.uptimeSec = o.server.uptimeSec;
    if (o.vm && o.vm.status === 'RUNNING' && o.server) {
      if (Date.now() - glanceStats.at > 15000) {
        glanceStats = { at: Date.now(), value: glanceStats.value };
        try {
          const r = await agent('GET', '/stats', null, 3000);
          const ps = r.players || [];
          glanceStats.value = { players: ps.length, kills: ps.reduce((a, x) => a + (x.kills || 0), 0), deaths: ps.reduce((a, x) => a + (x.deaths || 0), 0), hours: Math.round(ps.reduce((a, x) => a + (x.seconds || 0), 0) / 360) / 10,
            maps: (r.maps || []).length, since: r.since || null, top: ps.slice(0, 3).map((x) => ({ name: x.name, kills: x.kills, kd: x.kd })) };
        } catch { /* статистика необязательна */ }
      }
      g.stats = glanceStats.value;
    }
    return g;
  }

  // ---- routes ---------------------------------------------------------------------------------
  const P = (p) => async ({ params, body, query }) => agent('POST', p, body);
  const routes = [
    ['GET', '/api/me', async ({ user }) => { const u = usersWithSlugs()[user] || {}; return { user, slug: u.slug || '', displayName: u.persona || user, avatar: u.avatar || '', role: roleOf(user), steamid: u.steamid || '', playerLogin: playerLoginOn() }; }],
    ['GET', '/api/public-info', async () => { const o = await overview(); return { ...o.glance, map: o.glance.map.id, mapInfo: o.glance.map }; }],
    ['GET', '/api/overview', async () => overview()],
    ['GET', '/api/catalog', async () => ({ presets: PRESETS, maps: MAPS, catalog: CATALOG, toggles: practice.TOGGLES, fun: practice.FUN_PRESETS, workshop: WORKSHOP_MAPS, workshopCats: WORKSHOP_CATS })],
    ['GET', '/api/user-presets', async () => ({ presets: readJson(userPresetsFile, {}) })],
    ['PUT', '/api/user-presets', async ({ body, user, ip }) => { const v = validateUserPresets(body.presets); writeJsonAtomic(userPresetsFile, v); audit(user, ip, 'user-presets', Object.keys(v)); return { presets: v }; }],
    ['GET', '/api/custom-skins', async () => ({ skins: readJson(customSkinsFile, []) })],
    ['PUT', '/api/custom-skins', async ({ body, user, ip }) => { const v = validateCustomSkins(body.skins); writeJsonAtomic(customSkinsFile, v); audit(user, ip, 'custom-skins', v.length); return { skins: v }; }],
    ['GET', '/api/skins/catalog', async () => ({ ...(await catalogCache.get()), custom: readJson(customSkinsFile, []) })],
    ['GET', '/api/skins/players', async () => agent('GET', '/skins/players')],
    ['GET', '/api/skins/loadout/:steamid', async ({ params }) => agent('GET', `/skins/loadout/${encodeURIComponent(params.steamid)}`)],
    ['POST', '/api/skins/apply/:steamid', async ({ params, body, user, ip }) => { audit(user, ip, 'skins.apply', { steamid: params.steamid, ops: (body.ops || []).map((o) => o.op) }); return agent('POST', `/skins/apply/${encodeURIComponent(params.steamid)}`, { ops: body.ops }); }],
    ['POST', '/api/skins/reload', async ({ user, ip }) => { audit(user, ip, 'skins.reload'); return agent('POST', '/skins/reload', {}); }],
    ['POST', '/api/practice', async ({ body, user, ip }) => {
      const commands = practice.buildCommands(String(body.action || ''), body);
      audit(user, ip, 'practice', { action: body.action, n: commands.length });
      return agent('POST', '/rcon-batch', { commands }, 30000);
    }],
    ['POST', '/api/practice/read', async () => {
      const names = [...practice.READABLE];
      const { outputs } = await agent('POST', '/rcon-batch', { commands: names }, 30000);
      return { values: Object.fromEntries(names.map((n, i) => [n, practice.parseCvarOutput(n, outputs[i])]).filter(([, v]) => v !== null)) };
    }],
    ['POST', '/api/vm/start', async ({ user, ip }) => startVm(user, ip)],
    ['POST', '/api/vm/stop', async ({ user, ip }) => stopVm(user, ip)],
    ['GET', '/api/state', async () => getState()],
    ['PUT', '/api/state', async ({ body, user, ip }) => { audit(user, ip, 'state.save', Object.keys(body.state || {})); return putState(body); }],
    ['POST', '/api/preset', async ({ body, user, ip }) => { audit(user, ip, 'preset', body.preset); return agent('POST', '/preset', body, 120000); }],
    ['POST', '/api/map', async ({ body, user, ip }) => { audit(user, ip, 'map', body.map); return agent('POST', '/map', body); }],
    ['POST', '/api/rcon', async ({ body, user, ip }) => { audit(user, ip, 'rcon', String(body.command || '').slice(0, 120)); return agent('POST', '/rcon', body); }],
    ['POST', '/api/apply-live', async ({ user, ip }) => { audit(user, ip, 'apply-live'); return agent('POST', '/apply-live', {}, 40000); }],
    ['POST', '/api/service/:action', async ({ params, user, ip }) => { audit(user, ip, `service.${params.action}`); return agent('POST', `/service/${encodeURIComponent(params.action)}`, {}, 320000); }],
    ['POST', '/api/cleanup', async ({ body, user, ip }) => { audit(user, ip, 'cleanup', body.actions); return agent('POST', '/cleanup', { actions: body.actions }, 60000); }],
    ['POST', '/api/update', async ({ user, ip }) => { audit(user, ip, 'update'); return agent('POST', '/update', {}); }],
    ['POST', '/api/backup', async ({ user, ip }) => { audit(user, ip, 'backup'); return agent('POST', '/backup', {}); }],
    ['GET', '/api/backups', async () => agent('GET', '/backups')],
    ['POST', '/api/restore', async ({ body, user, ip }) => { audit(user, ip, 'restore', body.key); return agent('POST', '/restore', body); }],
    ['GET', '/api/logs', async ({ query }) => agent('GET', `/logs?unit=${encodeURIComponent(query.unit || 'cs2')}&n=${encodeURIComponent(query.n || '200')}`, null, 20000)],
    ['GET', '/api/jobs/:id', async ({ params }) => agent('GET', `/jobs/${encodeURIComponent(params.id)}`)],
    ['GET', '/api/settings', async () => loadSettings()],
    ['PUT', '/api/settings', async ({ body, user, ip }) => {
      const cur = loadSettings();
      const next = { ...cur };
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (body[k] === undefined) continue;
        const n = Number(body[k]);
        if (!Number.isInteger(n) || n < 0 || n > 1440) throw Object.assign(new Error(`${k}: integer 0-1440`), { status: 400 });
        next[k] = n;
      }
      if (body.playerLogin !== undefined) next.playerLogin = !!body.playerLogin;
      writeJsonAtomic(settingsFile, next);
      audit(user, ip, 'settings', next);
      return { ...next, playerLogin: next.playerLogin !== false };
    }],
    ['PUT', '/api/brand', async ({ body, user, ip }) => {
      const b = readJson(brandFile, {});
      if (body.name !== undefined) { const n = String(body.name).trim(); if (!n || n.length > 40 || /[<>]/.test(n)) throw Object.assign(new Error('brand: name 1–40 chars, no < >'), { status: 400 }); b.name = n; }
      if (body.tagline !== undefined) { const t = String(body.tagline).trim(); if (t.length > 80 || /[<>]/.test(t)) throw Object.assign(new Error('brand: tagline up to 80 chars, no < >'), { status: 400 }); b.tagline = t; }
      if (body.removeLogo) { b.logoType = ''; try { fs.unlinkSync(brandLogoFile); } catch { /* нет файла */ } b.v = (b.v || 0) + 1; }
      writeJsonAtomic(brandFile, b); audit(user, ip, 'brand', { name: b.name }); const o = loadBrand(); return { name: o.name, tagline: o.tagline, logo: o.logoType ? `/brand-logo?v=${o.v}` : '' };
    }],
    ['POST', '/api/brand/logo', async ({ body, user, ip }) => {
      const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
      if (!m) throw Object.assign(new Error('brand: PNG, JPEG, WebP or SVG (data URL)'), { status: 400 });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 300 * 1024) throw Object.assign(new Error('brand: logo up to 300 KB'), { status: 400 });
      fs.mkdirSync(path.dirname(brandLogoFile), { recursive: true }); fs.writeFileSync(brandLogoFile, buf, { mode: 0o600 });
      const b = readJson(brandFile, {}); b.logoType = m[1]; b.v = (b.v || 0) + 1; writeJsonAtomic(brandFile, b); audit(user, ip, 'brand.logo', { type: m[1], bytes: buf.length });
      const o = loadBrand(); return { name: o.name, tagline: o.tagline, logo: `/brand-logo?v=${o.v}` };
    }],
    ['GET', '/api/stats', async () => statsGet('/stats')],
    ['GET', '/api/stats/:steamid', async ({ params }) => {
      if (!/^\d{17}$/.test(params.steamid)) throw Object.assign(new Error('stats: bad SteamID64'), { status: 400 });
      const r = await statsGet(`/stats/${params.steamid}`, params.steamid); return r;
    }],
    ['POST', '/api/stats/reset', async ({ user, ip }) => { audit(user, ip, 'stats.reset'); try { fs.unlinkSync(statsCacheFile); } catch { /* нет кэша */ } return agent('POST', '/stats/reset', {}); }],
    ['GET', '/api/profile', async ({ user }) => profileOf(user)],
    ['PUT', '/api/profile', async ({ body, user, ip }) => {
      const users = loadUsers(); const u = users[user]; if (!u) throw Object.assign(new Error('not found'), { status: 404 });
      if (body.email !== undefined) u.email = account.validateEmail(body.email);
      if (body.links !== undefined) u.links = account.validateLinks(body.links);
      saveUsers(users); audit(user, ip, 'profile.save', { email: !!u.email, links: (u.links || []).length });
      return profileOf(user);
    }],
    ['POST', '/api/profile/steam-link', async ({ user }) => {
      for (const [k, v] of linkTokens) if (v.exp < now()) linkTokens.delete(k);
      const token = crypto.randomBytes(18).toString('hex'); linkTokens.set(token, { user, exp: now() + 10 * 60_000 });
      return { url: `/api/auth/steam?link=${token}` };
    }],
    ['POST', '/api/profile/steam-unlink', async ({ user, ip }) => {
      const users = loadUsers(); if (users[user]) { delete users[user].steamid; delete users[user].persona; delete users[user].avatar; saveUsers(users); }
      audit(user, ip, 'steam.unlink'); return profileOf(user);
    }],
    ['PUT', '/api/faceit-key', async ({ body, user, ip }) => {
      const key = String(body.key || '').trim();
      if (key && !/^[A-Za-z0-9-]{16,80}$/.test(key)) throw Object.assign(new Error('faceit: bad API key format'), { status: 400 });
      writeJsonAtomic(faceitFile, key ? { key } : {}, 0o600); faceitCache.clear(); audit(user, ip, 'faceit.key', key ? 'set' : 'cleared');
      return { hasKey: !!key };
    }],
    ['GET', '/api/faceit/:steamid', async ({ params }) => faceitFor(params.steamid)],
    // ---- пользователи панели: список и карточка (админам — все, игроку — только своя) ----
    ['GET', '/api/users', async ({ query, user }) => {
      if (roleOf(user) !== 'admin') throw Object.assign(new Error('forbidden'), { status: 403 });
      const us = usersWithSlugs(); const ig = inGameAdminIds();
      return people.listUsers(Object.entries(us).map(([n, u]) => people.publicUser(n, u, { inGameAdmin: ig.has(String(u.steamid)) })), query);
    }],
    ['GET', '/api/people', async () => {
      const us = usersWithSlugs();
      return { users: Object.entries(us).map(([n, u]) => { const c = people.publicUser(n, u); return { slug: c.slug, displayName: c.displayName, avatar: c.avatar }; }).sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, 500) };
    }],
    ['GET', '/api/users/:slug', async ({ params, user, query }) => {
      if (!people.SLUG_RE.test(params.slug)) throw Object.assign(new Error('users: bad slug'), { status: 400 });
      const us = usersWithSlugs(); const hit = people.findBySlug(us, params.slug);
      if (!hit) throw Object.assign(new Error('user not found'), { status: 404 });
      const [name, u] = hit; const me = roleOf(user) === 'admin' || name === user;
      if (!me) throw Object.assign(new Error('forbidden'), { status: 403 });
      if (u.steamid && !u.avatar && now() - (u.personaAt || 0) > 6 * 3600_000) { u.personaAt = now(); try { await refreshPersona(us, name, u.steamid); } catch { /* Steam недоступен */ } saveUsers(us); }
      const card = people.publicUser(name, u, { full: true, inGameAdmin: inGameAdminIds().has(String(u.steamid)) });
      const out = { ...card, faceit: null, faceitError: '', stats: null, setups: loadSetups().filter((x) => x.owner === name && people.canView(x, { user, slug: (us[user] || {}).slug, role: roleOf(user) })).map((x) => people.summary(x, card.slug)) };
      if (card.steamid && query.faceit !== '0') { try { out.faceit = await faceitFor(card.steamid); } catch (e) { out.faceitError = e.message; } }
      if (card.steamid && query.stats !== '0') { try { const r = await statsGet(`/stats/${card.steamid}`, card.steamid); out.stats = (r.players || [])[0] || null; } catch { /* сервер выключен и кэша нет */ } }
      return out;
    }],
    // ---- сетапы: cfg, параметры запуска, мышь/DPI, видео ----
    ['GET', '/api/setups', async ({ query, user }) => {
      const us = usersWithSlugs(); const role = roleOf(user); const mySlug = (us[user] || {}).slug;
      const scope = ['mine', 'shared', 'all'].includes(query.scope) ? query.scope : 'all';
      const owner = query.owner && people.SLUG_RE.test(query.owner) ? query.owner : '';
      const kind = people.KINDS.includes(query.kind) ? query.kind : '';
      const text = String(query.q || '').slice(0, 40).toLowerCase().trim();
      const slugOf = (n) => (us[n] || {}).slug || '';
      let items = loadSetups().filter((x) => people.canView(x, { user, slug: mySlug, role }) && (scope === 'all' || (scope === 'mine') === (x.owner === user)) && (!owner || slugOf(x.owner) === owner) && (!kind || x.kind === kind) && (!text || x.title.toLowerCase().includes(text)));
      items = items.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30)); const page = Math.max(1, parseInt(query.page, 10) || 1);
      return { total: items.length, page, limit, scope, owner, kind, q: text, items: items.slice((page - 1) * limit, page * limit).map((x) => { const o = us[x.owner]; const c = o ? people.publicUser(x.owner, o) : null; return people.summary(x, c ? { slug: c.slug, displayName: c.displayName, avatar: c.avatar } : null); }) };
    }],
    ['GET', '/api/setups/:ref', async ({ params, user }) => {
      const id = people.parseSetupRef(params.ref); const us = usersWithSlugs(); const x = loadSetups().find((i) => i.id === id);
      // чужой приватный сетап неотличим от несуществующего
      if (!x || !people.canView(x, { user, slug: (us[user] || {}).slug, role: roleOf(user) })) throw Object.assign(new Error('setup not found'), { status: 404 });
      const o = us[x.owner]; const c = o ? people.publicUser(x.owner, o) : null;
      return { ...x, ref: people.setupSlug(x), owner: c ? { slug: c.slug, displayName: c.displayName, avatar: c.avatar } : null, mine: x.owner === user, derived: people.derive(x) };
    }],
    ['POST', '/api/setups', async ({ body, user, ip }) => {
      const us = usersWithSlugs(); const items = loadSetups();
      if (items.filter((x) => x.owner === user).length >= people.MAX_SETUPS_PER_USER) throw Object.assign(new Error(`setups: не больше ${people.MAX_SETUPS_PER_USER} на пользователя`), { status: 409 });
      const v = people.validateSetup(body, { slugs: new Set(Object.values(us).map((u) => u.slug)) });
      let id; do { id = people.newId(); } while (items.some((x) => x.id === id));
      const x = { id, owner: user, ...v, created: new Date(now()).toISOString(), updated: new Date(now()).toISOString() };
      items.push(x); saveSetups(items); audit(user, ip, 'setup.create', { id, files: v.files.length }); return { ...x, ref: people.setupSlug(x), mine: true, derived: people.derive(x) };
    }],
    ['PUT', '/api/setups/:ref', async ({ params, body, user, ip }) => {
      const id = people.parseSetupRef(params.ref); const us = usersWithSlugs(); const items = loadSetups(); const i = items.findIndex((x) => x.id === id);
      if (i < 0 || !people.canView(items[i], { user, slug: (us[user] || {}).slug, role: roleOf(user) })) throw Object.assign(new Error('setup not found'), { status: 404 });
      if (!people.canEdit(items[i], { user })) throw Object.assign(new Error('forbidden: только владелец может менять сетап'), { status: 403 });
      const v = people.validateSetup(body, { slugs: new Set(Object.values(us).map((u) => u.slug)) });
      items[i] = { ...items[i], ...v, updated: new Date(now()).toISOString() }; saveSetups(items); audit(user, ip, 'setup.update', { id });
      return { ...items[i], ref: people.setupSlug(items[i]), mine: true, derived: people.derive(items[i]) };
    }],
    ['DELETE', '/api/setups/:ref', async ({ params, user, ip }) => {
      const id = people.parseSetupRef(params.ref); const us = usersWithSlugs(); const items = loadSetups(); const i = items.findIndex((x) => x.id === id);
      if (i < 0 || !people.canView(items[i], { user, slug: (us[user] || {}).slug, role: roleOf(user) })) throw Object.assign(new Error('setup not found'), { status: 404 });
      if (items[i].owner !== user && roleOf(user) !== 'admin') throw Object.assign(new Error('forbidden'), { status: 403 });
      const [gone] = items.splice(i, 1); saveSetups(items); audit(user, ip, 'setup.delete', { id: gone.id, owner: gone.owner }); return { ok: true };
    }],
    ['POST', '/api/setups/:ref/copy', async ({ params, user, ip }) => {
      const id = people.parseSetupRef(params.ref); const us = usersWithSlugs(); const items = loadSetups(); const src = items.find((x) => x.id === id);
      if (!src || !people.canView(src, { user, slug: (us[user] || {}).slug, role: roleOf(user) })) throw Object.assign(new Error('setup not found'), { status: 404 });
      if (items.filter((x) => x.owner === user).length >= people.MAX_SETUPS_PER_USER) throw Object.assign(new Error(`setups: не больше ${people.MAX_SETUPS_PER_USER} на пользователя`), { status: 409 });
      let nid; do { nid = people.newId(); } while (items.some((x) => x.id === nid));
      const o = us[src.owner]; const from = o ? (o.persona || src.owner) : src.owner;
      const x = { ...JSON.parse(JSON.stringify(src)), id: nid, owner: user, visibility: 'private', sharedWith: [], title: `${src.title} (от ${from})`.slice(0, 60), created: new Date(now()).toISOString(), updated: new Date(now()).toISOString() };
      items.push(x); saveSetups(items); audit(user, ip, 'setup.copy', { from: id, id: nid }); return { ...x, ref: people.setupSlug(x), mine: true, derived: people.derive(x) };
    }],
    ['POST', '/api/link-account', async ({ body, user, ip }) => {
      // Игрок вошёл через Steam, но у него есть админ-аккаунт панели: подтверждаем паролем и объединяем (Steam → этот аккаунт).
      const users = loadUsers(); const me = users[user];
      if (!me || me.role !== 'player' || !me.steamid) throw Object.assign(new Error('only for a Steam player session'), { status: 400 });
      if (keysBlocked(ip)) throw Object.assign(new Error('too many attempts'), { status: 429 });
      const target = String(body.user || ''); const t = users[target];
      if (!t || t.role === 'player' || !t.hash || !verifyPassword(String(body.password || ''), t.hash)) { limiter.fail(`ip:${ip}`); audit(user, ip, 'link-account.fail', target.slice(0, 32)); throw Object.assign(new Error('wrong account or password'), { status: 403 }); }
      if (t.steamid) throw Object.assign(new Error('this account is already linked to a Steam ID'), { status: 409 });
      t.steamid = me.steamid; if (me.persona) { t.persona = me.persona; t.avatar = me.avatar || ''; }
      delete users[user]; saveUsers(users); sessions.destroyUser(user); audit(target, ip, 'steam.link-account', me.steamid);
      return { ok: true, user: target };
    }],
    ['POST', '/api/password', async ({ body, user, ip, sid }) => {
      const users = readJson(usersFile, { users: {} });
      const u = users.users[user];
      // Вошли через Steam и аккаунт привязан к этому Steam — личность уже подтверждена, старый пароль не нужен (на случай, если забыт).
      const viaSteam = (sessions.get(sid) || {}).via === 'steam' && u && u.steamid;
      if (!u || (!viaSteam && !verifyPassword(String(body.oldPassword || ''), u.hash || ''))) throw Object.assign(new Error('wrong current password'), { status: 403 });
      const np = String(body.newPassword || '');
      if (np.length < 10) throw Object.assign(new Error('new password: at least 10 characters'), { status: 400 });
      u.hash = hashPassword(np);
      writeJsonAtomic(usersFile, users, 0o600);
      sessions.destroyUser(user, sid);
      audit(user, ip, 'password.change');
      return { ok: true };
    }],
    ['GET', '/api/audit', async ({ query }) => {
      let lines = [];
      try { lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean); } catch { /* none yet */ }
      const n = Math.min(parseInt(query.n || '100', 10) || 100, 500);
      return { entries: lines.slice(-n).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
    }],
  ];

  const staticCache = new Map();
  function staticFile(name) {
    if (staticCache.has(name)) return staticCache.get(name);
    const file = path.join(PUBLIC_DIR, name);
    let v = null;
    if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) v = { body: fs.readFileSync(file), type: MIME[path.extname(file)] || 'application/octet-stream' };
    staticCache.set(name, v);
    return v;
  }

  const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://community.akamai.steamstatic.com https://cdn.steamstatic.com https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com https://raw.githubusercontent.com; frame-ancestors 'none'",
  };

  function clientIp(req) {
    const remote = req.socket.remoteAddress || '';
    const xff = String(req.headers['x-forwarded-for'] || '');
    if ((remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') && xff) return xff.split(',').pop().trim();
    return remote;
  }

  const server = http.createServer(async (req, res) => {
    const ip = clientIp(req);
    const url = new URL(req.url, 'http://x');
    const secure = String(req.headers['x-forwarded-proto'] || '') === 'https';
    try {
      if (url.pathname === '/brand-logo' && req.method === 'GET') {
        const b = loadBrand(); if (!b.logoType || !fs.existsSync(brandLogoFile)) return send(res, 404, 'not found', SEC_HEADERS);
        return send(res, 200, fs.readFileSync(brandLogoFile), { ...SEC_HEADERS, 'Content-Type': b.logoType, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'public, max-age=3600' });
      }
      if (!url.pathname.startsWith('/api/')) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
        const f = staticFile(name);
        if (!f) return send(res, 404, 'not found', SEC_HEADERS);
        return send(res, 200, f.body, { ...SEC_HEADERS, 'Content-Type': f.type, ...(/^image\//.test(f.type) ? { 'Cache-Control': 'public, max-age=86400' } : {}) });
      }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const name = String(body.username || '').slice(0, 64);
        const keys = [`ip:${ip}`, `user:${name}`];
        if (keys.some((k) => limiter.blocked(k))) return send(res, 429, { error: 'too many attempts, try later' }, SEC_HEADERS);
        const u = loadUsers()[name];
        const ok = u ? verifyPassword(String(body.password || ''), u.hash) : (verifyPassword('x', 'scrypt$16384$00$00'), false);
        if (!ok) { keys.forEach((k) => limiter.fail(k)); audit(name, ip, 'login.fail'); await sleep(400); return send(res, 401, { error: 'invalid credentials' }, SEC_HEADERS); }
        keys.forEach((k) => limiter.reset(k));
        const sid = sessions.create(name); touchLogin(name);
        audit(name, ip, 'login.ok');
        return send(res, 200, { user: name }, { ...SEC_HEADERS, 'Set-Cookie': `cs2sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${secure ? '; Secure' : ''}` });
      }
      if (url.pathname === '/api/brand' && req.method === 'GET') { const b = loadBrand(); return send(res, 200, { name: b.name, tagline: b.tagline, logo: b.logoType ? `/brand-logo?v=${b.v}` : '' }, SEC_HEADERS); }
      if (url.pathname === '/api/auth/steam' && req.method === 'GET') {
        const link = url.searchParams.get('link');
        if (link && !(linkTokens.get(link) && linkTokens.get(link).exp > now())) return send(res, 302, '', { ...SEC_HEADERS, Location: '/?steam=expired' });
        const origin = originOf(req, secure);
        return send(res, 302, '', { ...SEC_HEADERS, Location: account.steamAuthUrl(`${origin}/api/auth/steam/callback${link ? `?link=${link}` : ''}`, origin) });
      }
      if (url.pathname === '/api/auth/steam/callback' && req.method === 'GET') {
        const link = url.searchParams.get('link');
        const origin = originOf(req, secure);
        const q = Object.fromEntries(url.searchParams);
        if (keysBlocked(ip)) return send(res, 302, '', { ...SEC_HEADERS, Location: '/?steam=error' });
        try {
          const steamid = await account.verifySteamAssertion(q, `${origin}/api/auth/steam/callback${link ? `?link=${link}` : ''}`, httpPost, steamNonces, now());
          const users = loadUsers();
          if (link) {
            const t = linkTokens.get(link); linkTokens.delete(link);
            if (!t || t.exp < now() || !users[t.user]) return send(res, 302, '', { ...SEC_HEADERS, Location: '/?steam=expired' });
            const other = Object.keys(users).find((n) => users[n].steamid === steamid && n !== t.user);
            if (other) return send(res, 302, '', { ...SEC_HEADERS, Location: '/?steam=taken' });
            users[t.user].steamid = steamid; saveUsers(users); audit(t.user, ip, 'steam.link', steamid); await refreshPersona(users, t.user, steamid);
            return send(res, 302, '', { ...SEC_HEADERS, Location: '/?steam=linked' });
          }
          let name2 = Object.keys(users).find((n) => users[n].steamid === steamid);
          let persona = null;
          if (!name2) { const pr = await account.steamProfile(steamid, httpGet); persona = pr && pr.name; const t = autoLinkTarget(users, steamid, persona); if (t) { users[t].steamid = steamid; saveUsers(users); name2 = t; audit(t, ip, 'steam.autolink', steamid); } }
          if (!name2) {
            const players = Object.keys(users).filter((n) => users[n].role === 'player').length;
            if (!playerLoginOn() || players >= MAX_PLAYER_ACCOUNTS) { limiter.fail(`ip:${ip}`); audit(steamid, ip, 'login.steam.unlinked'); return send(res, 302, '', { ...SEC_HEADERS, Location: '/?steam=unlinked' }); }
            name2 = `p${steamid}`; users[name2] = { role: 'player', steamid, created: new Date(now()).toISOString() }; saveUsers(users); audit(name2, ip, 'player.register', steamid);
          }
          await refreshPersona(users, name2, steamid);
          const sid2 = sessions.create(name2, { via: 'steam' }); touchLogin(name2); audit(name2, ip, 'login.steam');
          return send(res, 302, '', { ...SEC_HEADERS, Location: '/', 'Set-Cookie': `cs2sid=${sid2}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${secure ? '; Secure' : ''}` });
        } catch (e) { limiter.fail(`ip:${ip}`); log('steam login:', e.message); return send(res, 302, '', { ...SEC_HEADERS, Location: '/?steam=error' }); }
      }
      const sid = parseCookies(req.headers.cookie).cs2sid;
      const session = sid && sessions.get(sid);
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        if (sid) sessions.destroy(sid);
        return send(res, 200, { ok: true }, { ...SEC_HEADERS, 'Set-Cookie': 'cs2sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (!session) return send(res, 401, { error: 'not logged in' }, SEC_HEADERS);
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'cs2panel') return send(res, 403, { error: 'missing CSRF header' }, SEC_HEADERS);
      const m = matchRoute(routes, req.method, url.pathname);
      if (!m) return send(res, 404, { error: 'not found' }, SEC_HEADERS);
      const body = req.method === 'GET' ? {} : await readJsonBody(req);
      if (roleOf(session.user) === 'player') {
        const self = (loadUsers()[session.user] || {}).steamid;
        const key = `${req.method} ${m.pattern}`;
        if (!PLAYER_OK.has(key)) return send(res, 403, { error: 'forbidden for players' }, SEC_HEADERS);
        if (SELF_ONLY.has(key) && m.params.steamid !== self) return send(res, 403, { error: 'forbidden for players: own SteamID only' }, SEC_HEADERS);
        if (key === 'GET /api/users/:slug' && m.params.slug !== (loadUsers()[session.user] || {}).slug) return send(res, 403, { error: 'forbidden for players: own card only' }, SEC_HEADERS);
        if (key === 'PUT /api/profile') { delete body.links; }
      }
      const result = await m.handler({ params: m.params, body, query: Object.fromEntries(url.searchParams), user: session.user, ip, sid });
      return send(res, 200, result, SEC_HEADERS);
    } catch (e) {
      if (!e.status || e.status >= 500) log('error', req.method, url.pathname, e.message);
      return send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message }, SEC_HEADERS);
    }
  });

  let timer = null;
  return {
    server, sessions, limiter, vmState, idleTick, stateSyncTick, getState, putState, overview, startVm, stopVm,
    listen(port = Number(config.publicPort || 8080), host = '127.0.0.1') {
      return new Promise((resolve) => server.listen(port, host, () => {
        timer = setInterval(() => { idleTick().catch((e) => log('idle tick:', e.message)); stateSyncTick().catch((e) => log('state sync:', e.message)); sessions.sweep(); }, 60_000);
        timer.unref();
        resolve();
      }));
    },
    close() { clearInterval(timer); server.close(); },
  };
}

module.exports = { createApp, DEFAULT_SETTINGS };

if (require.main === module) {
  const app = createApp();
  app.listen().then(() => log('admin panel listening on 127.0.0.1:' + (readJson(path.join(ETC, 'config.json'), {}).publicPort || 8080)));
}
