'use strict';
// Оформление сервера: названия/логотипы команд, клан-теги и ники; список логотипов из файлов игры.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/state');
const M = require('../agent/music');

test('identity: проверка и файл для плагина', () => {
  const d = S.defaultState();
  const v = S.validateState({ identity: { teams: { ct: { name: 'Natus Vincere', logo: 'NAVI', flag: 'ua' }, t: { name: 'FaZe Clan', logo: 'faze' } }, players: [{ steamid: '76561198000000100', tag: '[NAVI]', name: '' }, { steamid: '76561198000000101' }] } }, d);
  assert.equal(v.ok, true);
  assert.deepEqual(v.state.identity.teams.ct, { name: 'Natus Vincere', logo: 'navi', flag: 'UA' });
  assert.equal(v.state.identity.players.length, 1, 'пустые записи не хранятся');
  const file = JSON.parse(S.renderIdentity(v.state));
  assert.deepEqual(file.players['76561198000000100'], { tag: '[NAVI]', name: '' });
  assert.equal(file.teams.t.name, 'FaZe Clan');
  // то, что могло бы сломать консольную команду, не проходит
  for (const bad of [{ teams: { ct: { name: 'a";quit' } } }, { teams: { t: { logo: 'a b' } } }, { teams: { t: { flag: 'RUS' } } }, { players: [{ steamid: '1', tag: 'x' }] }, { players: [{ steamid: '76561198000000100', tag: 'x'.repeat(17) }] }, { players: [{ steamid: '76561198000000100', name: 'a\nb' }] }]) {
    const r = S.validateState({ identity: bad }, v.state);
    assert.equal(r.ok, false, JSON.stringify(bad)); assert.deepEqual(r.state.identity, v.state.identity, 'прежнее значение сохраняется');
  }
  assert.ok(S.validateState({}, { ...d, identity: undefined }).state.identity.teams.ct, 'старое состояние без identity дополняется');
});

test('логотипы команд: коды из списка файлов VPK', () => {
  assert.deepEqual(M.parseLogoList('x panorama/images/tournaments/teams/navi.vsvg_c\npanorama/images/tournaments/teams/FaZe.vsvg_c y\npanorama/images/other/a.vsvg_c'), ['faze', 'navi']);
});
