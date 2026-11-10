'use strict';
// Demo mode: the real admin panel running on top of an in-memory mock of the game server.
//
//   npm run demo          ->  http://127.0.0.1:8080
//   logins: admin / demo-admin-pass   (full access)      player / demo-player-pass   (player role)
//
// What it is for: look at the panel, click through every page, develop the UI and run end-to-end tests without a cloud
// account, a game server or any secrets. Everything lives in a temp directory that is removed on exit.
// Safety: listens on 127.0.0.1 only, uses throw-away credentials, never talks to Yandex Cloud, Steam or Faceit.
// The only network access is the public skin catalogue (names/images). To stay fully offline point CS2DEMO_CATALOG_DIR at a
// folder with skins.json, agents.json, music_kits.json, base_weapons.json and stickers.json (ByMykel/CSGO-API format).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');
const { CatalogCache, StickerCache } = require('../lib/catalog');
const S = require('../lib/state');
const music = require('../agent/music');

const OWNER = '76561198000000100';
const FRIEND = '76561198000000102';
const LOGINS = { admin: 'demo-admin-pass', player: 'demo-player-pass' };

// 3 seconds of a quiet sine wave: something for the sound player to play and seek in
function demoWav() {
  const sr = 8000, n = sr * 3; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 6) * 3000), 44 + i * 2);
  return b;
}

// deterministic fake heatmap so the statistics page has something to draw
function demoHeat() {
  const o = {}; let r = 7; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let gx = -6; gx < 8; gx++) for (let gy = -5; gy < 7; gy++) {
    if (rnd() < 0.45) continue;
    const base = Math.floor(rnd() * 6);
    o[gx + ',' + gy] = rnd() < 0.5 ? [base + 2, Math.floor(base / 3)] : [Math.floor(base / 3), base + 2];
  }
  return { de_dust2: o };
}

function localCatalog(dir) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
  return (url) => Promise.resolve(read(/([\w]+)\.json$/.exec(url)[1]));
}

function createDemoAgent() {
  const wav = demoWav(); const heat = demoHeat();
  let state = S.defaultState({ hostname: 'demo-cs2', admins: [{ name: 'Alice', steamid: OWNER, flags: ['@css/root'] }] });
  const loadout = { skins: [{ team: 2, def: 7, paint: 282, wear: 0.07, seed: 5, nametag: '', stattrak: 0, stattrakCount: 0 }], knives: [{ team: 2, knife: 'weapon_knife_karambit' }], gloves: [], agents: { ct: null, t: null }, music: [], pins: [] };
  const cvars = { sv_cheats: '0', sv_infinite_ammo: '1', mp_roundtime: '60' };
  const remoteSounds = new Map();
  const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="gold"/></svg>';
  const soundFiles = ['sounds/weapons/ak47/ak47_01.vsnd_c', 'sounds/weapons/ak47/ak47_02.vsnd_c', 'sounds/ui/beep07.vsnd_c', 'sounds/ui/bomb_planted.vsnd_c', 'sounds/player/footsteps/step_01.vsnd_c'];
  const stats = () => [
    { steamid: OWNER, name: 'Alice', kills: 142, deaths: 98, kd: 1.45, headshots: 71, hsPct: 50, damage: 15230, hits: 801, grenades: { he: 12, flash: 30, smoke: 22 }, weapons: { ak47: 70, awp: 40, m4a1_silencer: 32 }, hitgroups: { head: 71, chest: 400, stomach: 80 }, seconds: 14500, online: true, maps: { de_dust2: { seconds: 9000, kills: 90, deaths: 50, damage: 9000 }, de_mirage: { seconds: 5500, kills: 52, deaths: 48, damage: 6230 } } },
    { steamid: FRIEND, name: 'Bob', kills: 60, deaths: 80, kd: 0.75, headshots: 12, hsPct: 20, damage: 6000, hits: 300, grenades: {}, weapons: { glock: 30 }, hitgroups: { chest: 100 }, seconds: 3600, online: false, maps: {} },
  ];
  return async function agent(method, p, body) {
    if (p === '/sound-files') return { files: [...remoteSounds].map(([name, b]) => ({ name, size: b.length, sha1: crypto.createHash('sha1').update(b).digest('hex') })) };
    if (p.startsWith('/sound-files/')) { const n = decodeURIComponent(p.split('/').pop()); if (method === 'PUT') remoteSounds.set(n, body); else remoteSounds.delete(n); return { ok: true }; }
    if (p.startsWith('/sounds/search')) {
      const u = new URL('http://x' + p); const files = music.parseSoundList(soundFiles.join('\n'));
      return { ...music.searchSounds(files, { q: u.searchParams.get('q'), dir: u.searchParams.get('dir'), offset: u.searchParams.get('offset') }), dirs: music.soundDirs(files), all: files.length };
    }
    if (p.startsWith('/sounds/file') || p.startsWith('/music/track')) return { type: 'audio/wav', b64: wav.toString('base64') };
    if (p.startsWith('/music/kit')) return { id: 3, kit: 'demo', tracks: [{ file: 'mainmenu.wav', size: 100 }, { file: 'startround_01.wav', size: 100 }, { file: 'endofmatch.wav', size: 100 }] };
    if (p === '/team-logos') return { codes: ['navi', 'faze', 'vita', 'spirit'] };
    if (p.startsWith('/team-logo')) return { svg: logoSvg };
    if (p === '/status') {
      return { now: new Date().toISOString(), uptimeSec: 100, load: [0.1, 0.1, 0.1], memory: { totalMb: 8000, freeMb: 4000 }, service: { active: 'active', sub: 'running' },
        live: { map: 'de_dust2', humans: 1, bots: 2, maxPlayers: 10, players: [{ id: 2, time: '12:30', ping: 38, state: 'active', addr: '198.51.100.7:27005', name: 'Alice', bot: false }, { id: 5, time: 'BOT', ping: 0, state: 'active', addr: 'BOT', name: 'Bot Rex', bot: true }, { id: 6, time: 'BOT', ping: 0, state: 'active', addr: 'BOT', name: 'Bot Zed', bot: true }] },
        gameVersion: '1.41.9.6', installed: {}, disk: { totalGb: 100, freeGb: 60 } };
    }
    if (p === '/state' && method === 'GET') return { state, plugins: S.registry, admin_flags: S.ADMIN_FLAGS, protectedAdmins: [OWNER] };
    if (p === '/state') {
      const v = S.validateState(body.state, state);
      if (!v.ok) throw Object.assign(new Error(v.errors.join('; ')), { status: 400 });
      state = v.state; return { state, applied: {}, needsRestart: false };
    }
    if (p === '/skins/players') return { players: [{ steamid: OWNER, name: 'Alice', online: true, hasLoadout: true }] };
    if (p.startsWith('/skins/loadout/')) return { available: true, steamid: p.split('/').pop(), ...loadout };
    if (p.startsWith('/skins/apply/')) return { changed: (body.ops || []).length };
    if (p.startsWith('/stats')) {
      const id = p.split('/')[2]; const all = stats();
      return { since: '2026-11-01T00:00:00Z', map: 'de_dust2', players: id ? all.filter((x) => x.steamid === id).map((x) => ({ ...x, cell: 256, heat })) : all, maps: [{ map: 'de_dust2', seconds: 9000, rounds: 120, kills: 90, sessions: 3 }] };
    }
    if (p === '/rcon-batch') return { outputs: body.commands.map((c) => (cvars[c] !== undefined ? `"${c}" = "${cvars[c]}" ( def. "0" )` : '')) };
    if (p === '/rcon' && body.command === 'css_plugins list') return { output: '[#0:LOADED]: "MatchZy" (v0.8.1) by WD-\n[#1:LOADED]: "CS2Panel" (v0.6.0) by sink3x\n[#2:UNLOADED]: "Bhop Command" (v1.1.0) by LeqenddC' };
    if (p === '/rcon') return { output: 'ok ' + body.command };
    return { ok: true };
  };
}

// Canned answers for the few external pages the panel reads (Steam profile, Faceit); nothing real is contacted.
async function demoHttpGet(u) {
  if (/steamcommunity\.com\/profiles/.test(u)) return { status: 200, text: '<profile><steamID><![CDATA[Alice]]></steamID></profile>' };
  if (/players\?game/.test(u)) return { status: 200, json: { player_id: 'p', nickname: 'Alice', country: 'ru', faceit_url: 'https://www.faceit.com/{lang}/players/Alice', games: { cs2: { skill_level: 7, faceit_elo: 1650, region: 'EU' } } } };
  if (/games\/cs2\/stats/.test(u)) return { status: 200, json: { items: Array.from({ length: 24 }, (_x, i) => ({ stats: { Kills: String(10 + ((i * 7) % 16)), Deaths: String(12 + ((i * 5) % 9)), Assists: String(2 + (i % 5)), 'Headshots %': String(35 + ((i * 3) % 20)), Result: String(i % 3 ? 1 : 0), Map: ['de_mirage', 'de_inferno', 'de_nuke'][i % 3], 'Final Score': i % 3 ? '13 / 8' : '9 / 13', ADR: String(60 + ((i * 4) % 35)), 'Triple Kills': String(i % 3), MVPs: '3' } })) } };
  return { status: 200, json: { lifetime: { Matches: '120', 'Win Rate %': '55', 'Average K/D Ratio': '1.12', 'Average Headshots %': '48', 'Current Win Streak': '2', 'Longest Win Streak': '7' } } };
}

/** Starts the demo panel. Returns { app, url, dir, close() }. Pass port 0 for a random free port (used by the tests). */
async function startDemo({ port = Number(process.env.PORT || 8080), dir } = {}) {
  const own = !dir;
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'cs2-demo-'));
  const f = (n) => path.join(dir, n);
  fs.writeFileSync(f('users.json'), JSON.stringify({ users: {
    admin: { hash: hashPassword(LOGINS.admin), role: 'admin', steamid: OWNER, persona: 'Alice' },
    player: { hash: hashPassword(LOGINS.player), role: 'player', steamid: FRIEND, persona: 'Bob' },
  } }));
  const catalogDir = process.env.CS2DEMO_CATALOG_DIR;
  const fetchJson = catalogDir ? localCatalog(catalogDir) : undefined;
  const compute = {
    describe: async () => ({ id: 'demo', name: 'demo-cs2-game', status: 'RUNNING', publicIp: '203.0.113.5', cores: 2, memoryGb: 8, platform: 'standard-v3' }),
    start: async () => {}, stop: async () => {},
  };
  const app = createApp({
    config: { instanceId: 'demo', agentUrl: 'http://127.0.0.1:1' }, secrets: { AGENT_TOKEN: 'demo' }, compute, agent: createDemoAgent(),
    catalogCache: new CatalogCache({ file: f('skin-catalog.json'), ...(fetchJson ? { fetchJson } : {}) }),
    stickerCache: new StickerCache({ file: f('stickers.json'), ...(fetchJson ? { fetchJson } : {}) }),
    workshopMeta: { get: async (ids) => Object.fromEntries(ids.map((id) => [id, { title: 'Workshop map ' + id, img: '', mb: 120, tags: ['demo'], updated: 1 }])) },
    httpGet: demoHttpGet, geoLookup: async () => '',
    usersFile: f('users.json'), settingsFile: f('settings.json'), auditFile: f('audit.log'), setupsFile: f('setups.json'), faceitFile: f('faceit.json'),
    userPresetsFile: f('presets.json'), customSkinsFile: f('custom-skins.json'),
  });
  await app.listen(port, '127.0.0.1');
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { app, url, dir, close() { app.close(); if (own) fs.rmSync(dir, { recursive: true, force: true }); } };
}

if (require.main === module) {
  startDemo().then(({ url, close }) => {
    console.log(`CS2 panel demo is running: ${url}`);
    console.log(`  admin  / ${LOGINS.admin}`);
    console.log(`  player / ${LOGINS.player}`);
    console.log('Mock game server, throw-away data, 127.0.0.1 only. Ctrl+C to stop.');
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { close(); process.exit(0); });
  });
}

module.exports = { startDemo, LOGINS, OWNER, FRIEND };
