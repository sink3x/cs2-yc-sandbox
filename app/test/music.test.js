'use strict';
// Музыкальные наборы: разбор файлов игры, извлечение через Source2Viewer-CLI (подменён), кэш и маршруты панели.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../agent/music');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');

const ITEMS = `"items_game"
{
  "items" { "1" { "name" "weapon_x" } }
  "music_definitions"
  {
    "1" { "name" "valve_csgo_01" "loc_name" "#musickit_valve_csgo_01" }
    "3"
    {
      "name"		"DanielSadowski_01"
      "loc_name"	"#x"
      "image_inventory" "econ/music_kits/danielsadowski_01"
    }
  }
  "other" { "99" { "name" "not_music" } }
}`;

test('parseVpkList: пути находятся в любом формате вывода, без дублей', () => {
  const out = M.parseVpkList('sounds/music/danielsadowski_01/wonround.vsnd_c CRC:1 size:2\n  [x] sounds/music/danielsadowski_01/startround_01.vsnd_c\nsounds/music/danielsadowski_01/wonround.vsnd_c\nsounds/music/valve_csgo_01/mainmenu.vsnd_c\nsounds/ui/beep.vsnd_c\n');
  assert.deepEqual(out, { danielsadowski_01: ['startround_01', 'wonround'], valve_csgo_01: ['mainmenu'] });
});

test('parseMusicDefs: только блок music_definitions, имена в нижнем регистре', () => {
  assert.deepEqual(M.parseMusicDefs(ITEMS), { 1: 'valve_csgo_01', 3: 'danielsadowski_01' });
  assert.deepEqual(M.parseMusicDefs('nothing here'), {});
});

function fakeTool(dir, log) {
  const pak = path.join(dir, 'pak01_dir.vpk'); fs.writeFileSync(pak, 'vpk');
  const exec = async (cmd, args) => {
    log.push([path.basename(cmd), ...args].join(' '));
    if (cmd === 'unzip') { const d = args[args.indexOf('-d') + 1]; fs.writeFileSync(path.join(d, 'Source2Viewer-CLI'), '#!'); return { ok: true, stdout: '', stderr: '' }; }
    const out = args[args.indexOf('--output') + 1]; const filter = args[args.indexOf('--vpk_filepath') + 1];
    if (args.includes('--vpk_list')) return { ok: true, stdout: 'sounds/music/danielsadowski_01/wonround.vsnd_c\nsounds/music/danielsadowski_01/mainmenu.vsnd_c\n', stderr: '' };
    if (filter === 'scripts/items/items_game.txt') { fs.writeFileSync(out, ITEMS); return { ok: true, stdout: 'Dump written', stderr: '' }; } // как настоящая утилита: один файл пишется прямо по пути --output
    if (filter === 'sounds/music/danielsadowski_01/') { const d = path.join(out, 'sounds/music/danielsadowski_01'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'wonround.mp3'), 'ID3won'); fs.writeFileSync(path.join(d, 'mainmenu.mp3'), 'ID3menu'); return { ok: true, stdout: '', stderr: '' }; }
    return { ok: false, stdout: '', stderr: 'boom', code: 1 };
  };
  return { pak, exec };
}

test('агент: утилита ставится один раз с проверкой sha256, набор извлекается один раз, трек отдаётся base64', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-')); const log = []; const { pak, exec } = fakeTool(dir, log);
  let downloads = 0;
  const mk = (sha) => M.createMusic({ pak, cacheDir: path.join(dir, 'cache'), toolsDir: path.join(dir, 'tools'), exec, download: async (_u, dest) => { downloads += 1; fs.writeFileSync(dest, 'zip'); }, sha256File: async () => sha });
  await assert.rejects(() => mk('0'.repeat(64)).kit('3'), /sha256 не совпал/);
  assert.ok(!fs.existsSync(path.join(dir, 'tools', `s2v-${M.TOOL.tag}`, 'Source2Viewer-CLI')), 'подменённую утилиту не ставим');
  const music = mk(M.TOOL.sha256);
  const [a, b] = await Promise.all([music.kit('3'), music.kit('3')]); // одновременные запросы не запускают извлечение дважды
  assert.deepEqual(a.tracks.map((t) => t.file), ['mainmenu.mp3', 'wonround.mp3']);
  assert.deepEqual(b.tracks.map((t) => t.file), a.tracks.map((t) => t.file));
  assert.equal(a.kit, 'danielsadowski_01');
  assert.equal(log.filter((l) => l.includes('--vpk_decompile')).length, 1);
  const n = log.length; await music.kit('3'); assert.equal(log.length, n, 'повторно утилиту не зовём');
  assert.equal(downloads, 2);
  const t = await music.track('3', 'wonround.mp3');
  assert.equal(Buffer.from(t.b64, 'base64').toString(), 'ID3won'); assert.equal(t.type, 'audio/mpeg');
  await assert.rejects(() => music.track('3', '../../etc/passwd'), /bad track name/);
  await assert.rejects(() => music.track('3', 'nope.mp3'), /no such track/);
  await assert.rejects(() => music.kit('1'), /нет звука набора/); // в items_game есть, в VPK нет
  await assert.rejects(() => music.kit('777'), /не найден/);
});

test('панель: список и звук идут через агента один раз, потом из кэша; плохие имена отклоняются; iframe разрешён только для просмотрщика', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicp-')); const f = (n) => path.join(dir, n);
  fs.writeFileSync(f('users.json'), JSON.stringify({ users: { alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' } } }));
  const calls = []; let up = true;
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' }, compute: { describe: async () => ({ status: 'RUNNING' }) },
    agent: async (m, p) => {
      calls.push(p); if (!up) throw new Error('fetch failed');
      if (p.startsWith('/music/kit')) return { id: 3, kit: 'danielsadowski_01', tracks: [{ file: 'wonround.mp3', size: 6 }, { file: '../x.mp3', size: 1 }] };
      if (p.startsWith('/music/track')) return { type: 'audio/mpeg', b64: Buffer.from('ID3won').toString('base64') };
      return { ok: true };
    },
    usersFile: f('users.json'), settingsFile: f('settings.json'), uptimeFile: f('uptime.json'), auditFile: f('audit.log'), faceitFile: f('faceit.json'), wearImagesFile: f('wear.json'), statsCacheFile: f('sc.json'),
    brandFile: f('brand.json'), brandLogoFile: f('bl.bin'), stateCacheFile: f('state.json'), sessionsFile: f('sessions.json'), steamProfilesFile: f('sp.json'), setupsFile: f('setups.json'), userPresetsFile: f('up.json'),
    customSkinsFile: f('cs.json'), soundsDir: f('sounds'), soundSyncFile: f('ss.json'), calloutsCustomFile: f('co.json'), musicDir: f('music'), ipGeoFile: f('geo.json'), geoLookup: async () => null,
    httpGet: async () => ({ status: 404, json: null }), httpPost: async () => '',
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const lg = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'hunter2hunter2' }) });
    const cookie = (lg.headers.get('set-cookie') || '').split(';')[0];
    const get = (p) => fetch(base + p, { headers: { cookie } });
    assert.equal((await fetch(`${base}/api/music-kit?id=3`)).status, 401);
    const k = await (await get('/api/music-kit?id=3')).json();
    assert.deepEqual(k.tracks, [{ file: 'wonround.mp3', size: 6 }]); assert.equal(k.cached, false);
    const a = await get('/api/music-kit/3/wonround.mp3');
    assert.equal(a.status, 200); assert.equal(a.headers.get('content-type'), 'audio/mpeg'); assert.equal(Buffer.from(await a.arrayBuffer()).toString(), 'ID3won');
    up = false; const n = calls.length; // игровая ВМ выключена: всё уже в кэше панели
    assert.equal((await (await get('/api/music-kit?id=3')).json()).cached, true);
    assert.equal((await get('/api/music-kit/3/wonround.mp3')).status, 200);
    assert.equal(calls.length, n);
    assert.equal((await get('/api/music-kit?id=abc')).status, 400);
    assert.equal((await get('/api/music-kit/3/..%2F..%2Fusers.json')).status, 400);
    assert.notEqual((await get('/api/music-kit/3/other.mp3')).status, 200);
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.match(csp, /frame-src https:\/\/3d\.chainskins\.net;/); assert.match(csp, /frame-ancestors 'none'/);
  } finally { app.server.close(); }
});
