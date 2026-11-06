'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');

async function setup({ vmStatus = 'RUNNING', agentImpl } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2admin-'));
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ users: { alice: { hash: hashPassword('hunter2hunter2'), role: 'admin' } } }));
  const calls = [];
  const vm = { status: vmStatus };
  const compute = {
    describe: async () => ({ id: 'i1', name: 'sandbox-cs-1-game', status: vm.status, publicIp: '203.0.113.5', cores: 2, memoryGb: 8, platform: 'standard-v3' }),
    start: async () => { calls.push('yc.start'); vm.status = 'STARTING'; },
    stop: async () => { calls.push('yc.stop'); vm.status = 'STOPPING'; },
  };
  const agent = agentImpl || (async (method, p, body) => {
    calls.push(`${method} ${p}`);
    if (p === '/status') return { live: { humans: 0, bots: 0, map: 'de_dust2', maxPlayers: 10 }, service: { active: 'active', sub: 'running' } };
    if (p === '/prepare-stop') return { steps: ['cs2 stopped'] };
    return { ok: true, echo: body };
  });
  const app = createApp({
    config: { instanceId: 'i1', agentUrl: 'http://x', publicPort: 0 }, secrets: { AGENT_TOKEN: 't' }, compute, agent,
    usersFile: path.join(dir, 'users.json'), settingsFile: path.join(dir, 'settings.json'), auditFile: path.join(dir, 'audit.log'),
    userPresetsFile: path.join(dir, 'user-presets.json'), customSkinsFile: path.join(dir, 'custom-skins.json'), catalogCache: { get: async () => ({}) },
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const req = async (method, p, body, cookie, extra = {}) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0], headers: r.headers };
  };
  const login = async () => (await req('POST', '/api/login', { username: 'alice', password: 'hunter2hunter2' })).cookie;
  return { app, req, login, calls, vm, dir, close: () => app.server.close() };
}
const CSRF = { 'X-Requested-With': 'cs2panel' };

test('API requires login; login rejects bad passwords', async () => {
  const t = await setup();
  try {
    assert.equal((await t.req('GET', '/api/overview')).status, 401);
    assert.equal((await t.req('POST', '/api/login', { username: 'alice', password: 'nope-nope-nope' })).status, 401);
    const cookie = await t.login();
    assert.match(cookie, /^cs2sid=/);
    const ov = await t.req('GET', '/api/overview', undefined, cookie);
    assert.equal(ov.status, 200);
    assert.equal(ov.json.vm.status, 'RUNNING');
    assert.equal(ov.json.connect, 'connect 203.0.113.5:27015');
  } finally { t.close(); }
});

test('state-changing calls need the CSRF header', async () => {
  const t = await setup();
  try {
    const cookie = await t.login();
    assert.equal((await t.req('POST', '/api/rcon', { command: 'status' }, cookie)).status, 403);
    assert.equal((await t.req('POST', '/api/rcon', { command: 'status' }, cookie, CSRF)).status, 200);
  } finally { t.close(); }
});

test('stopping the VM asks the agent to back up first, then stops it in Yandex Cloud', async () => {
  const t = await setup();
  try {
    const cookie = await t.login();
    const r = await t.req('POST', '/api/vm/stop', {}, cookie, CSRF);
    assert.equal(r.status, 200);
    for (let i = 0; i < 50 && !t.calls.includes('yc.stop'); i++) await new Promise((x) => setTimeout(x, 20));
    assert.deepEqual(t.calls.filter((c) => c === 'POST /prepare-stop' || c === 'yc.stop'), ['POST /prepare-stop', 'yc.stop']);
    const ov = await t.req('GET', '/api/overview', undefined, cookie);
    assert.equal(ov.json.busy, null);
  } finally { t.close(); }
});

test('stop still happens when the agent is unreachable', async () => {
  const t = await setup({ agentImpl: async (m, p) => { if (p === '/prepare-stop') throw new Error('agent down'); return {}; } });
  try {
    const cookie = await t.login();
    await t.req('POST', '/api/vm/stop', {}, cookie, CSRF);
    for (let i = 0; i < 50 && !t.calls.includes('yc.stop'); i++) await new Promise((x) => setTimeout(x, 20));
    assert.ok(t.calls.includes('yc.stop'));
  } finally { t.close(); }
});

test('start is a no-op when running and works when stopped', async () => {
  const t = await setup({ vmStatus: 'STOPPED' });
  try {
    const cookie = await t.login();
    assert.equal((await t.req('POST', '/api/vm/start', {}, cookie, CSRF)).json.status, 'STARTING');
    assert.deepEqual(t.calls, ['yc.start']);
    t.vm.status = 'RUNNING';
    assert.equal((await t.req('POST', '/api/vm/start', {}, cookie, CSRF)).json.status, 'RUNNING');
    assert.deepEqual(t.calls, ['yc.start']);
  } finally { t.close(); }
});

test('idle auto-stop triggers after the configured empty period only', async () => {
  const t = await setup();
  try {
    const cookie = await t.login();
    await t.req('PUT', '/api/settings', { autoStopIdleMinutes: 1, startupGraceMinutes: 0 }, cookie, CSRF);
    await t.app.idleTick(); // first empty observation: starts the clock
    assert.ok(!t.calls.includes('yc.stop'));
    t.app.vmState.idleSince -= 61_000;
    await t.app.idleTick();
    for (let i = 0; i < 50 && !t.calls.includes('yc.stop'); i++) await new Promise((x) => setTimeout(x, 20));
    assert.ok(t.calls.includes('yc.stop'));
  } finally { t.close(); }
});

test('settings validate input; audit log records actions; static files served with CSP', async () => {
  const t = await setup();
  try {
    const cookie = await t.login();
    assert.equal((await t.req('PUT', '/api/settings', { autoStopIdleMinutes: -5 }, cookie, CSRF)).status, 400);
    await t.req('POST', '/api/map', { map: 'de_mirage' }, cookie, CSRF);
    const audit = await t.req('GET', '/api/audit', undefined, cookie);
    assert.ok(audit.json.entries.some((e) => e.action === 'map' && e.detail === 'de_mirage'));
    const page = await fetch(`http://127.0.0.1:${t.app.server.address().port}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    const html = await page.text();
    const scripts = [...html.matchAll(/<script src="(\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 8);
    for (const src of scripts) assert.equal((await fetch(`http://127.0.0.1:${t.app.server.address().port}${src}`)).status, 200, src);
    const js = await fetch(`http://127.0.0.1:${t.app.server.address().port}/core.js`);
    assert.equal(js.status, 200);
    const trav = await fetch(`http://127.0.0.1:${t.app.server.address().port}/..%2f..%2fetc%2fpasswd`);
    assert.equal(trav.status, 404);
  } finally { t.close(); }
});

test('skin, practice and preset routes validate and proxy to the agent', async () => {
  const seen = [];
  const t = await setup({ agentImpl: async (method, p, body) => { seen.push([method, p, body]); if (p === '/rcon-batch') return { outputs: body.commands.map(() => '"sv_cheats" = "1" ( def. "0" )') }; return { ok: true }; } });
  try {
    const cookie = await t.login();
    assert.equal((await t.req('POST', '/api/practice', { action: 'bot-add', team: 'ct', count: 2 }, cookie)).status, 403, 'CSRF header required');
    const r = await t.req('POST', '/api/practice', { action: 'bot-add', team: 'ct', count: 2 }, cookie, CSRF);
    assert.equal(r.status, 200);
    assert.deepEqual(seen.at(-1), ['POST', '/rcon-batch', { commands: ['bot_add_ct', 'bot_add_ct'] }]);
    assert.equal((await t.req('POST', '/api/practice', { action: 'say', text: 'a; quit' }, cookie, CSRF)).status, 400);
    const rd = await t.req('POST', '/api/practice/read', {}, cookie, CSRF);
    assert.equal(rd.json.values.sv_cheats, '1');
    await t.req('POST', '/api/skins/apply/76561198000000100', { ops: [{ op: 'reset' }] }, cookie, CSRF);
    assert.deepEqual(seen.at(-1), ['POST', '/skins/apply/76561198000000100', { ops: [{ op: 'reset' }] }]);
    const bad = await t.req('PUT', '/api/custom-skins', { skins: [{ def: 7, paint: 1, name: 'x', img: 'https://evil.example/a.png' }] }, cookie, CSRF);
    assert.equal(bad.status, 400);
    const ok = await t.req('PUT', '/api/custom-skins', { skins: [{ def: 7, paint: 9999, name: 'Мой', img: 'https://raw.githubusercontent.com/a/b.png', kind: 'weapon' }] }, cookie, CSRF);
    assert.equal(ok.json.skins[0].paint, 9999);
    assert.equal((await t.req('GET', '/api/custom-skins', undefined, cookie)).json.skins.length, 1);
    const up = await t.req('PUT', '/api/user-presets', { presets: { 'my-1': { label: 'Мой', cvars: { sv_cheats: '1' } } } }, cookie, CSRF);
    assert.equal(up.json.presets['my-1'].cvars.sv_cheats, '1');
    assert.equal((await t.req('PUT', '/api/user-presets', { presets: { 'Bad Id': { cvars: {} } } }, cookie, CSRF)).status, 400);
    assert.equal((await t.req('PUT', '/api/user-presets', { presets: { ok: { cvars: { 'x;y': '1' } } } }, cookie, CSRF)).status, 400);
  } finally { t.close(); }
});
