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

test('restore: an archive with links, absolute or .. paths is refused before extraction', async () => {
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
