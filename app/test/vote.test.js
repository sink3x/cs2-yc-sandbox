'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVote } = require('../lib/vote');

const mk = () => { let t = 1_000_000; const vote = createVote({ now: () => t }); return { vote, tick: (ms) => { t += ms; } }; };
const O = ['de_dust2', 'de_mirage', 'de_nuke'];

test('vote: старт валидирует карты и срок', () => {
  const { vote } = mk();
  assert.throws(() => vote.start({ options: ['de_dust2'] }), /needs 2-6/);
  assert.throws(() => vote.start({ options: ['de_dust2', 'de_dust2'] }), /needs 2-6/); // дубли схлопываются
  assert.throws(() => vote.start({ options: ['de_dust2', 'bad map;quit'] }), /bad map/);
  assert.throws(() => vote.start({ options: O, minutes: 0 }), /minutes/);
  assert.throws(() => vote.start({ options: O, minutes: 31 }), /minutes/);
  assert.throws(() => vote.start({ options: Array.from({ length: 7 }, (_, i) => `de_m${i}`) }), /needs 2-6/);
  assert.ok(vote.start({ options: [...O, '3070212801'], minutes: 2 }));
  assert.throws(() => vote.start({ options: O }), /already running/);
});

test('vote: один голос на аккаунт, голос можно сменить, итог по большинству', () => {
  const { vote, tick } = mk(); vote.start({ options: O, minutes: 1 });
  vote.cast('a', 'de_mirage'); vote.cast('b', 'de_mirage'); vote.cast('c', 'de_nuke'); vote.cast('c', 'de_dust2'); vote.cast('d', 'de_dust2');
  assert.throws(() => vote.cast('e', 'de_inferno'), /unknown option/);
  let w = vote.view('a'); assert.equal(w.total, 4); assert.equal(w.myVote, 'de_mirage'); assert.deepEqual(w.options.map((o) => o.votes), [2, 2, 0]); assert.ok(w.active);
  tick(61_000);
  w = vote.view('a'); assert.ok(w.finished && !w.active); assert.equal(w.winner, 'de_dust2'); // ничья 2:2 → раньше в списке
  assert.throws(() => vote.cast('f', 'de_nuke'), /no active vote/);
  const p = vote.takePending(); assert.equal(p.winner, 'de_dust2'); assert.equal(vote.takePending(), null); // применяется один раз
});

test('vote: без голосов победителя нет; досрочная остановка; итог исчезает через 10 минут', () => {
  const { vote, tick } = mk(); vote.start({ options: O, minutes: 1, auto: true });
  assert.equal(vote.stop().winner, null); assert.equal(vote.takePending(), null);
  assert.equal(vote.view(null).finished, true);
  tick(10 * 60_000 + 1); assert.deepEqual(vote.view(null), { active: false, finished: false });
  vote.start({ options: O, minutes: 1, auto: false }); vote.cast('a', 'de_nuke'); vote.stop();
  assert.equal(vote.takePending(), null); // auto=false: карту не меняем сами
});
