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

test('логотипы команд: все извлекаются одним запуском утилиты', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-'));
  const pak = path.join(dir, 'pak01_dir.vpk'); fs.writeFileSync(pak, 'x');
  const toolsDir = path.join(dir, 'tools'); const bin = path.join(toolsDir, `s2v-${M.TOOL.tag}`, M.TOOL.bin);
  fs.mkdirSync(path.dirname(bin), { recursive: true }); fs.writeFileSync(bin, '');
  let extracts = 0;
  const exec = async (_b, args) => {
    if (args.includes('--vpk_list')) return { ok: true, stdout: 'panorama/images/tournaments/teams/navi.vsvg_c\npanorama/images/tournaments/teams/faze.vsvg_c\npanorama/images/tournaments/teams/bad.vsvg_c\n', stderr: '' };
    extracts += 1; const out = path.join(args[args.indexOf('--output') + 1], 'panorama/images/tournaments/teams'); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'navi.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>'); fs.writeFileSync(path.join(out, 'faze.svg'), '<svg></svg>'); fs.writeFileSync(path.join(out, 'bad.svg'), 'not an image');
    return { ok: true, stdout: '', stderr: '' };
  };
  const svc = M.createMusic({ pak, cacheDir: path.join(dir, 'cache'), toolsDir, exec, download: async () => {}, sha256File: async () => M.TOOL.sha256 });
  assert.deepEqual(await svc.teamLogos(), ['bad', 'faze', 'navi']);
  const [a, b] = await Promise.all([svc.teamLogo('navi'), svc.teamLogo('faze')]);
  assert.match(a.svg, /<svg/); assert.match(b.svg, /<svg/); assert.equal(extracts, 1);
  await assert.rejects(svc.teamLogo('bad'), (e) => e.status === 404);
  await assert.rejects(svc.teamLogo('../x'), (e) => e.status === 400);
  assert.equal(extracts, 1);
});
