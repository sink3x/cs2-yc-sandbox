'use strict';
// Runs against a temp directory tree: CS2_ROOT must be set before the agent modules are loaded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2root-'));
process.env.CS2_ROOT = root;
process.env.CS2_ETC = path.join(root, 'etc');

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../agent/env');
const S = require('../lib/state');
const { applyState, patchWeaponPaints, writeIfChanged } = require('../agent/apply');
const { patchGameInfo } = require('../agent/install');

const ID = '76561198000000100';
const gp = E.gamePaths;
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

const GAMEINFO = `"GameInfo"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame_LowViolence\tcsgo_lv\n\t\t\tGame\tcsgo\n\t\t\tGame\tcore\n\t\t}\n\t}\n}\n`;

test('patchGameInfo inserts the Metamod search path before "Game csgo" and is idempotent', () => {
  write(path.join(gp.gameDir, 'gameinfo.gi'), GAMEINFO);
  assert.equal(patchGameInfo(), true);
  const txt = fs.readFileSync(path.join(gp.gameDir, 'gameinfo.gi'), 'utf8');
  assert.ok(txt.indexOf('csgo/addons/metamod') < txt.indexOf('Game\tcsgo\n'));
  assert.equal(patchGameInfo(), false);
});

test('applyState renders configs, admins and toggles plugin folders', () => {
  fs.mkdirSync(gp.cssPlugins, { recursive: true });
  fs.mkdirSync(path.join(gp.cssPlugins, 'MatchZy'), { recursive: true });
  fs.mkdirSync(path.join(gp.cssPlugins, 'WeaponPaints'), { recursive: true });
  const st = S.defaultState({ admins: [{ name: 'alice', steamid: ID, flags: ['@css/root'] }] });
  st.plugins.matchzy = false;
  const res = applyState(st, { RCON_PASSWORD: 'rc', DB_PASSWORD: 'db' });
  assert.ok(res.changed.includes('server.cfg') && res.changed.includes('admins.json'));
  assert.ok(res.changed.includes('-matchzy'));
  assert.ok(fs.existsSync(path.join(gp.cssPluginsDisabled, 'MatchZy')));
  assert.ok(!fs.existsSync(path.join(gp.cssPlugins, 'MatchZy')));
  assert.deepEqual(JSON.parse(fs.readFileSync(gp.cssAdmins, 'utf8')).alice.identity, ID);
  assert.match(fs.readFileSync(gp.serverCfg, 'utf8'), /rcon_password "rc"/);
  // second run changes nothing
  assert.deepEqual(applyState(st, { RCON_PASSWORD: 'rc', DB_PASSWORD: 'db' }).changed, []);
  // re-enable
  st.plugins.matchzy = true;
  assert.ok(applyState(st, { RCON_PASSWORD: 'rc' }).changed.includes('+matchzy'));
});

test('patchWeaponPaints waits for the plugin config, then fills DB credentials once', () => {
  assert.equal(patchWeaponPaints({ DB_PASSWORD: 'pw' }), 'missing');
  write(gp.wpConfig, JSON.stringify({ Version: 1, DatabaseHost: 'localhost', DatabaseUser: 'root', Website: 'x' }));
  assert.equal(patchWeaponPaints({ DB_PASSWORD: 'pw' }), 'patched');
  const cfg = JSON.parse(fs.readFileSync(gp.wpConfig, 'utf8'));
  assert.equal(cfg.DatabasePassword, 'pw');
  assert.equal(cfg.Website, 'x');
  assert.equal(patchWeaponPaints({ DB_PASSWORD: 'pw' }), 'unchanged');
});

test('writeIfChanged reports changes only', () => {
  const f = path.join(root, 'x.txt');
  assert.equal(writeIfChanged(f, 'a'), true);
  assert.equal(writeIfChanged(f, 'a'), false);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('patchWeaponPaints reads a config that starts with a // comment (as CounterStrikeSharp writes it)', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-'));
  const file = path.join(dir, 'WeaponPaints.json');
  fs.writeFileSync(file, '// This file is generated\n{\n  "ConfigVersion": 10,\n  "DatabaseHost": "",\n  "DatabasePort": 3306,\n  "DatabaseUser": "",\n  "DatabasePassword": "",\n  "DatabaseName": "",\n  "Website": "example.com/skins" // trailing\n}\n'.replace(' // trailing', ''));
  const { patchWeaponPaints } = require('../agent/apply');
  assert.equal(patchWeaponPaints({ DB_PASSWORD: 'secret123' }, { wpConfig: file }), 'patched');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(cfg.DatabaseUser, 'weaponpaints');
  assert.equal(cfg.DatabasePassword, 'secret123');
  assert.equal(cfg.Website, 'example.com/skins');
  assert.equal(patchWeaponPaints({ DB_PASSWORD: 'secret123' }, { wpConfig: file }), 'unchanged');
});
