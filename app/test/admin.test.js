'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../admin/server');
const { hashPassword } = require('../lib/auth');

async function setup({ vmStatus = 'RUNNING', agentImpl, deps = {} } = {}) {
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
    faceitFile: path.join(dir, 'faceit.json'), statsCacheFile: path.join(dir, 'stats-cache.json'), brandFile: path.join(dir, 'brand.json'), brandLogoFile: path.join(dir, 'brand-logo.bin'), ...deps, userPresetsFile: path.join(dir, 'user-presets.json'), stateCacheFile: path.join(dir, 'state-cache.json'), customSkinsFile: path.join(dir, 'custom-skins.json'), catalogCache: { get: async () => ({}) },
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

test('settings stay visible while the game VM is off: cached copy, queued edits, replay on reconnect, owner protected', async () => {
  const S = require('../lib/state');
  const OWNER = '76561198000000100';
  const live = { up: true }; const seen = [];
  let stored = S.defaultState({ admins: [{ name: 'alice', steamid: OWNER }] });
  const t = await setup({ agentImpl: async (method, p, body) => {
    if (!live.up) throw new Error('fetch failed'); // как при выключенной ВМ: ошибка без HTTP-статуса
    seen.push(`${method} ${p}`);
    if (p === '/state' && method === 'GET') return { state: stored, plugins: [], admin_flags: S.ADMIN_FLAGS, protectedAdmins: [OWNER] };
    if (p === '/state' && method === 'PUT') { const v = S.validateState(body.state, stored, { protect: [OWNER] }); if (!v.ok) throw Object.assign(new Error(v.errors.join('; ')), { status: 400 }); stored = v.state; return { state: stored, applied: { changed: [] } }; }
    return { ok: true };
  } });
  try {
    const c = await t.login();
    // 1) пока сервер доступен, копия сохраняется в панели
    const online = await t.req('GET', '/api/state', undefined, c);
    assert.equal(online.status, 200); assert.ok(!online.json.offline);
    // 2) ВМ выключена: настройки всё равно отдаются из копии, а не ошибкой
    live.up = false;
    const off = await t.req('GET', '/api/state', undefined, c);
    assert.equal(off.status, 200); assert.equal(off.json.offline, true); assert.equal(off.json.state.server.map, 'de_dust2');
    // 3) правка в офлайне валидируется, ложится в очередь и видна сразу
    const put = await t.req('PUT', '/api/state', { state: { server: { map: 'de_mirage' } } }, c, CSRF);
    assert.equal(put.status, 200); assert.equal(put.json.queued, true); assert.equal(put.json.state.server.map, 'de_mirage');
    const bad = await t.req('PUT', '/api/state', { state: { server: { map: 'bad map!' } } }, c, CSRF);
    assert.equal(bad.status, 400);
    // 4) владельца нельзя удалить из админов и в офлайне
    const rm = await t.req('PUT', '/api/state', { state: { admins: [{ name: 'friend', steamid: '76561198000000102', flags: ['@css/root'] }] } }, c, CSRF);
    assert.equal(rm.status, 400); assert.match(rm.json.error, /protected/);
    const noRoot = await t.req('PUT', '/api/state', { state: { admins: [{ name: 'alice', steamid: OWNER, flags: ['@css/generic'] }] } }, c, CSRF);
    assert.equal(noRoot.status, 400);
    // 5) сервер вернулся: очередь уходит на агент, дальше всё как обычно
    live.up = true;
    const back = await t.req('GET', '/api/state', undefined, c);
    assert.ok(!back.json.offline); assert.equal(back.json.state.server.map, 'de_mirage');
    assert.ok(seen.includes('PUT /state'));
  } finally { t.close(); }
});

test('state without any cached copy and no agent gives a clear error', async () => {
  const t = await setup({ agentImpl: async () => { throw new Error('fetch failed'); } });
  try {
    const c = await t.login();
    const r = await t.req('GET', '/api/state', undefined, c);
    assert.equal(r.status, 503); assert.match(r.json.error, /state cache empty/);
  } finally { t.close(); }
});

test('validateState protects the owner admin', () => {
  const S = require('../lib/state');
  const base = S.defaultState({ admins: [{ name: 'a', steamid: '76561198000000100' }, { name: 'b', steamid: '76561198000000102' }] });
  assert.ok(S.validateState({ admins: [base.admins[0]] }, base, { protect: ['76561198000000100'] }).ok);
  assert.ok(!S.validateState({ admins: [base.admins[1]] }, base, { protect: ['76561198000000100'] }).ok);
  assert.ok(S.validateState({ admins: [base.admins[1]] }, base).ok); // без защиты поведение прежнее
});

test('profile: e-mail, links, password policy and Steam link/login via OpenID', async () => {
  const STEAM = '76561198000000100';
  const posts = [];
  const t = await setup({ deps: { httpPost: async (url, form) => { posts.push(form); return posts.length < 99 && !/invalid/.test(form) ? 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n' : 'is_valid:false\n'; } } });
  try {
    const c = await t.login();
    assert.equal((await t.req('PUT', '/api/profile', { email: 'nope' }, c, CSRF)).status, 400);
    const ok = await t.req('PUT', '/api/profile', { email: 'me@example.com', links: [{ title: 'Faceit', url: 'https://www.faceit.com/en' }] }, c, CSRF);
    assert.equal(ok.json.email, 'me@example.com'); assert.equal(ok.json.links.length, 1);
    assert.equal((await t.req('PUT', '/api/profile', { links: [{ title: 'x', url: 'javascript:alert(1)' }] }, c, CSRF)).status, 400);
    // страна и язык: из фиксированного списка, регистр нормализуется, пусто — сброс
    assert.equal((await t.req('PUT', '/api/profile', { country: 'xx' }, c, CSRF)).status, 400);
    assert.equal((await t.req('PUT', '/api/profile', { lang: '<b>' }, c, CSRF)).status, 400);
    const geo = await t.req('PUT', '/api/profile', { country: 'de', lang: 'DE' }, c, CSRF);
    assert.equal(geo.json.country, 'DE'); assert.equal(geo.json.lang, 'de'); assert.ok(geo.json.countries.includes('RU'));
    assert.equal((await t.req('PUT', '/api/profile', { country: '', lang: '' }, c, CSRF)).json.country, '');
    // Steam не привязан → вход через Steam отказывает
    const cbq = (extra = '', id = STEAM, n = 'n1') => `/api/auth/steam/callback${extra}`;
    const assertion = (returnTo, id = STEAM, nonce = 'n1') => new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
      'openid.claimed_id': `https://steamcommunity.com/openid/id/${id}`, 'openid.identity': `https://steamcommunity.com/openid/id/${id}`, 'openid.return_to': returnTo, 'openid.response_nonce': nonce, 'openid.assoc_handle': 'x', 'openid.signed': 'a', 'openid.sig': 'b' });
    const host = `http://127.0.0.1:${t.app.server.address().port}`;
    const raw = async (p, cookie) => { const r = await fetch(host + p, { redirect: 'manual', headers: cookie ? { cookie } : {} }); return { status: r.status, loc: r.headers.get('location') || '', cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
    assert.equal((await t.req('PUT', '/api/settings', { playerLogin: false }, c, CSRF)).json.playerLogin, false);
    const start = await raw('/api/auth/steam');
    assert.equal(start.status, 302); assert.match(start.loc, /^https:\/\/steamcommunity\.com\/openid\/login\?/);
    const unlinked = await raw(cbq('') + '?' + assertion(`${host}/api/auth/steam/callback`, STEAM, 'a1'));
    assert.match(unlinked.loc, /steam=unlinked/); assert.equal(unlinked.cookie, '');
    // привязка: нужен одноразовый токен
    const tok = (await t.req('POST', '/api/profile/steam-link', {}, c, CSRF)).json.url;
    const token = tok.split('link=')[1];
    const rt = `${host}/api/auth/steam/callback?link=${token}`;
    const linked = await raw(`/api/auth/steam/callback?link=${token}&` + assertion(rt, STEAM, 'a2'));
    assert.match(linked.loc, /steam=linked/);
    assert.equal((await t.req('GET', '/api/profile', undefined, c)).json.steamid, STEAM);
    // токен одноразовый
    assert.match((await raw(`/api/auth/steam/callback?link=${token}&` + assertion(rt, STEAM, 'a3'))).loc, /steam=expired/);
    // вход через Steam теперь работает; повтор того же nonce — нет
    const rt0 = `${host}/api/auth/steam/callback`;
    const login = await raw('/api/auth/steam/callback?' + assertion(rt0, STEAM, 'a4'));
    assert.equal(login.loc, '/'); assert.match(login.cookie, /^cs2sid=/);
    assert.equal((await t.req('GET', '/api/me', undefined, login.cookie)).json.user, 'alice');
    assert.match((await raw('/api/auth/steam/callback?' + assertion(rt0, STEAM, 'a4'))).loc, /steam=error/);
    // чужой return_to и подпись, которую Steam не подтвердил
    assert.match((await raw('/api/auth/steam/callback?' + assertion('https://evil.example/cb', STEAM, 'a5'))).loc, /steam=error/);
    assert.match((await raw('/api/auth/steam/callback?' + assertion(rt0, STEAM, 'a6') + '&openid.sig=invalid')).loc, /steam=error/);
    assert.ok(posts.every((f) => /check_authentication/.test(f)));
    // отвязка
    assert.equal((await t.req('POST', '/api/profile/steam-unlink', {}, c, CSRF)).json.steamid, '');
    // этот Steam раньше входил как «игрок» (аккаунт p<steamid>) → привязка из админ-аккаунта объединяет, а не отвечает «taken»
    assert.equal((await t.req('PUT', '/api/settings', { playerLogin: true }, c, CSRF)).json.playerLogin, true);
    const asPlayer = await raw('/api/auth/steam/callback?' + assertion(rt0, STEAM, 'b1'));
    assert.equal((await t.req('GET', '/api/me', undefined, asPlayer.cookie)).json.user, `p${STEAM}`);
    const tok2 = (await t.req('POST', '/api/profile/steam-link', {}, c, CSRF)).json.url.split('link=')[1];
    const rt2 = `${host}/api/auth/steam/callback?link=${tok2}`;
    assert.match((await raw(`/api/auth/steam/callback?link=${tok2}&` + assertion(rt2, STEAM, 'b2'))).loc, /steam=linked/);
    assert.equal((await t.req('GET', '/api/me', undefined, asPlayer.cookie)).status, 401);
    const merged = await raw('/api/auth/steam/callback?' + assertion(rt0, STEAM, 'b3'));
    assert.equal((await t.req('GET', '/api/me', undefined, merged.cookie)).json.user, 'alice');
  } finally { t.close(); }
});

test('faceit: key stored privately, lookup by SteamID64 returns ELO and stats', async () => {
  const calls = [];
  const t = await setup({ deps: { httpGet: async (url, headers) => {
    calls.push([url, headers.Authorization]);
    if (/games\/cs2\/stats/.test(url)) return { status: 200, json: { items: Array.from({ length: 14 }, (_x, i) => ({ stats: { Kills: String(14 + (i % 6)), Deaths: String(15 + (i % 4)), Assists: '3', 'Headshots %': '45', Result: i % 2 ? '1' : '0', Map: 'de_mirage', 'Final Score': '13 / 10', ADR: '72' } })) } };
    if (/players\?game=cs2/.test(url)) return { status: 200, json: { player_id: 'pid1', nickname: 'sink333', country: 'ru', faceit_url: 'https://www.faceit.com/{lang}/players/sink333', games: { cs2: { skill_level: 7, faceit_elo: 1400, region: 'EU' } } } };
    return { status: 200, json: { lifetime: { Matches: '120', 'Win Rate %': '55', 'Average K/D Ratio': '1.12', 'Average Headshots %': '48', 'Current Win Streak': '2', 'Longest Win Streak': '7', 'Recent Results': ['0', '0', '0', '1', '0'] },
      segments: [{ label: 'de_mirage', type: 'Map', mode: '5v5', stats: { Matches: '40', 'Win Rate %': '62', 'Average K/D Ratio': '1.3', 'Average Headshots %': '50' } }, { label: 'de_nuke', type: 'Map', mode: '5v5', stats: { Matches: '15', 'Win Rate %': '33', 'Average K/D Ratio': '0.8', 'Average Headshots %': '40' } }, { label: 'de_vertigo', type: 'Map', mode: '5v5', stats: { Matches: '2', 'Win Rate %': '50' } }] } };
  } } });
  try {
    const c = await t.login();
    assert.equal((await t.req('GET', '/api/faceit/76561198000000100', undefined, c)).status, 400); // ключ не задан
    assert.equal((await t.req('PUT', '/api/faceit-key', { key: 'bad key!' }, c, CSRF)).status, 400);
    assert.equal((await t.req('PUT', '/api/faceit-key', { key: 'abcdef0123456789-abcdef' }, c, CSRF)).json.hasKey, true);
    const prof = await t.req('GET', '/api/profile', undefined, c);
    assert.equal(prof.json.faceitKey, true); assert.ok(!JSON.stringify(prof.json).includes('abcdef0123'));
    const r = await t.req('GET', '/api/faceit/76561198000000100', undefined, c);
    assert.equal(r.json.elo, 1400); assert.equal(r.json.level, 7); assert.equal(r.json.stats.kd, '1.12'); assert.equal(r.json.url, 'https://www.faceit.com/en/players/sink333');
    assert.equal(calls[0][1], 'Bearer abcdef0123456789-abcdef');
    assert.equal(r.json.maps[0].map, 'de_mirage'); assert.equal(r.json.maps.length, 3);
    const codes = r.json.analysis.map((x) => x.code);
    for (const c of ['next_level', 'slump', 'best_map', 'worst_map', 'few_map_games']) assert.ok(codes.includes(c), c);
    assert.equal(r.json.analysis.find((x) => x.code === 'worst_map').p.map, 'de_nuke');
    await t.req('GET', '/api/faceit/76561198000000100', undefined, c); assert.equal(calls.length, 3); // кэш: профиль, статистика, история матчей
    assert.equal(r.json.matches.length, 14); assert.equal(r.json.calc.n, 14); assert.ok(r.json.calc.rating > 0 && r.json.calc.adr === 72);
    assert.equal((await t.req('GET', '/api/faceit/abc', undefined, c)).status, 400);
  } finally { t.close(); }
});

test('roles: a Steam player gets only own skins/profile; admin-only routes are closed', async () => {
  const ME = '76561198000000102'; const OTHER = '76561198000000100';
  const t = await setup({ deps: { httpPost: async () => 'is_valid:true\n' } });
  try {
    const host = `http://127.0.0.1:${t.app.server.address().port}`;
    const rt = `${host}/api/auth/steam/callback`;
    const q = (id, n) => new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${id}`,
      'openid.identity': `https://steamcommunity.com/openid/id/${id}`, 'openid.return_to': rt, 'openid.response_nonce': n, 'openid.signed': 'a', 'openid.sig': 'b' });
    const raw = async (p) => { const r = await fetch(host + p, { redirect: 'manual' }); return { loc: r.headers.get('location'), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
    const admin = await t.login();
    const reg = await raw('/api/auth/steam/callback?' + q(ME, 'p1'));
    assert.equal(reg.loc, '/'); assert.match(reg.cookie, /^cs2sid=/);
    const c = reg.cookie;
    const me = (await t.req('GET', '/api/me', undefined, c)).json;
    assert.equal(me.role, 'player'); assert.equal(me.steamid, ME);
    assert.equal((await t.req('GET', '/api/me', undefined, admin)).json.role, 'admin');
    // разрешено: свои скины, профиль, инфо о сервере
    assert.equal((await t.req('GET', `/api/skins/loadout/${ME}`, undefined, c)).status, 200);
    assert.equal((await t.req('POST', `/api/skins/apply/${ME}`, { ops: [] }, c, CSRF)).status, 200);
    assert.equal((await t.req('GET', '/api/public-info', undefined, c)).status, 200);
    assert.equal((await t.req('PUT', '/api/profile', { email: 'p@example.com', links: [{ title: 'x', url: 'https://a.b' }] }, c, CSRF)).json.links.length, 0);
    // запрещено: чужие скины и всё серверное
    for (const [m, p, b] of [['GET', `/api/skins/loadout/${OTHER}`], ['POST', `/api/skins/apply/${OTHER}`, { ops: [] }], ['GET', '/api/skins/players'], ['GET', '/api/overview'], ['GET', '/api/state'],
      ['PUT', '/api/state', { state: {} }], ['POST', '/api/rcon', { command: 'status' }], ['POST', '/api/vm/start', {}], ['POST', '/api/vm/stop', {}], ['PUT', '/api/settings', { playerLogin: true }],
      ['POST', '/api/password', { oldPassword: 'x', newPassword: 'yyyyyyyyyyyy' }], ['PUT', '/api/custom-skins', { skins: [] }], ['GET', '/api/audit'], ['PUT', '/api/faceit-key', { key: 'abcdef0123456789' }], ['POST', '/api/service/restart', {}]]) {
      const r = await t.req(m, p, b, c, CSRF); assert.equal(r.status, 403, `${m} ${p}`);
    }
    assert.ok(!t.calls.some((x) => /stop|start|rcon/.test(x)));
    // отключённая регистрация: новый игрок не создаётся
    await t.req('PUT', '/api/settings', { playerLogin: false }, admin, CSRF);
    assert.match((await raw('/api/auth/steam/callback?' + q(OTHER, 'p2'))).loc, /steam=unlinked/);
    // уже зарегистрированный игрок по-прежнему входит
    assert.equal((await raw('/api/auth/steam/callback?' + q(ME, 'p3'))).loc, '/');
  } finally { t.close(); }
});

test('brand: public name/logo, admin-only changes, strict logo validation', async () => {
  const t = await setup();
  try {
    const pub = await t.req('GET', '/api/brand');
    assert.equal(pub.status, 200); assert.equal(pub.json.name, 'sandbox-cs-1'); assert.equal(pub.json.logo, '');
    assert.equal((await t.req('PUT', '/api/brand', { name: 'X' })).status, 401);
    const c = await t.login();
    assert.equal((await t.req('PUT', '/api/brand', { name: '<b>' }, c, CSRF)).status, 400);
    assert.equal((await t.req('PUT', '/api/brand', { name: 'Мой сервер', tagline: 'Для своих' }, c, CSRF)).json.name, 'Мой сервер');
    assert.equal((await t.req('POST', '/api/brand/logo', { dataUrl: 'data:text/html;base64,PGI+' }, c, CSRF)).status, 400);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const up = await t.req('POST', '/api/brand/logo', { dataUrl: png }, c, CSRF);
    assert.match(up.json.logo, /^\/brand-logo\?v=\d+$/);
    const r = await fetch(`http://127.0.0.1:${t.app.server.address().port}/brand-logo`);
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png'); assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.equal((await t.req('GET', '/api/brand')).json.name, 'Мой сервер');
    assert.equal((await t.req('PUT', '/api/brand', { removeLogo: true }, c, CSRF)).json.logo, '');
  } finally { t.close(); }
});

test('stats: proxied from the agent, cached for offline, per-player route validates the SteamID', async () => {
  let up = true;
  const t = await setup({ agentImpl: async (m, p) => { if (!up) throw new Error('fetch failed'); if (p.startsWith('/stats')) return { since: 'x', map: 'de_dust2', players: [{ steamid: '76561198000000100', name: 'a', kills: 3 }, { steamid: '76561198000000102', name: 'b', kills: 1 }], maps: [] }; return { ok: true }; } });
  try {
    const c = await t.login();
    assert.equal((await t.req('GET', '/api/stats', undefined, c)).json.players.length, 2);
    up = false;
    const off = await t.req('GET', '/api/stats', undefined, c);
    assert.equal(off.json.offline, true); assert.equal(off.json.players.length, 2);
    const one = await t.req('GET', '/api/stats/76561198000000102', undefined, c);
    assert.equal(one.json.players.length, 1); assert.equal(one.json.players[0].name, 'b');
    assert.equal((await t.req('GET', '/api/stats/abc', undefined, c)).status, 400);
  } finally { t.close(); }
});

test('Steam login: автопривязка по списку админов сервера и ник из Steam', async () => {
  const STEAM = '76561198000000100';
  const xml = (n) => `<?xml version="1.0"?><profile><steamID64>${STEAM}</steamID64><steamID><![CDATA[${n}]]></steamID><avatarFull><![CDATA[https://avatars.steamstatic.com/abc123_full.jpg]]></avatarFull></profile>`;
  let nick = 'sink333';
  const t = await setup({ deps: { httpPost: async () => 'is_valid:true\n', httpGet: async () => ({ status: 200, json: null, text: xml(nick) }) } });
  try {
    const host = `http://127.0.0.1:${t.app.server.address().port}`;
    const raw = async (p) => { const r = await fetch(host + p, { redirect: 'manual' }); return { loc: r.headers.get('location') || '', cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
    const cb = (n) => `/api/auth/steam/callback?` + new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM}`, 'openid.identity': `https://steamcommunity.com/openid/id/${STEAM}`, 'openid.return_to': `${host}/api/auth/steam/callback`, 'openid.response_nonce': n, 'openid.assoc_handle': 'x', 'openid.signed': 'a', 'openid.sig': 'b' });
    const c = await t.login();
    await t.req('PUT', '/api/settings', { playerLogin: false }, c, CSRF);
    // админа нет в списке сервера → не привязываем
    assert.match((await raw(cb('n1'))).loc, /steam=unlinked/);
    // админ есть в списке, имя совпадает с панельным логином → привязка и вход с правами админа
    fs.writeFileSync(path.join(t.dir, 'state-cache.json'), JSON.stringify({ state: { admins: [{ name: 'Alice', steamid: STEAM, flags: ['@css/root'] }] }, pending: [] }));
    const l = await raw(cb('n2'));
    assert.equal(l.loc, '/'); assert.match(l.cookie, /^cs2sid=/);
    const me = (await t.req('GET', '/api/me', undefined, l.cookie)).json;
    assert.equal(me.user, 'alice'); assert.equal(me.role, 'admin'); assert.equal(me.steamid, STEAM);
    assert.equal(me.displayName, 'sink333'); assert.match(me.avatar, /^https:\/\/avatars\.steamstatic\.com\//);
    // ник обновляется при следующем входе
    nick = 'sink333 pro';
    const l2 = await raw(cb('n3'));
    assert.equal((await t.req('GET', '/api/me', undefined, l2.cookie)).json.displayName, 'sink333 pro');
    // скрытый/недоступный профиль не ломает вход
    const parsed = require('../lib/account').parseSteamProfileXml('<profile></profile>'); assert.equal(parsed, null);
    assert.equal(require('../lib/account').parseSteamProfileXml(xml('<b>x</b>')).name, 'bx/b');
    // Steam отдаёт аватары с разных CDN (akamai, fastly, cloudflare), чужие хосты отбрасываются
    const av = (host) => require('../lib/account').parseSteamProfileXml(`<profile><steamID><![CDATA[n]]></steamID><avatarFull><![CDATA[https://${host}/e52d41c6_full.jpg]]></avatarFull></profile>`).avatar;
    assert.match(av('avatars.fastly.steamstatic.com'), /^https:\/\/avatars\.fastly/); assert.match(av('avatars.cloudflare.steamstatic.com'), /cloudflare/); assert.equal(av('evil.example'), '');
  } finally { t.close(); }
});

test('vote: admin starts, players vote, winner is applied via agent /map once; players cannot start/stop', async () => {
  let clock = 5_000_000;
  const t = await setup({ deps: { now: () => clock } });
  try {
    const uf = path.join(t.dir, 'users.json'); const U = JSON.parse(fs.readFileSync(uf, 'utf8'));
    U.users.tester = { hash: hashPassword('hunter2hunter2'), role: 'player' }; fs.writeFileSync(uf, JSON.stringify(U));
    const admin = await t.login();
    const ply = (await t.req('POST', '/api/login', { username: 'tester', password: 'hunter2hunter2' })).cookie;
    assert.equal((await t.req('GET', '/api/vote', undefined, ply)).json.active, false);
    assert.equal((await t.req('POST', '/api/vote/start', { options: ['de_dust2', 'de_mirage'], minutes: 2 }, ply, CSRF)).status, 403);
    assert.equal((await t.req('POST', '/api/vote/start', { options: ['de_dust2'], minutes: 2 }, admin, CSRF)).status, 400);
    const st = await t.req('POST', '/api/vote/start', { options: ['de_dust2', 'de_mirage', 'de_nuke'], minutes: 2 }, admin, CSRF);
    assert.equal(st.status, 200); assert.equal(st.json.active, true); assert.equal(st.json.options[1].label, 'Mirage');
    assert.equal((await t.req('POST', '/api/vote/start', { options: ['de_dust2', 'de_mirage'], minutes: 2 }, admin, CSRF)).status, 409);
    assert.equal((await t.req('POST', '/api/vote/cast', { option: 'de_inferno' }, ply, CSRF)).status, 400);
    assert.equal((await t.req('POST', '/api/vote/cast', { option: 'de_mirage' }, ply, CSRF)).json.myVote, 'de_mirage');
    await t.req('POST', '/api/vote/cast', { option: 'de_mirage' }, admin, CSRF);
    assert.equal((await t.req('POST', '/api/vote/stop', {}, ply, CSRF)).status, 403);
    clock += 121_000;
    const done = await t.req('GET', '/api/vote', undefined, ply);
    assert.equal(done.json.finished, true); assert.equal(done.json.winner, 'de_mirage');
    await t.req('GET', '/api/vote', undefined, admin);
    assert.equal(t.calls.filter((c) => c === 'POST /map').length, 1); // карта применена ровно один раз
  } finally { t.close(); }
});

test('player start: off by default; when allowed, limited per player per day; already running is a no-op', async () => {
  let clock = 9_000_000;
  const t = await setup({ vmStatus: 'STOPPED', deps: { now: () => clock } });
  try {
    const uf = path.join(t.dir, 'users.json'); const U = JSON.parse(fs.readFileSync(uf, 'utf8'));
    U.users.tester = { hash: hashPassword('hunter2hunter2'), role: 'player' }; fs.writeFileSync(uf, JSON.stringify(U));
    const admin = await t.login();
    const ply = (await t.req('POST', '/api/login', { username: 'tester', password: 'hunter2hunter2' })).cookie;
    assert.equal((await t.req('GET', '/api/public-info', undefined, ply)).json.playerStart, false);
    assert.equal((await t.req('POST', '/api/vm/request-start', {}, ply, CSRF)).status, 403); // по умолчанию выключено
    assert.equal((await t.req('POST', '/api/vm/start', {}, ply, CSRF)).status, 403); // прямой админский запуск игроку по-прежнему закрыт
    assert.equal((await t.req('PUT', '/api/settings', { playerStart: true }, admin, CSRF)).json.playerStart, true);
    assert.equal((await t.req('GET', '/api/public-info', undefined, ply)).json.playerStart, true);
    const r = await t.req('POST', '/api/vm/request-start', {}, ply, CSRF);
    assert.equal(r.status, 200); assert.equal(r.json.status, 'STARTING'); assert.equal(t.calls.filter((c) => c === 'yc.start').length, 1);
    assert.equal((await t.req('POST', '/api/vm/request-start', {}, ply, CSRF)).json.status, 'STARTING'); // уже запускается: без нового запуска
    assert.equal(t.calls.filter((c) => c === 'yc.start').length, 1);
    for (let i = 0; i < 2; i += 1) { t.vm.status = 'STOPPED'; clock += 60_000; assert.equal((await t.req('POST', '/api/vm/request-start', {}, ply, CSRF)).status, 200); }
    t.vm.status = 'STOPPED'; clock += 60_000;
    assert.equal((await t.req('POST', '/api/vm/request-start', {}, ply, CSRF)).status, 429); // 4-й запуск за сутки
    clock += 25 * 3600_000; t.vm.status = 'STOPPED';
    assert.equal((await t.req('POST', '/api/vm/request-start', {}, ply, CSRF)).status, 200); // через сутки снова можно
  } finally { t.close(); }
});
