'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/state');
const { PRESETS } = require('../lib/presets');

const ID = '76561198000000100';

test('default state enables the practice preset and expected plugins', () => {
  const st = S.defaultState();
  assert.equal(st.server.preset, 'practice');
  assert.equal(st.plugins.matchzy, true);
  assert.equal(st.plugins.weaponpaints, true);
  assert.ok(!('menumanager' in st.plugins) || st.plugins.menumanager === false);
});

test('validateState rejects cvar injection and bad ids', () => {
  const evil = S.validateState({ cvars: { 'sv_cheats': '1; quit' } });
  assert.equal(evil.ok, false);
  const evil2 = S.validateState({ cvars: { 'x y': '1' } });
  assert.equal(evil2.ok, false);
  const badId = S.validateState({ admins: [{ name: 'a', steamid: '123', flags: ['@css/root'] }] });
  assert.equal(badId.ok, false);
  const badFlag = S.validateState({ admins: [{ name: 'a', steamid: ID, flags: ['@css/nope'] }] });
  assert.equal(badFlag.ok, false);
});

test('validateState accepts a good change and keeps the rest', () => {
  const r = S.validateState({ server: { hostname: 'My srv', maxPlayers: 6 }, cvars: { mp_roundtime: '2' }, admins: [{ name: 'alice', steamid: ID, flags: ['@css/root'] }] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.state.server.maxPlayers, 6);
  assert.equal(r.state.cvars.mp_roundtime, '2');
  assert.equal(r.state.server.map, 'de_dust2');
});

test('dependencies of enabled plugins are pulled in', () => {
  const st = S.defaultState();
  const need = [...S.requiredPlugins(st)];
  for (const dep of ['menumanager', 'playersettings', 'anybase']) {
    assert.ok(need.some((id) => id.startsWith(dep)), `missing dependency ${dep}: ${need}`);
  }
});

test('renderers produce the formats the plugins expect', () => {
  const st = S.defaultState({ admins: [{ name: 'alice', steamid: ID, flags: ['@css/root'] }] });
  assert.deepEqual(JSON.parse(S.renderCssAdmins(st)), { alice: { identity: ID, flags: ['@css/root'] } });
  assert.deepEqual(JSON.parse(S.renderMatchzyAdmins(st)), { [ID]: '' });
  const cfg = S.renderServerCfg(st, { RCON_PASSWORD: 'secret' });
  assert.match(cfg, /rcon_password "secret"/);
  assert.match(cfg, /sv_hibernate_when_empty 0/);
  assert.match(S.renderOverrides(st), /sv_cheats "1"/);
});

test('launchArgs: GSLT, workshop maps, no shell metacharacters needed', () => {
  const st = S.defaultState();
  let a = S.launchArgs(st, { GSLT: 'TOKEN' });
  assert.deepEqual(a.slice(a.indexOf('+map'), a.indexOf('+map') + 2), ['+map', 'de_dust2']);
  assert.ok(a.includes('+sv_setsteamaccount') && a.includes('TOKEN'));
  st.server.map = '3070284539';
  a = S.launchArgs(st, { STEAM_WEB_API_KEY: 'K' });
  assert.ok(a.includes('+host_workshop_map') && a.includes('-authkey'));
  assert.ok(!S.launchArgs(S.defaultState(), {}).includes('+sv_setsteamaccount'));
});

test('every preset passes validation', () => {
  for (const key of Object.keys(PRESETS)) {
    const r = S.validateState({ server: { preset: key, gameType: PRESETS[key].gameType, gameMode: PRESETS[key].gameMode }, cvars: PRESETS[key].cvars });
    assert.equal(r.ok, true, `${key}: ${JSON.stringify(r.errors)}`);
  }
});

test('patchCoreJson drops FollowCS2ServerGuidelines only when WeaponPaints is on', () => {
  const on = S.defaultState();
  const off = S.defaultState(); off.plugins.weaponpaints = false;
  const base = { PublicChatTrigger: ['!'], FollowCS2ServerGuidelines: true };
  assert.equal(S.patchCoreJson(base, on).FollowCS2ServerGuidelines, false);
  assert.equal(S.patchCoreJson(base, off).FollowCS2ServerGuidelines, true);
  assert.ok(S.patchCoreJson(base, on).PublicChatTrigger.includes('!'));
});

test('patchCoreJson: chat triggers ! . / (dot can be turned off, existing triggers kept)', () => {
  const st = S.defaultState();
  const c = S.patchCoreJson({ PublicChatTrigger: ['!'], SilentChatTrigger: ['/'] }, st);
  assert.deepEqual(c.PublicChatTrigger.sort(), ['!', '.']); assert.deepEqual(c.SilentChatTrigger, ['/']);
  const off = S.defaultState(); off.flags.dotChat = false;
  assert.deepEqual(S.patchCoreJson({ PublicChatTrigger: ['!', '.'] }, off).PublicChatTrigger, ['!']);
  const old = S.defaultState(); delete old.flags.dotChat; assert.ok(S.patchCoreJson(null, old).PublicChatTrigger.includes('.'));
});
