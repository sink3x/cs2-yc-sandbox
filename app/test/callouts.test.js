'use strict';
// Callouts: целостность данных, кэш картинок карт, публичная отдача картинки и API для всех ролей.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA, MAP_IDS, CalloutMaps, isWebp, validateCustom } = require('../lib/callouts');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');

const cyr = /[А-Яа-яЁё]/;
const webp = (n = 2000) => { const b = Buffer.alloc(n); b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); return b; };

test('данные: 10 карт, места в пределах схемы, переводы на ru/de/fr без пропусков', () => {
  assert.equal(MAP_IDS.length, 10);
  for (const m of ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_overpass', 'de_train', 'de_vertigo', 'de_cache']) assert.ok(DATA.maps[m], m);
  for (const [id, map] of Object.entries(DATA.maps)) {
    assert.ok(map.name && ['high', 'mid', 'low'].includes(map.conf), id);
    assert.ok(map.places.length >= 15, `${id}: мест мало`);
    const names = new Set();
    for (const [en, x, y, side, near, lvl] of map.places) {
      assert.ok(!names.has(en), `${id}: дубликат ${en}`); names.add(en);
      assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= 1000, `${id}/${en}: вне схемы`);
      assert.ok(['t', 'm', 'ct'].includes(side) && ['a', 'b', 'm'].includes(near) && [-1, 0, 1, 2].includes(lvl), `${id}/${en}`);
      assert.ok(DATA.names[en], `нет перевода: ${en}`);
    }
    assert.ok(names.has('A Site') && names.has('B Site'), `${id}: нет точек A/B`);
  }
  for (const [en, n] of Object.entries(DATA.names)) {
    assert.ok(n.ru && n.de && n.fr, en);
    assert.ok(cyr.test(n.ru) || n.ru === en, `ru «${n.ru}»`);
    assert.ok(!cyr.test(n.de) && !cyr.test(n.fr), `кириллица в de/fr: ${en}`);
  }
});

test('CalloutMaps: скачивает один раз, кэширует на диск, не пускает чужие id и не-картинки', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-'));
  let hits = 0; const urls = [];
  const m = new CalloutMaps({ dir, fetchBuf: async (u) => { hits++; urls.push(u); return webp(); } });
  assert.equal(await m.get('../../etc/passwd'), null);
  assert.equal(await m.get('de_nowhere'), null);
  const [a, b] = await Promise.all([m.get('de_mirage'), m.get('de_mirage')]);
  assert.ok(isWebp(a) && isWebp(b)); assert.equal(hits, 1);
  assert.match(urls[0], /sink3x\/cs2-callouts\/main\/maps\/de_mirage\.webp$/);
  assert.ok(fs.existsSync(path.join(dir, 'de_mirage.webp')));
  // новый экземпляр берёт картинку с диска без сети
  const m2 = new CalloutMaps({ dir, fetchBuf: async () => { throw new Error('offline'); } });
  assert.ok(isWebp(await m2.get('de_mirage')));
  // сеть отдала не картинку — 503, на диск ничего не пишется
  const bad = new CalloutMaps({ dir, fetchBuf: async () => Buffer.from('<html>404</html>'.repeat(200)) });
  await assert.rejects(() => bad.get('de_dust2'), (e) => e.status === 503);
  assert.ok(!fs.existsSync(path.join(dir, 'de_dust2.webp')));
});

test('сервер: /api/callouts доступен игроку, картинка схемы отдаётся без входа с image/webp', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2admin-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: { alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' } } }));
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' }, compute: {}, agent: async () => ({}),
    usersFile: path.join(dir, 'users.json'), settingsFile: path.join(dir, 'settings.json'), auditFile: path.join(dir, 'audit.log'),
    faceitFile: path.join(dir, 'faceit.json'), statsCacheFile: path.join(dir, 'stats-cache.json'), brandFile: path.join(dir, 'brand.json'), brandLogoFile: path.join(dir, 'brand-logo.bin'),
    calloutMaps: new CalloutMaps({ dir: path.join(dir, 'callouts'), fetchBuf: async () => webp() }),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/callouts`)).status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'hunter2hunter2' }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const r = await fetch(`${base}/api/callouts`, { headers: { cookie } });
    assert.equal(r.status, 200); const j = await r.json(); assert.equal(Object.keys(j.maps).length, 10);
    const img = await fetch(`${base}/callouts/de_mirage.webp`);
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/webp');
    assert.ok(isWebp(Buffer.from(await img.arrayBuffer())));
    assert.equal((await fetch(`${base}/callouts/de_nowhere.webp`)).status, 404);
    assert.equal((await fetch(`${base}/callouts/..%2F..%2Fetc%2Fpasswd`)).status, 404);
  } finally { app.server.close(); }
});

test('правки callouts: переименование, перенос и свои места проверяются целиком', () => {
  const ok = validateCustom({ rename: { 'de_mirage|Jungle': ' Моя зелёнка ', 'de_mirage|Shop': '' }, move: { 'de_mirage|Jungle': [100.04, 250] },
    added: { de_mirage: [{ id: 'c1a', name: 'Мой смок', x: 500, y: 400.55, side: 'ct' }, { id: 'c2b', name: 'X', x: 1, y: 2, side: 'bad' }] } });
  assert.ok(ok.ok, ok.errors.join());
  assert.deepEqual(ok.custom.rename, { 'de_mirage|Jungle': 'Моя зелёнка' }); // пустое = сброс, пробелы обрезаны
  assert.deepEqual(ok.custom.move['de_mirage|Jungle'], [100, 250]);
  assert.deepEqual(ok.custom.added.de_mirage.map((a) => a.side), ['ct', 'm']);
  for (const bad of [
    { rename: { 'de_mirage|Nowhere': 'x' } }, { rename: { 'de_nope|Jungle': 'x' } }, { rename: { 'de_mirage|Jungle': 'a'.repeat(41) } }, { rename: { 'de_mirage|Jungle': '<b>' } },
    { move: { 'de_mirage|Jungle': [1001, 5] } }, { move: { 'de_mirage|Jungle': ['1', 5] } }, { added: { de_mirage: [{ id: 'bad id', name: 'x', x: 1, y: 1 }] } },
    { added: { de_mirage: [{ id: 'c1', name: 'x', x: 1, y: 1 }, { id: 'c1', name: 'y', x: 2, y: 2 }] } }, { added: { de_nope: [] } },
    { added: { de_mirage: Array.from({ length: 61 }, (_x, i) => ({ id: `c${i}`, name: 'x', x: 1, y: 1 })) } },
  ]) assert.ok(!validateCustom(bad).ok, JSON.stringify(bad).slice(0, 80));
  assert.deepEqual(validateCustom(null).custom, { rename: {}, move: {}, added: {} });
});

test('сервер: правки callouts сохраняются админом, отдаются в /api/callouts, мусор отклоняется', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2admin-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: { alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' } } }));
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' }, compute: {}, agent: async () => ({}),
    usersFile: path.join(dir, 'users.json'), settingsFile: path.join(dir, 'settings.json'), auditFile: path.join(dir, 'audit.log'), calloutsCustomFile: path.join(dir, 'co.json'),
    faceitFile: path.join(dir, 'faceit.json'), statsCacheFile: path.join(dir, 'stats-cache.json'), brandFile: path.join(dir, 'brand.json'), brandLogoFile: path.join(dir, 'brand-logo.bin'),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'cs2panel' };
  try {
    assert.equal((await fetch(`${base}/api/callouts/custom`, { method: 'PUT', headers: H, body: '{}' })).status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ username: 'alice', password: 'hunter2hunter2' }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const put = (b) => fetch(`${base}/api/callouts/custom`, { method: 'PUT', headers: { ...H, cookie }, body: JSON.stringify(b) });
    assert.equal((await put({ rename: { 'de_mirage|Jungle': 'Зелёнка' }, added: { de_mirage: [{ id: 'c1', name: 'Мой смок', x: 10, y: 20, side: 't' }] } })).status, 200);
    const got = await (await fetch(`${base}/api/callouts`, { headers: { cookie } })).json();
    assert.equal(got.custom.rename['de_mirage|Jungle'], 'Зелёнка'); assert.equal(got.custom.added.de_mirage[0].name, 'Мой смок');
    assert.equal(Object.keys(got.maps).length, 10);
    assert.equal((await put({ rename: { 'de_mirage|Nowhere': 'x' } })).status, 400);
    assert.equal((await (await fetch(`${base}/api/callouts`, { headers: { cookie } })).json()).custom.rename['de_mirage|Jungle'], 'Зелёнка'); // отклонённое не затёрло сохранённое
  } finally { app.server.close(); }
});
