'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, Sessions, FailureLimiter, parseCookies } = require('../lib/auth');

test('password hashing verifies and is salted', () => {
  const a = hashPassword('correct horse battery');
  const b = hashPassword('correct horse battery');
  assert.notEqual(a, b);
  assert.ok(verifyPassword('correct horse battery', a));
  assert.ok(!verifyPassword('wrong', a));
  assert.ok(!verifyPassword('x', 'garbage'));
});

test('sessions expire and can be revoked per user', () => {
  let t = 0;
  const s = new Sessions({ ttlMs: 1000, now: () => t });
  const id = s.create('a'); const id2 = s.create('a'); s.create('b');
  assert.equal(s.get(id).user, 'a');
  s.destroyUser('a', id2);
  assert.equal(s.get(id), null);
  assert.ok(s.get(id2));
  t = 2000;
  assert.equal(s.get(id2), null);
});

test('failure limiter blocks after max failures and recovers after the window', () => {
  let t = 0;
  const l = new FailureLimiter({ max: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 3; i++) l.fail('ip');
  assert.ok(l.blocked('ip'));
  t = 1500;
  assert.ok(!l.blocked('ip'));
  l.fail('ip'); l.reset('ip');
  assert.ok(!l.blocked('ip'));
});

test('parseCookies', () => {
  assert.deepEqual(parseCookies('a=1; cs2sid=ab%20c'), { a: '1', cs2sid: 'ab c' });
});

test('сессии: скользящее продление, потолок срока и переживают перезапуск', () => {
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sess-')), 'sessions.json');
  let t = 0; const H = 3600_000; const D = 24 * H;
  const mk = () => new Sessions({ ttlMs: 30 * D, absMs: 90 * D, file, now: () => t });
  const s = mk(); const id = s.create('a', { via: 'steam' });
  t = 20 * D; const got = s.get(id); assert.ok(got); assert.ok(s.takeRenewed(got)); assert.equal(s.takeRenewed(got), false); // продлена до 50-го дня
  assert.ok(s.maxAgeSec(got) > 29 * 86400);
  t = 45 * D; assert.ok(s.get(id), 'активная сессия живёт дольше исходных 30 дней');
  // перезапуск: новая копия читает файл (flush вручную — в бою его делает таймер)
  fs.writeFileSync(file, JSON.stringify({ sessions: Object.fromEntries(s.map) }));
  const s2 = mk(); assert.equal(s2.get(id).user, 'a'); assert.equal(s2.get(id).via, 'steam');
  assert.ok(!JSON.stringify(fs.readFileSync(file, 'utf8')).includes(id), 'токен на диск не пишется');
  t = 100 * D; assert.equal(s2.get(id), null, 'потолок 90 дней от входа');
});
