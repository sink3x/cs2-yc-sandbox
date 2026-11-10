'use strict';
// Регрессионные тесты по итогам аудита безопасности.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');
const { verifySteamAssertion } = require('../lib/account');
const { assertSafeArchive } = require('../agent/backup');

const CSRF = { 'X-Requested-With': 'cs2panel' };
const STEAM = '76561198000000001';

async function setup(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2sec-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: { alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' } } }));
  if (state) fs.writeFileSync(path.join(dir, 'state-cache.json'), JSON.stringify({ state }));
  const f = (n) => path.join(dir, n);
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' },
    compute: { describe: async () => ({ status: 'RUNNING' }) }, agent: async (m, p, b) => ({ ok: true, echo: b }),
    usersFile: f('users.json'), settingsFile: f('settings.json'), uptimeFile: f('uptime.json'), auditFile: f('audit.log'), faceitFile: f('faceit.json'),
    wearImagesFile: f('wear.json'), statsCacheFile: f('stats-cache.json'), brandFile: f('brand.json'), brandLogoFile: f('brand-logo.bin'), stateCacheFile: f('state-cache.json'),
    sessionsFile: f('sessions.json'), steamProfilesFile: f('steam-profiles.json'), setupsFile: f('setups.json'), userPresetsFile: f('up.json'), customSkinsFile: f('cs.json'),
    soundsDir: f('sounds'), soundSyncFile: f('ss.json'), calloutsCustomFile: f('co.json'),
    httpGet: async () => ({ status: 404, json: null }), httpPost: async () => 'is_valid:true\n',
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const req = async (method, p, body, cookie, extra = {}) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0], headers: r.headers, loc: r.headers.get('location') || '' };
  };
  const login = async () => (await req('POST', '/api/login', { username: 'alice', password: 'hunter2hunter2' })).cookie;
  return { app, req, login, dir, base, close: () => app.server.close() };
}

test('a user name like __proto__ cannot reach Object.prototype (account linking)', async () => {
  const t = await setup();
  try {
    const c = await t.login();
    const r = await t.req('POST', `/api/seen/${STEAM}/link`, { user: '__proto__' }, c, CSRF);
    assert.equal(r.status, 404);
    assert.equal(({}).steamid, undefined);
    assert.equal((await t.req('POST', '/api/login', { username: '__proto__', password: 'x' })).status, 401);
  } finally { t.close(); }
});

test('security headers: CSP closes base-uri, form-action and object-src; static path traversal is a 404', async () => {
  const t = await setup();
  try {
    const r = await fetch(`${t.base}/`);
    const csp = r.headers.get('content-security-policy');
    for (const d of ["base-uri 'none'", "form-action 'self'", "object-src 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(d), d);
    for (const p of ['/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/users.json', '/secrets.env']) assert.equal((await fetch(t.base + p)).status, 404, p);
    assert.equal((await fetch(`${t.base}/api/state`)).status, 401);
  } finally { t.close(); }
});

test('Steam assertion: the signature must cover the identity fields', async () => {
  const q = (signed) => ({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM}`, 'openid.identity': `https://steamcommunity.com/openid/id/${STEAM}`, 'openid.return_to': 'http://h/cb',
    'openid.response_nonce': `n${Math.random()}`, 'openid.signed': signed, 'openid.sig': 'x' });
  const post = async () => 'is_valid:true\n';
  const full = 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle';
  assert.equal(await verifySteamAssertion(q(full), 'http://h/cb', post), STEAM);
  await assert.rejects(verifySteamAssertion(q('signed,op_endpoint,return_to,response_nonce'), 'http://h/cb', post), /not signed/);
  await assert.rejects(verifySteamAssertion({ ...q(full), 'openid.ns': 'x' }, 'http://h/cb', post), /namespace/);
});

test('an in-game admin is NOT auto-linked to the only free panel account (privilege escalation)', async () => {
  const t = await setup({ admins: [{ steamid: STEAM, name: 'SomeoneElse', flags: ['@css/ban'] }] });
  try {
    const rt = `${t.base}/api/auth/steam/callback`;
    const qs = new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
      'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM}`, 'openid.identity': `https://steamcommunity.com/openid/id/${STEAM}`, 'openid.return_to': rt,
      'openid.response_nonce': 'z1', 'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce', 'openid.sig': 'x' });
    const r = await t.req('GET', `/api/auth/steam/callback?${qs}`);
    assert.equal(r.status, 302);
    const me = await t.req('GET', '/api/me', undefined, r.cookie);
    assert.equal(me.json.role, 'player');
    assert.match(me.json.user, /^p\d+$/);
    const users = JSON.parse(fs.readFileSync(path.join(t.dir, 'users.json'), 'utf8')).users;
    assert.equal(users.alice.steamid, undefined);
  } finally { t.close(); }
});

test('the audit log keeps the RCON command name but not the secret inside it', async () => {
  const t = await setup();
  try {
    const c = await t.login();
    await t.req('POST', '/api/rcon', { command: 'sv_password hunter2secret' }, c, CSRF);
    await t.req('POST', '/api/rcon', { command: 'status' }, c, CSRF);
    const log = fs.readFileSync(path.join(t.dir, 'audit.log'), 'utf8');
    assert.ok(!log.includes('hunter2secret'));
    assert.ok(log.includes('sv_password [скрыто]'));
    assert.ok(log.includes('"detail":"status"'));
  } finally { t.close(); }
});

// Агент работает на Ubuntu (GNU tar): формат оглавления bsdtar (macOS) другой, поэтому на Mac тест пропускается.
const GNU_TAR = (() => { try { return /GNU tar/.test(execFileSync('tar', ['--version'], { encoding: 'utf8' })); } catch { return false; } })();
test('restore: an archive with links, absolute or .. paths is refused before extraction', { skip: !GNU_TAR && 'needs GNU tar' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2tar-'));
  fs.mkdirSync(path.join(dir, 'ok/data'), { recursive: true }); fs.writeFileSync(path.join(dir, 'ok/data/a'), 'x');
  execFileSync('tar', ['czf', path.join(dir, 'ok.tgz'), '-C', path.join(dir, 'ok'), 'data']);
  await assertSafeArchive(path.join(dir, 'ok.tgz'));
  fs.mkdirSync(path.join(dir, 'bad')); fs.symlinkSync('/etc', path.join(dir, 'bad/evil'));
  execFileSync('tar', ['czf', path.join(dir, 'sym.tgz'), '-C', path.join(dir, 'bad'), 'evil']);
  await assert.rejects(assertSafeArchive(path.join(dir, 'sym.tgz')), /unsafe entry/);
  fs.writeFileSync(path.join(dir, 'f'), 'x');
  execFileSync('tar', ['czf', path.join(dir, 'abs.tgz'), '--transform', 's,^,../,', '-C', dir, 'f']);
  await assert.rejects(assertSafeArchive(path.join(dir, 'abs.tgz')), /unsafe path/);
});

test('audit log: country by IP (cached, private addresses never leave), filters and search', async () => {
  const t = await setup();
  try {
    const cookie = await t.login();
    const lookups = [];
    // реальный сервис в тесте не вызываем: подменяем поиск страны через прямой вызов библиотеки
    const { createGeo, isPublic, normalize } = require('../lib/ipgeo');
    assert.equal(isPublic('10.0.0.1'), false); assert.equal(isPublic('127.0.0.1'), false); assert.equal(isPublic('192.168.1.5'), false);
    assert.equal(isPublic('169.254.169.254'), false); assert.equal(isPublic('::1'), false); assert.equal(isPublic('fd00::1'), false);
    assert.equal(isPublic('8.8.8.8'), true); assert.equal(isPublic('2a00:1450::1'), true); assert.equal(normalize('::ffff:1.2.3.4'), '1.2.3.4'); assert.equal(normalize('-'), '');
    const g = createGeo({ lookup: async (ip) => { lookups.push(ip); if (ip === '5.5.5.5') throw new Error('down'); return ip === '1.1.1.1' ? 'au' : 'de'; } });
    const r1 = await g.resolve(['1.1.1.1', '10.1.1.1', '::ffff:2.2.2.2', '5.5.5.5', '-', '1.1.1.1']);
    assert.deepEqual(r1.map, { '1.1.1.1': 'AU', '10.1.1.1': '', '::ffff:2.2.2.2': 'DE', '5.5.5.5': '' });
    await g.resolve(['1.1.1.1', '5.5.5.5']); // из кэша / из «недавних сбоев»
    assert.deepEqual(lookups.sort(), ['1.1.1.1', '2.2.2.2', '5.5.5.5']);
    // API: свои записи с разных адресов
    fs.writeFileSync(path.join(t.dir, 'audit.log'), [
      { ts: '2026-11-01T10:00:00.000Z', user: 'alice', ip: '10.0.0.5', action: 'map', detail: 'de_mirage' },
      { ts: '2026-11-02T10:00:00.000Z', user: 'friend', ip: '10.0.0.6', action: 'rcon', detail: 'status' },
      { ts: '2026-11-03T10:00:00.000Z', user: 'alice', ip: '-', action: 'vote.result', detail: { winner: 'de_dust2' } },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n');
    const all = (await t.req('GET', '/api/audit', undefined, cookie)).json;
    assert.equal(all.total, 3); assert.equal(all.entries[0].action, 'vote.result');
    assert.deepEqual(all.facets.users, ['alice', 'friend']);
    const q = (s) => t.req('GET', `/api/audit?${s}`, undefined, cookie).then((r) => r.json);
    assert.equal((await q('user=friend')).total, 1);
    assert.equal((await q('q=MIRAGE')).total, 1);
    assert.equal((await q('q=dust2')).total, 1);
    assert.equal((await q('ip=10.0.0.6')).entries[0].user, 'friend');
    assert.equal((await q('action=vote')).total, 1);
    assert.equal((await q('from=2026-11-02&to=2026-11-02')).total, 1);
    assert.equal((await q('country=-')).total, 3);
    assert.equal((await q('country=DE')).total, 0);
  } finally { t.close(); }
});
