'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { faceitCalc, analyzeFaceit } = require('../lib/account');

const mk = (i, over = {}) => ({ stats: { Kills: '20', Deaths: '15', Assists: '4', 'Headshots %': '50', Result: i % 2 ? '1' : '0', Map: 'de_inferno', 'Final Score': '13 / 9', ADR: '85', 'Triple Kills': '1', ...over } });

test('faceitCalc: aggregates, HLTV 1.0 rating, ETA to next level', () => {
  const r = faceitCalc(Array.from({ length: 20 }, (_x, i) => mk(i)), { level: 5, elo: 1100 });
  assert.equal(r.summary.n, 20); assert.equal(r.summary.winRate, 50); assert.equal(r.summary.kd, 1.33); assert.equal(r.summary.adr, 85);
  assert.ok(r.summary.rating >= 1.0 && r.summary.rating < 1.6, String(r.summary.rating));
  assert.equal(r.summary.eloNeed, 101); assert.equal(r.summary.eloToDrop, 49);
  assert.equal(r.matches.length, 20); assert.equal(r.matches[0].score, '13 / 9');
});

test('faceitCalc: empty/garbage input is safe; analysis adds trend and ADR tips', () => {
  assert.equal(faceitCalc([], {}), null); assert.equal(faceitCalc([{ stats: {} }, null], {}), null);
  const items = [...Array.from({ length: 10 }, (_x, i) => mk(i, { Kills: '25', Deaths: '10' })), ...Array.from({ length: 12 }, (_x, i) => mk(i, { Kills: '12', Deaths: '18', ADR: '55' }))];
  const calc = faceitCalc(items, { level: 4, elo: 920 }).summary;
  const codes = analyzeFaceit({ found: true, level: 4, elo: 920, stats: { kd: '1', hs: '45', winRate: '50', matches: '200', recent: [] }, maps: [], calc }).map((t) => t.code);
  assert.ok(codes.includes('trend_up')); assert.ok(codes.includes('inconsistent'));
});
