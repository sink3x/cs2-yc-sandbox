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
