'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2agent-'));
process.env.CS2_ROOT = root;
process.env.CS2_ETC = path.join(root, 'etc');
process.env.AGENT_TOKEN = 'tok';

const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../agent/agent');
const E = require('../agent/env');

let base;
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

const call = async (method, p, body, token = 'tok') => {
  const r = await fetch(base + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

test('agent rejects requests without the bearer token', async () => {
  assert.equal((await call('GET', '/health', undefined, 'wrong')).status, 401);
  assert.equal((await call('GET', '/health')).status, 200);
});

test('state round-trip validates input and persists to disk', async () => {
  const get = await call('GET', '/state');
  assert.equal(get.status, 200);
  assert.ok(get.json.plugins.length >= 5);
  const bad = await call('PUT', '/state', { state: { cvars: { sv_cheats: '1\nquit' } } });
  assert.equal(bad.status, 400);
  const ok = await call('PUT', '/state', { state: { server: { hostname: 'tested' }, cvars: { mp_roundtime: '3' } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(JSON.parse(fs.readFileSync(E.files.state, 'utf8')).server.hostname, 'tested');
  assert.equal((await call('GET', '/state')).json.state.cvars.mp_roundtime, '3');
});

test('rcon endpoint refuses multi-line commands', async () => {
  assert.equal((await call('POST', '/rcon', { command: 'status\nquit' })).status, 400);
  assert.equal((await call('POST', '/rcon', { command: '' })).status, 400);
});

test('unknown preset is rejected, unknown route is 404', async () => {
  assert.equal((await call('POST', '/preset', { preset: 'nope' })).status, 400);
  assert.equal((await call('GET', '/nope')).status, 404);
});
