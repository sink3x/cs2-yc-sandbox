'use strict';
// Admin panel backend. Runs on the small always-on VM: logs users in, starts/stops the CS2 VM through
// the Yandex Cloud Compute API (service account of this VM) and proxies a whitelist of calls to the agent.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Sessions, FailureLimiter, verifyPassword, hashPassword, parseCookies } = require('../lib/auth');
const { readBody, readJsonBody, send, matchRoute } = require('../lib/http');
const { readJson, writeJsonAtomic, loadEnvFile, makeLogger, sleep } = require('../lib/util');
const { PRESETS, MAPS, CATALOG } = require('../lib/presets');
const { YandexCompute } = require('../lib/yc');
const { CatalogCache } = require('../lib/catalog');
const practice = require('../lib/practice');

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
const DEFAULT_SETTINGS = { autoStopIdleMinutes: 30, startupGraceMinutes: 20 };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/png', '.png': 'image/png', '.jpg': 'image/jpeg' };

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

  const userPresetsFile = deps.userPresetsFile || path.join(VAR, 'user-presets.json');
  const customSkinsFile = deps.customSkinsFile || path.join(VAR, 'custom-skins.json');
  const catalogCache = deps.catalogCache || new CatalogCache({ file: path.join(VAR, 'skin-catalog.json') });
  const loadUsers = () => (readJson(usersFile, { users: {} }).users) || {};
  const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}) });

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

  async function overview() {
    const out = { vm: null, server: null, busy: vmState.busy, lastError: vmState.lastError, settings: loadSettings(), idleSince: vmState.idleSince ? new Date(vmState.idleSince).toISOString() : null, lastAutoStop: vmState.lastAutoStop };
    try { out.vm = await vmDescribe(); } catch (e) { out.vmError = e.message; return out; }
    if (out.vm.status === 'RUNNING') {
      try { out.server = await agent('GET', '/status', null, 5000); } catch (e) { out.agentError = e.message; }
    }
    out.connect = out.vm.publicIp ? `connect ${out.vm.publicIp}:${config.gamePort || 27015}` : null;
    return out;
  }

  // ---- routes ---------------------------------------------------------------------------------
  const P = (p) => async ({ params, body, query }) => agent('POST', p, body);
  const routes = [
    ['GET', '/api/me', async ({ user }) => ({ user })],
    ['GET', '/api/overview', async () => overview()],
    ['GET', '/api/catalog', async () => ({ presets: PRESETS, maps: MAPS, catalog: CATALOG, toggles: practice.TOGGLES, fun: practice.FUN_PRESETS })],
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
    ['GET', '/api/state', async () => agent('GET', '/state')],
    ['PUT', '/api/state', async ({ body, user, ip }) => { audit(user, ip, 'state.save', Object.keys(body.state || {})); return agent('PUT', '/state', body); }],
    ['POST', '/api/preset', async ({ body, user, ip }) => { audit(user, ip, 'preset', body.preset); return agent('POST', '/preset', body, 120000); }],
    ['POST', '/api/map', async ({ body, user, ip }) => { audit(user, ip, 'map', body.map); return agent('POST', '/map', body); }],
    ['POST', '/api/rcon', async ({ body, user, ip }) => { audit(user, ip, 'rcon', String(body.command || '').slice(0, 120)); return agent('POST', '/rcon', body); }],
    ['POST', '/api/apply-live', async ({ user, ip }) => { audit(user, ip, 'apply-live'); return agent('POST', '/apply-live', {}, 40000); }],
    ['POST', '/api/service/:action', async ({ params, user, ip }) => { audit(user, ip, `service.${params.action}`); return agent('POST', `/service/${encodeURIComponent(params.action)}`, {}, 320000); }],
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
      writeJsonAtomic(settingsFile, next);
      audit(user, ip, 'settings', next);
      return next;
    }],
    ['POST', '/api/password', async ({ body, user, ip, sid }) => {
      const users = readJson(usersFile, { users: {} });
      const u = users.users[user];
      if (!u || !verifyPassword(String(body.oldPassword || ''), u.hash)) throw Object.assign(new Error('wrong current password'), { status: 403 });
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
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://community.akamai.steamstatic.com https://cdn.steamstatic.com https://raw.githubusercontent.com; frame-ancestors 'none'",
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
        const sid = sessions.create(name);
        audit(name, ip, 'login.ok');
        return send(res, 200, { user: name }, { ...SEC_HEADERS, 'Set-Cookie': `cs2sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${secure ? '; Secure' : ''}` });
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
      const result = await m.handler({ params: m.params, body, query: Object.fromEntries(url.searchParams), user: session.user, ip, sid });
      return send(res, 200, result, SEC_HEADERS);
    } catch (e) {
      if (!e.status || e.status >= 500) log('error', req.method, url.pathname, e.message);
      return send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message }, SEC_HEADERS);
    }
  });

  let timer = null;
  return {
    server, sessions, limiter, vmState, idleTick, overview, startVm, stopVm,
    listen(port = Number(config.publicPort || 8080), host = '127.0.0.1') {
      return new Promise((resolve) => server.listen(port, host, () => {
        timer = setInterval(() => { idleTick().catch((e) => log('idle tick:', e.message)); sessions.sweep(); }, 60_000);
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
