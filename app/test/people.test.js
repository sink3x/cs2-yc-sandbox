'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');
const people = require('../lib/people');

const CSRF = { 'X-Requested-With': 'cs2panel' };
const SID1 = '76561198000000001'; const SID2 = '76561198000000002';
async function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2people-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: {
    alice: { hash: hashPassword('hunter2hunter2'), role: 'admin', steamid: SID1, persona: 'AlicePlayer', avatar: 'https://avatars.steamstatic.com/aa_full.jpg', email: 'a@example.com', created: '2026-01-01T00:00:00Z' },
    p2: { hash: hashPassword('hunter2hunter2'), role: 'player', steamid: SID2, persona: 'Игрок Два', created: '2026-02-01T00:00:00Z' },
    p3: { hash: hashPassword('hunter2hunter2'), role: 'player', created: '2026-03-01T00:00:00Z' },
  } }));
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' },
    compute: { describe: async () => ({ id: 'i1', status: 'RUNNING' }) },
    agent: opts.agent || (async (m, p) => { if (p.startsWith('/stats/')) return { players: [{ steamid: p.split('/').pop(), name: 'x', kills: 5 }] }; return { ok: true }; }),
    usersFile: path.join(dir, 'users.json'), settingsFile: path.join(dir, 'settings.json'), auditFile: path.join(dir, 'audit.log'), setupsFile: path.join(dir, 'setups.json'),
    faceitFile: path.join(dir, 'faceit.json'), statsCacheFile: path.join(dir, 'stats-cache.json'), brandFile: path.join(dir, 'brand.json'), brandLogoFile: path.join(dir, 'brand-logo.bin'), stateCacheFile: path.join(dir, 'state-cache.json'),
    httpGet: async () => ({ status: 404, json: null, text: '' }),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const req = async (method, p, body, cookie) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(method === 'GET' ? {} : CSRF) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  const login = async (u) => (await req('POST', '/api/login', { username: u, password: 'hunter2hunter2' })).cookie;
  return { req, login, dir, close: () => app.server.close() };
}

test('slug: уникальные и постоянные, кириллица → запасной вариант', () => {
  const us = { a: { persona: 'Sink 333' }, b: { persona: 'Sink-333' }, c: { persona: 'Игрок' } };
  assert.equal(people.ensureSlugs(us), true);
  assert.equal(us.a.slug, 'sink-333'); assert.equal(us.b.slug, 'sink-333-2'); assert.equal(us.c.slug, 'c');
  assert.equal(people.ensureSlugs(us), false);
});

test('пользователи: список только для админа, фильтры из query string проверяются', async () => {
  const t = await setup(); const a = await t.login('alice'); const p = await t.login('p2');
  try {
    assert.equal((await t.req('GET', '/api/users', undefined, p)).status, 403);
    assert.equal((await t.req('GET', '/api/users')).status, 401);
    const all = await t.req('GET', '/api/users', undefined, a);
    assert.equal(all.json.total, 3); assert.ok(all.json.users.every((u) => u.slug && !('email' in u) && !('hash' in u)));
    const pl = await t.req('GET', '/api/users?role=player&sort=name&q=%D0%B8%D0%B3%D1%80', undefined, a);
    assert.deepEqual(pl.json.users.map((u) => u.name), ['p2']);
    const junk = await t.req('GET', '/api/users?role=root&sort=__proto__&limit=-5&page=abc', undefined, a);
    assert.equal(junk.status, 200); assert.equal(junk.json.role, ''); assert.equal(junk.json.sort, 'login'); assert.equal(junk.json.limit, 1);
  } finally { t.close(); }
});

test('карточка: админ видит любую (аватар, ссылка Steam, почта), игрок — только свою', async () => {
  const t = await setup(); const a = await t.login('alice'); const p = await t.login('p2');
  try {
    const list = (await t.req('GET', '/api/users', undefined, a)).json.users; const slugOf = (n) => list.find((u) => u.name === n).slug;
    const card = await t.req('GET', `/api/users/${slugOf('alice')}`, undefined, a);
    assert.equal(card.status, 200); assert.match(card.json.avatar, /steamstatic/); assert.equal(card.json.steamUrl, `https://steamcommunity.com/profiles/${SID1}`); assert.equal(card.json.email, 'a@example.com');
    assert.equal(card.json.stats.kills, 5);
    assert.equal((await t.req('GET', `/api/users/${slugOf('alice')}`, undefined, p)).status, 403);
    assert.equal((await t.req('GET', `/api/users/${slugOf('p2')}`, undefined, p)).status, 200);
    assert.equal((await t.req('GET', '/api/users/nobody-here', undefined, a)).status, 404);
    assert.equal((await t.req('GET', '/api/users/Bad_Slug!', undefined, a)).status, 400);
  } finally { t.close(); }
});

test('вход обновляет lastLogin', async () => {
  const t = await setup(); await t.login('alice');
  try { const u = JSON.parse(fs.readFileSync(path.join(t.dir, 'users.json'), 'utf8')).users.alice; assert.match(u.lastLogin, /^20\d\d-/); } finally { t.close(); }
});

const SETUP = { title: 'Мой aim', kind: 'full', visibility: 'private', launch: '-novid -high', mouse: { model: 'G Pro X', dpi: 800, sens: 1.2, rawInput: true },
  video: { resolution: '1920x1080', mode: 'fullscreen', refreshHz: 240 }, files: [{ name: 'autoexec.cfg', text: 'sensitivity "1.2"\nm_rawinput 1\ncl_crosshairsize 2 // x\n' }] };

test('сетапы: приватный виден владельцу и админу, чужому игроку — 404', async () => {
  const t = await setup(); const p2 = await t.login('p2'); const p3 = await t.login('p3'); const a = await t.login('alice');
  try {
    const c = await t.req('POST', '/api/setups', SETUP, p2); assert.equal(c.status, 200); assert.equal(c.json.derived.edpi, 960); assert.equal(c.json.derived.found.m_rawinput, '1');
    assert.equal((await t.req('GET', `/api/setups/${c.json.ref}`, undefined, p2)).status, 200);
    assert.equal((await t.req('GET', `/api/setups/${c.json.id}`, undefined, a)).status, 200);
    assert.equal((await t.req('GET', `/api/setups/${c.json.id}`, undefined, p3)).status, 404);
    assert.equal((await t.req('GET', '/api/setups', undefined, p3)).json.total, 0);
    assert.equal((await t.req('PUT', `/api/setups/${c.json.id}`, SETUP, a)).status, 403);
    assert.equal((await t.req('GET', '/api/setups/zzz', undefined, a)).status, 400);
  } finally { t.close(); }
});

test('сетапы: отправка выбранным пользователям, публичный доступ, копирование', async () => {
  const t = await setup(); const p2 = await t.login('p2'); const p3 = await t.login('p3');
  try {
    const slugs = (await t.req('GET', '/api/people', undefined, p2)).json.users; const s3 = slugs.find((u) => u.displayName === 'p3').slug;
    const c = await t.req('POST', '/api/setups', { ...SETUP, visibility: 'users', sharedWith: [s3] }, p2);
    assert.equal((await t.req('GET', `/api/setups/${c.json.id}`, undefined, p3)).status, 200);
    assert.equal((await t.req('POST', '/api/setups', { ...SETUP, visibility: 'users', sharedWith: ['ghost'] }, p2)).status, 404);
    const cp = await t.req('POST', `/api/setups/${c.json.id}/copy`, {}, p3); assert.equal(cp.status, 200); assert.equal(cp.json.visibility, 'private'); assert.equal(cp.json.mine, true);
    assert.equal((await t.req('DELETE', `/api/setups/${c.json.id}`, undefined, p3)).status, 403);
    assert.equal((await t.req('DELETE', `/api/setups/${cp.json.id}`, undefined, p3)).status, 200);
    const pub = await t.req('PUT', `/api/setups/${c.json.id}`, { ...SETUP, visibility: 'all' }, p2); assert.equal(pub.json.visibility, 'all');
    assert.equal((await t.req('GET', '/api/setups?scope=shared', undefined, p3)).json.total, 1);
  } finally { t.close(); }
});

test('сетапы: валидация (dpi, файлы, имена, размер)', async () => {
  const t = await setup(); const p2 = await t.login('p2');
  try {
    for (const bad of [{ ...SETUP, title: '' }, { ...SETUP, mouse: { dpi: 5 } }, { ...SETUP, video: { resolution: 'big' } },
      { ...SETUP, files: [{ name: '../x.cfg', text: '' }] }, { ...SETUP, files: [{ name: 'a.exe', text: '' }] }, { ...SETUP, files: [{ name: 'a.cfg', text: 'x'.repeat(70000) }] },
      { ...SETUP, files: Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.cfg`, text: '' })) }]) assert.equal((await t.req('POST', '/api/setups', bad, p2)).status, 400);
    const ok = await t.req('POST', '/api/setups', { ...SETUP, title: '<b>x</b>', evil: 1, files: [{ name: 'cs2_video.txt', text: '"setting.defaultres" "1920"\n"setting.fullscreen" "1"' }] }, p2);
    assert.equal(ok.status, 200); assert.equal(ok.json.title, 'bx/b'); assert.equal(ok.json.evil, undefined); assert.equal(ok.json.derived.video.defaultres, '1920');
  } finally { t.close(); }
});

test('админ в игре: выдача и снятие из карточки, владелец защищён, игрок не может', async () => {
  const S = require('../lib/state');
  const OWNER = SID1; let stored = S.defaultState({ admins: [{ name: 'alice', steamid: OWNER }] }); const cmds = [];
  const t = await setup({ agent: async (m, p, body) => {
    if (p === '/state' && m === 'GET') return { state: stored, plugins: [], admin_flags: S.ADMIN_FLAGS, protectedAdmins: [OWNER] };
    if (p === '/state' && m === 'PUT') { const v = S.validateState(body.state, stored, { protect: [OWNER] }); if (!v.ok) throw Object.assign(new Error(v.errors.join('; ')), { status: 400 }); stored = v.state; return { state: stored, applied: { changed: [] }, needsRestart: false }; }
    if (p === '/rcon') { cmds.push(body.command); return { output: '' }; }
    return { ok: true };
  } });
  const a = await t.login('alice'); const p = await t.login('p2');
  try {
    const list = (await t.req('GET', '/api/users', undefined, a)).json.users; const slug = (n) => list.find((u) => u.name === n).slug;
    assert.equal((await t.req('PUT', `/api/users/${slug('p2')}/game-admin`, { enabled: true, flags: ['@css/kick'] }, p)).status, 403);
    assert.equal((await t.req('PUT', `/api/users/${slug('p3')}/game-admin`, { enabled: true }, a)).status, 400); // нет Steam
    assert.equal((await t.req('PUT', `/api/users/${slug('p2')}/game-admin`, { enabled: true, flags: [] }, a)).status, 400);
    const g = await t.req('PUT', `/api/users/${slug('p2')}/game-admin`, { enabled: true, flags: ['@css/kick', '@css/ban', '@css/nope'] }, a);
    assert.equal(g.status, 200); assert.deepEqual(g.json.gameAdmin.flags, ['@css/kick', '@css/ban']);
    assert.ok(stored.admins.some((x) => x.steamid === SID2)); assert.ok(cmds.includes('css_reload_admins'));
    const card = (await t.req('GET', `/api/users/${slug('p2')}`, undefined, a)).json;
    assert.equal(card.inGameAdmin, true); assert.deepEqual(card.gameAdmin.flags, ['@css/kick', '@css/ban']); assert.ok(Array.isArray(card.gameAdminFlags));
    assert.equal((await t.req('PUT', `/api/users/${slug('p2')}/game-admin`, { enabled: false }, a)).status, 200);
    assert.ok(!stored.admins.some((x) => x.steamid === SID2));
    const own = await t.req('PUT', `/api/users/${slug('alice')}/game-admin`, { enabled: false }, a);
    assert.equal(own.status, 400); assert.match(own.json.error, /protected/);
  } finally { t.close(); }
});
