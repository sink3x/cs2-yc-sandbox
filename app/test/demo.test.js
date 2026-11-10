'use strict';
// The demo mode is a public entry point of the project ("npm run demo"): keep it working.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startDemo, LOGINS } = require('../dev/demo');

async function login(url, username, password) {
  const r = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cs2panel' }, body: JSON.stringify({ username, password }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const get = (url, p, cookie) => fetch(url + p, { headers: { cookie } }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

test('demo: serves the panel, logs in and answers the main API calls from the mock game server', async () => {
  const d = await startDemo({ port: 0 });
  try {
    assert.match(d.url, /^http:\/\/127\.0\.0\.1:\d+$/, 'demo must listen on loopback only');
    const index = await fetch(d.url + '/');
    assert.equal(index.status, 200);

    assert.equal((await login(d.url, 'admin', 'wrong-password')).status, 401);
    const admin = await login(d.url, 'admin', LOGINS.admin);
    assert.equal(admin.status, 200);

    const me = await get(d.url, '/api/me', admin.cookie);
    assert.equal(me.json.user, 'admin');
    assert.equal(me.json.role, 'admin');

    const ov = await get(d.url, '/api/overview', admin.cookie);
    assert.equal(ov.status, 200);
    assert.equal(ov.json.vm.status, 'RUNNING');

    const catalog = await get(d.url, '/api/catalog', admin.cookie);
    assert.equal(catalog.status, 200);
    assert.ok(Array.isArray(catalog.json.maps) && catalog.json.maps.length > 0);
  } finally { d.close(); }
});

test('demo: the player role cannot reach admin-only routes', async () => {
  const d = await startDemo({ port: 0 });
  try {
    const player = await login(d.url, 'player', LOGINS.player);
    assert.equal(player.status, 200);
    assert.equal((await get(d.url, '/api/audit', player.cookie)).status, 403);
  } finally { d.close(); }
});
