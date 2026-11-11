'use strict';
// Звуки: валидация библиотеки в состоянии, файл sounds.json для плагина CS2Panel, безопасная команда проигрывания.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../lib/state');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');
const apply = require('../agent/apply');

test('состояние: библиотека звуков валидируется и рендерится для плагина', () => {
  const v = S.validateState({ sounds: [{ id: 'airhorn', title: 'Сирена', play: 'sounds/ui/armsrace_level_up.vsnd' }, { id: 'ding', play: 'buttons/button17.wav' }] });
  assert.ok(v.ok, v.errors.join());
  assert.equal(v.state.sounds[1].title, 'ding'); // без названия — id
  assert.deepEqual(JSON.parse(S.renderSounds(v.state)), { airhorn: { play: 'sounds/ui/armsrace_level_up.vsnd', title: 'Сирена' }, ding: { play: 'buttons/button17.wav', title: 'ding' } });
  for (const bad of [
    [{ id: 'A b', play: 'x.wav' }], [{ id: 'ok', play: 'x; quit' }], [{ id: 'ok', play: 'a b.wav' }], [{ id: 'ok', play: '"x"' }],
    [{ id: 'ok', play: '' }], [{ id: 'dup', play: 'a.wav' }, { id: 'dup', play: 'b.wav' }], [{ id: 'ok', play: 'a.wav', title: 'x"y' }],
  ]) {
    const r = S.validateState({ sounds: bad });
    assert.ok(!r.ok && r.errors.some((e) => e.startsWith('sounds:')), JSON.stringify(bad));
    assert.deepEqual(r.state.sounds, []); // плохой набор целиком не применяется
  }
  assert.ok(!S.validateState({ sounds: Array.from({ length: 101 }, (_x, i) => ({ id: `s${i}`, play: 'a.wav' })) }).ok);
  // старое состояние без поля sounds остаётся рабочим
  const old = S.defaultState(); delete old.sounds;
  assert.deepEqual(S.validateState({}, old).state.sounds, []);
});

test('плагин cs2panel есть в реестре и включён по умолчанию', () => {
  const p = S.registry.find((x) => x.id === 'cs2panel');
  assert.ok(p && p.default && p.repo === 'sink3x/cs2-server-admin-plugin' && new RegExp(p.asset).test('CS2Panel.zip'));
  assert.equal(S.defaultState().plugins.cs2panel, true);
});

test('агент записывает sounds.json рядом с настройками плагина', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snd-'));
  const gp = S.paths(path.join(dir, 'game/csgo')); fs.mkdirSync(gp.css, { recursive: true });
  const st = S.validateState({ sounds: [{ id: 'ding', title: 'Динь', play: 'buttons/button17.wav' }] }).state;
  const r = apply.applyState(st, {}, gp);
  assert.ok(r.changed.includes('sounds.json'));
  assert.equal(JSON.parse(fs.readFileSync(gp.cssSounds, 'utf8')).ding.play, 'buttons/button17.wav');
  assert.ok(!apply.applyState(st, {}, gp).changed.includes('sounds.json')); // повтор — без изменений
});

test('панель: проигрывание звучит только безопасной командой css_playsound', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2admin-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: { alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' } } }));
  const cmds = [];
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' }, compute: {},
    agent: async (m, p, b) => { if (p === '/rcon') cmds.push(b.command); return { output: 'ok' }; },
    usersFile: path.join(dir, 'users.json'), settingsFile: path.join(dir, 'settings.json'), auditFile: path.join(dir, 'audit.log'),
    faceitFile: path.join(dir, 'faceit.json'), statsCacheFile: path.join(dir, 'stats-cache.json'), brandFile: path.join(dir, 'brand.json'), brandLogoFile: path.join(dir, 'brand-logo.bin'),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (body, cookie) => fetch(`${base}/api/sounds/play`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cs2panel', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await call({ sound: 'ding' })).status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'hunter2hunter2' }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    assert.equal((await call({ sound: 'ding', target: '#3' }, cookie)).status, 200);
    assert.equal((await call({ sound: 'buttons/button17.wav' }, cookie)).status, 200);
    assert.deepEqual(cmds, ['css_playsound ding #3', 'css_playsound buttons/button17.wav all']);
    for (const bad of [{ sound: 'x; quit' }, { sound: 'a b' }, { sound: '' }, { sound: 'ding', target: 'all; quit' }, { sound: 'ding', target: 'a b' }]) assert.equal((await call(bad, cookie)).status, 400, JSON.stringify(bad));
    assert.equal(cmds.length, 2);
  } finally { app.server.close(); }
});
