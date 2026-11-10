'use strict';
// Management agent on the CS2 VM. HTTP JSON API on the private network, Bearer-token protected.
// The admin panel (separate VM) is its only client.
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { execFile } = require('node:child_process');
const E = require('./env');
const S = require('../lib/state');
const { PRESETS } = require('../lib/presets');
const { rcon, parseStatus } = require('../lib/rcon');
const { readBody, readRaw, readJsonBody, send, matchRoute } = require('../lib/http');
const soundFiles = require('../lib/soundfiles');
const { readJson, writeJsonAtomic, safeEqual, makeLogger, sleep, randomToken } = require('../lib/util');
const { applyState, patchWeaponPaints } = require('./apply');
const backup = require('./backup');
const cleanup = require('./cleanup');
const statsLib = require('./stats');
let tracker = null;
const skins = require('./skins').createSkinsService();
const { parseOnlinePlayers, isSteamId } = require('./skins');

const log = makeLogger('agent');
const music = require('./music').createMusic({
  pak: require('node:path').join(E.dirs.server, 'game/csgo/pak01_dir.vpk'), cacheDir: require('node:path').join(E.dirs.cache, 'music'), toolsDir: require('node:path').join(E.dirs.data, 'tools'),
  exec: (...a) => exec(...a), download: (...a) => require('./install').download(...a), sha256File: (...a) => require('./install').sha256File(...a), log: makeLogger('music'),
});
const secrets = E.loadSecrets();
const config = E.loadConfig();
const TOKEN = secrets.AGENT_TOKEN || process.env.AGENT_TOKEN;
if (!TOKEN) { console.error('AGENT_TOKEN is not set'); process.exit(1); }

const exec = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { maxBuffer: 8 << 20, timeout: 120000, ...opts }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr), code: err && err.code }));
});

const loadState = () => readJson(E.files.state, null) || S.defaultState();
function saveState(state) { writeJsonAtomic(E.files.state, state); }

/** Ask CS2Panel (>= 0.3.0) to press !wp for the player so new skins show up without a reconnect.
 *  The plugin answers to the server console, which RCON does not capture, so success = the player is online and the command is known. Never throws. */
async function refreshSkins(steamid) {
  try {
    const [players, out] = await rconRun(['css_players', `css_refreshskins ${steamid}`], 5000);
    if (!parseOnlinePlayers(players).some((p) => p.steamid === steamid)) return false;
    return !/unknown command|unknown/i.test(String(out || ''));
  } catch { return false; }
}

async function rconRun(commands, timeoutMs) {
  return rcon({ port: 27015, password: secrets.RCON_PASSWORD, commands, timeoutMs });
}

let liveCache = { at: 0, value: null };
async function liveStatus() {
  if (Date.now() - liveCache.at < 2000) return liveCache.value;
  let value = null;
  try {
    const t0 = Date.now();
    value = parseStatus((await rconRun(['status'], 4000))[0]);
    value.rttMs = Date.now() - t0; // задержка RCON-запроса внутри ВМ (показатель «живости» сервера)
    const pings = (value.players || []).filter((x) => !x.bot && Number.isFinite(x.ping)).map((x) => x.ping);
    value.pingAvg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
    value.pingMax = pings.length ? Math.max(...pings) : null;
    // CS2 в спячке/на старте печатает неполный status: добираем из настроек панели, чтобы «Обзор» не показывал пустоту
    const sv = (loadState().server) || {};
    if (!value.map && sv.map) { value.map = sv.map; value.mapGuess = true; }
    if (!value.maxPlayers && sv.maxPlayers) value.maxPlayers = sv.maxPlayers;
  } catch { value = null; }
  liveCache = { at: Date.now(), value };
  return value;
}

async function serviceInfo() {
  const r = await exec('systemctl', ['show', 'cs2.service', '-p', 'ActiveState,SubState,ActiveEnterTimestamp,NRestarts,Result']);
  const o = Object.fromEntries(r.stdout.split('\n').filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
  return { active: o.ActiveState, sub: o.SubState, since: o.ActiveEnterTimestamp, restarts: Number(o.NRestarts || 0), result: o.Result };
}

function gameVersion() {
  try {
    const t = fs.readFileSync(`${E.gamePaths.gameDir}/steam.inf`, 'utf8');
    return (/PatchVersion=(.+)/.exec(t) || [])[1] || null;
  } catch { return null; }
}

function diskInfo() {
  try {
    const s = fs.statfsSync(E.ROOT);
    return { totalGb: Math.round((s.blocks * s.bsize) / 2 ** 30), freeGb: Math.round((s.bavail * s.bsize) / 2 ** 30) };
  } catch { return null; }
}

async function status() {
  const service = await serviceInfo();
  const live = service.active === 'active' ? await liveStatus() : null;
  return {
    now: new Date().toISOString(),
    uptimeSec: Math.round(os.uptime()),
    load: os.loadavg().map((x) => Math.round(x * 100) / 100),
    memory: { totalMb: Math.round(os.totalmem() / 2 ** 20), freeMb: Math.round(os.freemem() / 2 ** 20) },
    service,
    phase: readJson(E.files.phase, null),
    live,
    gameVersion: gameVersion(),
    installed: readJson(E.files.installed, {}),
    disk: diskInfo(),
  };
}

// ---- background jobs -------------------------------------------------------------------------
const jobs = new Map();
function startJob(name, fn) {
  const id = randomToken(6);
  const job = { id, name, status: 'running', startedAt: new Date().toISOString(), output: [] };
  jobs.set(id, job);
  if (jobs.size > 30) jobs.delete(jobs.keys().next().value);
  const note = (m) => { job.output.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (job.output.length > 200) job.output.shift(); };
  Promise.resolve().then(() => fn(note)).then((r) => { job.status = 'done'; job.result = r; note('done'); })
    .catch((e) => { job.status = 'failed'; job.error = e.message; note(`failed: ${e.message}`); });
  return job;
}

async function systemctl(action) {
  if (!['start', 'stop', 'restart'].includes(action)) throw Object.assign(new Error('bad action'), { status: 400 });
  const r = await exec('systemctl', [action, 'cs2.service'], { timeout: 300000 });
  liveCache = { at: 0, value: null };
  if (!r.ok) throw new Error(`systemctl ${action} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return { ok: true };
}

function setPresetOnState(state, key, map) {
  const p = PRESETS[key];
  if (!p) throw Object.assign(new Error('unknown preset'), { status: 400 });
  state.server.preset = key;
  state.server.gameType = p.gameType;
  state.server.gameMode = p.gameMode;
  state.cvars = { ...p.cvars };
  if (map) state.server.map = map;
  return state;
}

function overrideCommands(state) {
  return Object.entries(state.cvars).map(([k, v]) => `${k} "${v}"`);
}

// Владелец сервера = первый админ из конфигурации Terraform: его нельзя удалить из админов.
const protectedAdmins = () => (config.admins || []).slice(0, 1).map((a) => String(a.steamid));

const sounds = soundFiles.createStore(require('node:path').join(E.dirs.data, 'custom-sounds'));

const RAW_ROUTES = new Set(['PUT /sound-files/:name']);

const routes = [
  ['GET', '/health', async () => ({ ok: true })],
  ['GET', '/status', async () => status()],
  ['GET', '/state', async () => ({ state: loadState(), plugins: S.registry, admin_flags: S.ADMIN_FLAGS, protectedAdmins: protectedAdmins() })],
  ['PUT', '/state', async ({ body }) => {
    const { ok, errors, state } = S.validateState(body.state, loadState(), { protect: protectedAdmins() });
    if (!ok) throw Object.assign(new Error(errors.join('; ')), { status: 400 });
    saveState(state);
    const res = applyState(state, secrets);
    return { state, applied: res, needsRestart: Boolean(body.live === false) || res.changed.some((c) => /^[+-]/.test(c) || c === 'core.json' || c === 'WeaponPaints.json') };
  }],
  ['POST', '/apply-live', async () => {
    const state = loadState();
    applyState(state, secrets);
    const out = await rconRun(overrideCommands(state), 15000);
    return { results: out.map((o, i) => ({ cmd: overrideCommands(state)[i], output: o.trim() })) };
  }],
  ['POST', '/preset', async ({ body }) => {
    const state = setPresetOnState(loadState(), String(body.preset), body.map ? String(body.map) : null);
    const v = S.validateState({ server: state.server, cvars: state.cvars }, loadState());
    if (!v.ok) throw Object.assign(new Error(v.errors.join('; ')), { status: 400 });
    saveState(v.state);
    applyState(v.state, secrets);
    if (body.restart) await systemctl('restart');
    return { state: v.state, restarted: Boolean(body.restart) };
  }],
  ['POST', '/map', async ({ body }) => {
    const map = String(body.map || '');
    const v = S.validateState({ server: { map } }, loadState());
    if (!v.ok) throw Object.assign(new Error(v.errors.join('; ')), { status: 400 });
    saveState(v.state);
    const cmd = /^\d+$/.test(map) ? `host_workshop_map ${map}` : `changelevel ${map}`;
    const out = await rconRun([cmd], 10000);
    return { cmd, output: out[0].trim() };
  }],
  ['POST', '/rcon', async ({ body }) => {
    const cmd = String(body.command || '').trim();
    if (!cmd || cmd.length > 500 || /[\r\n\0]/.test(cmd)) throw Object.assign(new Error('bad command'), { status: 400 });
    return { output: (await rconRun([cmd], 15000))[0] };
  }],
  ['POST', '/rcon-batch', async ({ body }) => {
    const cmds = Array.isArray(body.commands) ? body.commands.map(String) : [];
    if (!cmds.length || cmds.length > 25 || cmds.some((c) => !c.trim() || c.length > 500 || /[\r\n\0]/.test(c))) throw Object.assign(new Error('bad commands'), { status: 400 });
    return { outputs: await rconRun(cmds, 20000) };
  }],
  ['GET', '/skins/players', async () => {
    const out = new Map();
    try { for (const p of parseOnlinePlayers((await rconRun(['css_players'], 4000))[0])) out.set(p.steamid, { steamid: p.steamid, name: p.name, online: true }); } catch { /* server down */ }
    let known = []; try { known = await skins.knownPlayers(); } catch { /* db down */ }
    for (const id of known) out.set(id, { ...(out.get(id) || { steamid: id, name: null, online: false }), hasLoadout: true });
    return { players: [...out.values()] };
  }],
  ['GET', '/skins/loadout/:steamid', async ({ params }) => skins.loadout(params.steamid)],
  ['POST', '/skins/apply/:steamid', async ({ params, body }) => {
    if (!isSteamId(params.steamid)) throw Object.assign(new Error('bad steamid'), { status: 400 });
    const r = await skins.apply(params.steamid, body.ops);
    return { ...r, refreshed: await refreshSkins(params.steamid) };
  }],
  ['POST', '/skins/refresh/:steamid', async ({ params }) => {
    if (!isSteamId(params.steamid)) throw Object.assign(new Error('bad steamid'), { status: 400 });
    return { refreshed: await refreshSkins(params.steamid) };
  }],
  ['POST', '/skins/reload', async () => ({ output: (await rconRun(['css_plugins reload WeaponPaints'], 10000))[0] })],
  ['POST', '/service/:action', async ({ params }) => systemctl(params.action)],
  ['GET', '/stats', async () => (tracker ? tracker.stats.summary() : { since: null, map: null, players: [], maps: [] })],
  ['GET', '/stats/:steamid', async ({ params }) => (tracker ? tracker.stats.summary(String(params.steamid)) : { since: null, map: null, players: [], maps: [] })],
  ['POST', '/stats/reset', async () => { if (tracker) { tracker.stats.data = { since: new Date().toISOString(), players: {}, maps: {} }; tracker.stats.sessions.clear(); tracker.stats.dirty = true; tracker.save(); } return { ok: true }; }],
  ['POST', '/cleanup', async ({ body }) => {
    const ok = ['ram', 'journal', 'files', 'world']; const actions = (Array.isArray(body.actions) ? body.actions : ['files', 'journal', 'ram']).filter((a) => ok.includes(a));
    if (!actions.length) throw Object.assign(new Error('cleanup: no valid actions'), { status: 400 });
    return cleanup.runCleanup(actions, { exec, rcon: (cmds) => rconRun(cmds, 6000), gameDir: E.gamePaths.gameDir });
  }],
  ['POST', '/update', async () => {
    fs.writeFileSync(E.files.forceUpdate, new Date().toISOString());
    systemctl('restart').catch((e) => log('update restart failed:', e.message));
    return { ok: true, note: 'cs2.service is restarting; the update runs in prestart (see /status phase)' };
  }],
  ['POST', '/backup', async () => ({ job: startJob('backup', async () => backup.createBackup({ reason: 'manual' })) })],
  ['GET', '/backups', async () => ({ backups: await backup.listBackups() })],
  ['POST', '/restore', async ({ body }) => ({ job: startJob('restore', async (note) => {
    note('stopping cs2'); await exec('systemctl', ['stop', 'cs2.service'], { timeout: 120000 });
    const r = await backup.restoreBackup({ key: String(body.key || 'latest') });
    note('starting cs2'); await exec('systemctl', ['start', 'cs2.service'], { timeout: 30000 });
    return r;
  }) })],
  ['GET', '/logs', async ({ query }) => {
    const unit = ['cs2', 'cs2-agent', 'cs2-block-metadata', 'mariadb'].includes(query.unit) ? query.unit : 'cs2';
    const n = Math.min(Math.max(parseInt(query.n || '200', 10) || 200, 10), 1000);
    const r = await exec('journalctl', ['-u', `${unit}.service`, '-n', String(n), '--no-pager', '-o', 'short-iso']);
    return { unit, text: r.stdout };
  }],
  ['POST', '/prepare-stop', async ({ body }) => {
    const out = { steps: [] };
    try { await rconRun([`say Server is shutting down in ${body.delaySec || 5}s`], 4000); out.steps.push('announced'); } catch { out.steps.push('rcon unavailable'); }
    await sleep(Math.min((body.delaySec || 5) * 1000, 15000));
    await systemctl('stop'); out.steps.push('cs2 stopped');
    try { out.backup = await backup.createBackup({ reason: 'shutdown' }); out.steps.push('backup uploaded'); } catch (e) { out.steps.push(`backup failed: ${e.message}`); out.backupError = e.message; }
    return out;
  }],
  // Свои аудиофайлы: копия того, что загружено в панель (панель — источник правды, сверяет и досылает сама).
  // музыкальные наборы: звук из файлов игры (первое обращение к набору извлекает его из VPK)
  ['GET', '/music/kit', async ({ query }) => { const r = await music.kit(String(query.id || '')); return { id: r.id, kit: r.kit, tracks: r.tracks.map(({ file, size }) => ({ file, size })) }; }],
  ['GET', '/music/track', async ({ query }) => music.track(String(query.id || ''), query.file)],
  ['GET', '/sound-files', async () => ({ files: sounds.list().map(({ name, size, sha1 }) => ({ name, size, sha1 })) })],
  ['PUT', '/sound-files/:name', async ({ params, raw }) => sounds.put(params.name, raw)],
  ['DELETE', '/sound-files/:name', async ({ params }) => { sounds.remove(params.name); return { ok: true }; }],
  ['GET', '/jobs/:id', async ({ params }) => {
    const j = jobs.get(params.id);
    if (!j) throw Object.assign(new Error('no such job'), { status: 404 });
    return j;
  }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), TOKEN)) return send(res, 401, { error: 'unauthorized' });
    const m = matchRoute(routes, req.method, url.pathname);
    if (!m) return send(res, 404, { error: 'not found' });
    const raw = RAW_ROUTES.has(`${req.method} ${m.pattern}`) ? await readRaw(req, soundFiles.MAX_FILE) : null;
    const body = req.method === 'GET' || raw ? {} : await readJsonBody(req);
    const result = await m.handler({ params: m.params, body, raw, query: Object.fromEntries(url.searchParams) });
    return send(res, 200, result);
  } catch (e) {
    if (!e.status) log('error', req.method, url.pathname, e.stack || e.message);
    return send(res, e.status || 500, { error: e.message });
  }
});

if (require.main === module) {
  tracker = statsLib.startTracker({ file: require('node:path').join(E.dirs.data, 'stats.json'), readJson, writeJsonAtomic, log });
  process.on('SIGTERM', () => { try { tracker.stop(); } catch { /* ok */ } process.exit(0); });
  const port = Number(config.agentPort || 8081);
  server.listen(port, config.agentBind || '0.0.0.0', () => log(`listening on ${config.agentBind || '0.0.0.0'}:${port}`));
  // WeaponPaints writes its default config on the first load. Give it the DB credentials and reload it.
  setInterval(async () => {
    try {
      if (!loadState().plugins.weaponpaints) return;
      if (patchWeaponPaints(secrets) === 'patched') {
        log('WeaponPaints config patched, reloading the plugin');
        await rconRun(['css_plugins reload WeaponPaints'], 8000).catch(() => {});
      }
    } catch (e) { log('weaponpaints watcher:', e.message); }
  }, 20000).unref();
}

module.exports = { server, routes, readBody };
