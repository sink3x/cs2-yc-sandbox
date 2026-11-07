'use strict';
// Профили Steam (ник + аватар) для произвольных SteamID64: проверка ввода, кэш, доступ игрокам.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');

const AV = 'https://avatars.fastly.steamstatic.com/e52d41c663400f819d7af387c4e77adb25f5fee9_full.jpg';
const xml = (name) => `<?xml version="1.0"?><profile><steamID><![CDATA[${name}]]></steamID><avatarFull><![CDATA[${AV}]]></avatarFull></profile>`;

test('/api/steam-profiles: ник и аватар, кэш, мусорные id отбрасываются, игроку можно', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2sp-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: { alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' }, tester: { hash: hashPassword('hunter2hunter2'), role: 'player' } } }));
  const calls = [];
  const httpGet = async (url) => {
    calls.push(url);
    if (url.includes('/76561198000000100/')) return { status: 200, text: xml('sink333') };
    return { status: 200, text: '<profile><error>not found</error></profile>' }; // скрытый/несуществующий профиль
  };
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' }, compute: {}, httpGet,
    usersFile: path.join(dir, 'users.json'), settingsFile: path.join(dir, 'settings.json'), auditFile: path.join(dir, 'audit.log'),
    faceitFile: path.join(dir, 'faceit.json'), statsCacheFile: path.join(dir, 'stats-cache.json'), brandFile: path.join(dir, 'brand.json'), brandLogoFile: path.join(dir, 'brand-logo.bin'),
    steamProfilesFile: path.join(dir, 'sp.json'),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = async (u) => (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'hunter2hunter2' }) })).headers.get('set-cookie').split(';')[0];
  const get = async (q, cookie) => { const r = await fetch(`${base}/api/steam-profiles?ids=${q}`, { headers: { cookie } }); return { status: r.status, json: await r.json() }; };
  try {
    assert.equal((await fetch(`${base}/api/steam-profiles?ids=1`)).status, 401);
    const adm = await login('alice'); const ply = await login('tester');
    const r = await get('76561198000000100,76561198000000102,abc,123,76561198000000100', adm);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.profiles, { '76561198000000100': { name: 'sink333', avatar: AV } });
    assert.equal(calls.length, 2); // дубли и мусор не ходят в Steam
    const again = await get('76561198000000100,76561198000000102', ply); // игроку тоже, из кэша
    assert.equal(again.status, 200); assert.equal(again.json.profiles['76561198000000100'].name, 'sink333');
    assert.equal(calls.length, 2, 'повторный запрос идёт из кэша, в том числе «не найден»');
    assert.deepEqual((await get('', adm)).json.profiles, {});
    const many = Array.from({ length: 40 }, (_x, i) => `7656119800000${String(1000 + i)}`).join(',');
    assert.equal((await get(many, adm)).status, 200);
    assert.ok(calls.length <= 2 + 8, 'за один запрос — не больше 8 обращений к Steam');
  } finally { app.close(); }
});
