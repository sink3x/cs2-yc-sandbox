'use strict';
// Свои аудиофайлы: проверка файлов, загрузка в панель, доставка на агента (настоящий агент и настоящий клиент панели), управление.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2snd-'));
process.env.CS2_ROOT = path.join(root, 'cs2');
process.env.CS2_ETC = path.join(root, 'etc');
process.env.AGENT_TOKEN = 'tok';

const test = require('node:test');
const assert = require('node:assert/strict');
const SF = require('../lib/soundfiles');
const { server: agentServer } = require('../agent/agent');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');

const wav = (n = 200) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(n)]);
const ogg = () => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)]);
const mp3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);

test('имена и содержимое: расширение должно совпадать с содержимым', () => {
  assert.equal(SF.normalizeName('Мой Звук.WAV'), 'moy-zvuk.wav'); // кириллица → латиница
  assert.equal(SF.normalizeName('日本.wav'), 'sound.wav'); // нечего транслитерировать → запасное имя
  assert.equal(SF.normalizeName('C:\\x\\Air Horn!!.mp3'), 'air-horn.mp3');
  assert.equal(SF.normalizeName('evil.exe'), null);
  assert.equal(SF.normalizeName('../../etc/passwd.ogg'), 'passwd.ogg');
  SF.checkContent('a.wav', wav()); SF.checkContent('a.ogg', ogg()); SF.checkContent('a.mp3', mp3());
  SF.checkContent('a.mp3', Buffer.from([0xff, 0xfb, 0x90, 0, 0, 0]));
  assert.throws(() => SF.checkContent('a.wav', Buffer.from('MZ\x90\x00 exe exe exe exe exe exe exe exe exe exe exe exe exe exe exe exe')), /does not look/);
  assert.throws(() => SF.checkContent('a.ogg', wav()), /does not look/);
  assert.throws(() => SF.checkContent('a.wav', Buffer.alloc(0)), /empty/);
  assert.throws(() => SF.checkContent('a.wav', Buffer.alloc(SF.MAX_FILE + 1)), /too large/);
});

test('хранилище: запись, замена, переименование, удаление, лимиты, обход пути', () => {
  const st = SF.createStore(path.join(root, 'store'));
  st.put('a.wav', wav()); st.put('b.ogg', ogg());
  assert.deepEqual(st.list().map((x) => x.name), ['a.wav', 'b.ogg']);
  const fp = st.fingerprint();
  assert.throws(() => st.put('a.wav', wav(), { overwrite: false }), /already exists/);
  st.put('a.wav', wav(300)); assert.notEqual(st.fingerprint(), fp);
  st.rename('a.wav', 'c.wav'); assert.deepEqual(st.list().map((x) => x.name), ['b.ogg', 'c.wav']);
  assert.throws(() => st.rename('c.wav', 'c.mp3'), /extension/);
  assert.throws(() => st.rename('c.wav', 'b.ogg'), /extension|exists/);
  for (const bad of ['../x.wav', 'a/b.wav', 'A.wav', 'x.exe', '.wav', '']) assert.throws(() => st.read(bad), /bad file name/, bad);
  st.remove('c.wav'); assert.throws(() => st.remove('c.wav'), /no such file/);
  assert.ok(!fs.readdirSync(st.dir).some((n) => n.includes('.tmp-'))); // временные файлы не остаются
});

test('панель → агент: загрузка, доставка, замена, переименование, удаление, роли и CSRF', async () => {
  await new Promise((r) => agentServer.listen(0, '127.0.0.1', r));
  const agentUrl = `http://127.0.0.1:${agentServer.address().port}`;
  const dir = fs.mkdtempSync(path.join(root, 'admin-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: {
    alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' }, tester: { hash: hashPassword('hunter2hunter2'), role: 'player' },
  } }));
  const app = createApp({
    config: { instanceId: 'i1', agentUrl, publicPort: 0 }, secrets: { AGENT_TOKEN: 'tok' }, compute: {},
    usersFile: path.join(dir, 'users.json'), settingsFile: path.join(dir, 'settings.json'), auditFile: path.join(dir, 'audit.log'),
    faceitFile: path.join(dir, 'faceit.json'), statsCacheFile: path.join(dir, 'stats-cache.json'), brandFile: path.join(dir, 'brand.json'), brandLogoFile: path.join(dir, 'brand-logo.bin'),
    stateCacheFile: path.join(dir, 'state-cache.json'), soundsDir: path.join(dir, 'sound-files'), soundSyncFile: path.join(dir, 'sound-sync.json'),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = async (u) => (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'hunter2hunter2' }) })).headers.get('set-cookie').split(';')[0];
  const adm = await login('alice'); const ply = await login('tester');
  const req = (method, p, { cookie = adm, body, csrf = true, json = true } = {}) => fetch(base + p, { method, headers: { cookie, ...(csrf ? { 'X-Requested-With': 'cs2panel' } : {}), ...(json && body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
  const remote = () => fs.readdirSync(path.join(process.env.CS2_ROOT, 'data/custom-sounds')).sort();
  const settle = async () => { for (let i = 0; i < 50 && app.soundStore && (await (await req('GET', '/api/sound-files')).json()).sync.busy; i++) await new Promise((r) => setTimeout(r, 40)); };
  try {
    // доступ
    assert.equal((await req('POST', '/api/sound-files?name=a.wav', { body: wav(), cookie: ply })).status, 403);
    assert.equal((await req('GET', '/api/sound-files', { cookie: ply })).status, 403);
    assert.equal((await req('POST', '/api/sound-files?name=a.wav', { body: wav(), csrf: false })).status, 403);
    // плохое
    assert.equal((await req('POST', '/api/sound-files?name=a.exe', { body: wav() })).status, 400);
    assert.equal((await req('POST', '/api/sound-files?name=a.wav', { body: Buffer.from('not audio at all, really not audio at all, no') })).status, 400);
    assert.equal((await req('POST', '/api/sound-files?name=a.wav', { body: Buffer.alloc(SF.MAX_FILE + 10, 1) })).status, 413);
    // загрузка + доставка
    const up = await req('POST', '/api/sound-files?name=Air%20Horn.wav', { body: wav() });
    assert.equal(up.status, 200); assert.equal((await up.json()).name, 'air-horn.wav');
    assert.equal((await req('POST', '/api/sound-files?name=air-horn.wav', { body: wav(300) })).status, 409); // без overwrite
    assert.equal((await req('POST', '/api/sound-files?name=air-horn.wav&overwrite=1', { body: wav(300) })).status, 200);
    await req('POST', '/api/sound-files?name=ding.ogg', { body: ogg() });
    await settle();
    let list = await (await req('GET', '/api/sound-files')).json();
    assert.deepEqual(list.files.map((f) => f.name), ['air-horn.wav', 'ding.ogg']);
    assert.equal(list.sync.state, 'synced', JSON.stringify(list.sync));
    assert.deepEqual(remote(), ['air-horn.wav', 'ding.ogg']);
    assert.equal(fs.statSync(path.join(process.env.CS2_ROOT, 'data/custom-sounds/air-horn.wav')).size, wav(300).length); // замена дошла
    // предпросмотр и скачивание
    const pv = await req('GET', '/api/sound-files/ding.ogg');
    assert.equal(pv.headers.get('content-type'), 'audio/ogg'); assert.match(pv.headers.get('content-security-policy'), /sandbox/);
    assert.match(pv.headers.get('content-disposition'), /^inline/);
    assert.equal(Buffer.compare(Buffer.from(await pv.arrayBuffer()), ogg()), 0);
    assert.match((await req('GET', '/api/sound-files/ding.ogg?dl=1')).headers.get('content-disposition'), /^attachment/);
    assert.equal((await req('GET', '/api/sound-files/..%2Fx.wav')).status, 400);
    assert.equal((await req('GET', '/api/sound-files/nope.wav')).status, 404);
    // переименование
    assert.equal((await req('POST', '/api/sound-files/ding.ogg/rename', { body: { to: 'Bell!' } })).status, 200); // расширение добавится само
    await settle();
    assert.deepEqual(remote(), ['air-horn.wav', 'bell.ogg']);
    assert.equal((await req('POST', '/api/sound-files/bell.ogg/rename', { body: { to: 'air-horn.wav' } })).status, 400); // другое расширение
    assert.equal((await req('POST', '/api/sound-files/bell.ogg/rename', { body: { to: 'air-horn.ogg' } })).status, 200);
    await settle(); assert.deepEqual(remote(), ['air-horn.ogg', 'air-horn.wav']);
    // удаление
    assert.equal((await req('DELETE', '/api/sound-files/air-horn.ogg')).status, 200);
    assert.equal((await req('DELETE', '/api/sound-files/air-horn.ogg')).status, 404);
    await settle(); assert.deepEqual(remote(), ['air-horn.wav']);
    // ВМ выключена: изменения копятся, затем доезжают сами
    agentServer.close(); await new Promise((r) => setTimeout(r, 30));
    await req('POST', '/api/sound-files?name=late.mp3', { body: mp3() }); await settle();
    list = await (await req('GET', '/api/sound-files')).json();
    assert.equal(list.sync.state, 'pending'); assert.equal(list.files.length, 2);
    await new Promise((r) => agentServer.listen(Number(new URL(agentUrl).port), '127.0.0.1', r));
    const man = await (await req('POST', '/api/sound-files-sync')).json();
    assert.equal(man.sync.state, 'synced', JSON.stringify(man)); assert.deepEqual(remote(), ['air-horn.wav', 'late.mp3']);
    // файлы, оставшиеся на ВМ без пары в панели, убираются (панель — источник правды)
    fs.writeFileSync(path.join(process.env.CS2_ROOT, 'data/custom-sounds/stray.wav'), wav());
    await req('POST', '/api/sound-files-sync'); assert.deepEqual(remote(), ['air-horn.wav', 'late.mp3']);
  } finally { app.close(); agentServer.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('старый агент без приёма файлов: статус outdated, без ошибок и повторов', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2old-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: { alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' } } }));
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' }, compute: {},
    agent: async () => { throw Object.assign(new Error('not found'), { status: 404 }); },
    usersFile: path.join(dir, 'users.json'), settingsFile: path.join(dir, 'settings.json'), auditFile: path.join(dir, 'audit.log'),
    faceitFile: path.join(dir, 'faceit.json'), statsCacheFile: path.join(dir, 'stats-cache.json'), brandFile: path.join(dir, 'brand.json'), brandLogoFile: path.join(dir, 'brand-logo.bin'),
    soundsDir: path.join(dir, 'sf'), soundSyncFile: path.join(dir, 'sync.json'),
  });
  app.soundStore.put('a.wav', wav());
  const st = await app.syncSounds();
  assert.equal(st.state, 'outdated');
});
