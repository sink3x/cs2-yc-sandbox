'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../lib/state');
const I = require('../agent/install');

const CATEGORIES = new Set(['match', 'practice', 'mode', 'fun', 'utility', 'skins', 'library']);
const LAYOUTS = new Set(['flat', 'strip']);

test('реестр плагинов: ids уникальны, зависимости существуют, поля корректны', () => {
  const ids = S.registry.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'дубли id');
  for (const p of S.registry) {
    assert.match(p.id, /^[a-z0-9]+$/, p.id);
    assert.ok(p.title && p.desc && Array.isArray(p.dirs) && p.dirs.length, `${p.id}: title/desc/dirs`);
    assert.ok(CATEGORIES.has(p.category), `${p.id}: категория ${p.category}`);
    if (p.layout) assert.ok(LAYOUTS.has(p.layout), `${p.id}: layout`);
    if (p.cmds) assert.ok(p.cmds.every((c) => typeof c === 'string' && c.length < 40), `${p.id}: cmds`);
    for (const n of p.needs || []) assert.ok(ids.includes(n), `${p.id} требует неизвестный ${n}`);
    if (!p.bundled) assert.match(p.repo, /^[\w.-]+\/[\w.-]+$/, `${p.id}: repo`);
    assert.doesNotThrow(() => new RegExp(p.asset), `${p.id}: asset regex`);
  }
});

test('закреплённые плагины: тег, имя файла, sha256, переводы описания на en/de/fr', () => {
  const pinned = S.registry.filter((p) => p.pin);
  assert.ok(pinned.length >= 10, 'ожидали каталог из закреплённых плагинов');
  for (const p of pinned) {
    assert.ok(p.pin.tag && p.pin.asset, `${p.id}: pin.tag/asset`);
    assert.match(p.pin.sha256, /^[0-9a-f]{64}$/, `${p.id}: sha256`);
    assert.ok(new RegExp(p.asset, 'i').test(p.pin.asset), `${p.id}: asset не совпадает с pin.asset`);
    assert.ok(p.license, `${p.id}: лицензия`);
    for (const l of ['en', 'de', 'fr']) {
      const d = p.i18n && p.i18n[l] && p.i18n[l].desc;
      assert.ok(d && d !== p.desc && d.length > 20, `${p.id}: нет перевода описания ${l}`);
    }
    // ссылка собирается детерминированно, без запросов к API GitHub
    const rel = I.pinnedRelease(p);
    assert.equal(rel.tag_name, p.pin.tag);
    assert.equal(rel.assets[0].browser_download_url, `https://github.com/${p.repo}/releases/download/${encodeURIComponent(p.pin.tag)}/${encodeURIComponent(p.pin.asset)}`);
  }
});

test('режимы игры: группа взаимоисключающая, по умолчанию включён максимум один', () => {
  const group = S.registry.filter((p) => p.group === 'mode');
  assert.ok(group.length >= 2);
  const st = S.defaultState();
  assert.ok(group.filter((p) => st.plugins[p.id]).length <= 1);
  const v = S.validateState({ plugins: { retakes: true, deathmatch: true } }, st);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /взаимоисключающие/);
  assert.equal(S.validateState({ plugins: { retakes: true } }, st).ok, true);
  // выключить один режим и включить другой одним запросом — можно
  const a = S.validateState({ plugins: { retakes: true } }, st).state;
  assert.equal(S.validateState({ plugins: { retakes: false, deathmatch: true } }, a).ok, true);
});

test('рекомендованные плагины по умолчанию включены и попадают в установку вместе с зависимостями', () => {
  const st = S.defaultState();
  for (const id of ['thirdperson', 'bhop', 'onlyhs', 'radarcolorfix', 'matchzy']) assert.equal(st.plugins[id], true, id);
  for (const id of ['retakes', 'deathmatch', 'chasemod', 'rolldice', 'afkmanager', 'automaticads', 'customvotes']) assert.equal(st.plugins[id], false, id);
  const need = S.requiredPlugins(st);
  assert.ok(need.includes('thirdperson') && need.includes('menumanager'));
  assert.ok(!need.includes('retakes'));
});

test('раскладка архивов: реальные структуры релизов', () => {
  // обёртка с версией и addons/ внутри
  assert.deepEqual(I.planExtract(['SharpTimer-v1/', 'SharpTimer-v1/addons/counterstrikesharp/plugins/X/X.dll', 'SharpTimer-v1/cfg/a.cfg'], { id: 'x', layout: 'strip' }), { strip: 'SharpTimer-v1', dest: 'game' });
  // обёртка с plugins/configs внутри (ThirdPersonRevamped)
  assert.deepEqual(I.planExtract(['TPR/', 'TPR/Readme.txt', 'TPR/configs/plugins/TPR/c.json', 'TPR/plugins/TPR/TPR.dll'], { id: 'tpr', layout: 'strip' }), { strip: 'TPR', dest: 'css' });
  // DLL в корне архива → своя папка плагина
  assert.deepEqual(I.planExtract(['AFKManager.dll', 'AFKManager.deps.json', 'lang/en.json'], { id: 'afk', layout: 'flat', dirs: ['AFKManager'] }), { strip: '', dest: 'plugin-dir' });
  // addons/ → game/csgo; plugins+gamedata → counterstrikesharp; папка плагина → plugins/
  assert.equal(I.planExtract(['addons/counterstrikesharp/plugins/D/D.dll'], { id: 'd' }).dest, 'game');
  assert.equal(I.planExtract(['gamedata/g.json', 'plugins/ChaseMod/ChaseMod.dll'], { id: 'c' }).dest, 'css');
  assert.equal(I.planExtract(['RollTheDice/RollTheDice.dll', 'RollTheDice/lang/en.json'], { id: 'r' }).dest, 'plugins');
  assert.equal(I.planExtract(['game/csgo/x'], { id: 'g' }).dest, 'server');
  // неверный layout не маскируется
  assert.throws(() => I.planExtract(['a/x', 'b/y'], { id: 's', layout: 'strip' }), /single top-level/);
  assert.throws(() => I.planExtract(['sub/X.dll'], { id: 'f', layout: 'flat' }), /no \.dll/);
});

test('безопасность архива: закреплённые плагины не принимают .., абсолютные и windows-пути', () => {
  for (const bad of ['../evil.dll', 'a/../../evil', '/etc/passwd', 'C:/x.dll', 'plugin\\x.dll']) {
    assert.throws(() => I.planExtract([bad], { id: 'p', pin: {} }), /unsafe path/, bad);
  }
  // прежние (не закреплённые) плагины ставятся как раньше — без новых ограничений
  assert.doesNotThrow(() => I.planExtract(['plugin\\x.dll'], { id: 'old' }));
});

test('sha256File совпадает с эталоном', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sha-')), 'a.bin');
  fs.writeFileSync(f, 'hello');
  assert.equal(await I.sha256File(f), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});
