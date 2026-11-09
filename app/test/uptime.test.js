'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUptime, MAX_GAP_MS } = require('../lib/uptime');

const mem = () => { let v = null; return { readJson: () => v, writeJsonAtomic: (_f, d) => { v = JSON.parse(JSON.stringify(d)); } }; };
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0); // 2026-11-09 12:00 UTC

test('uptime: считает время между опросами, пока ВМ работает', () => {
  let t = T0; const u = createUptime({ file: 'x', ...mem(), now: () => t });
  u.observe('RUNNING');
  t += 60_000; u.observe('RUNNING');
  t += 60_000; u.observe('STOPPED');
  t += 60_000; u.observe('STOPPED'); // остановлена — не считаем
  const s = u.summary();
  assert.equal(s.today, Math.round((120 / 3600) * 100) / 100);
  assert.equal(s.series.length, 14);
  assert.equal(s.series.at(-1).day, '2026-11-09');
});

test('uptime: большой провал между опросами не засчитывается целиком', () => {
  let t = T0; const u = createUptime({ file: 'x', ...mem(), now: () => t });
  u.observe('RUNNING');
  t += 3 * 3600_000; u.observe('RUNNING'); // панель молчала 3 часа
  assert.ok(u.summary().today * 3600 <= MAX_GAP_MS / 1000 + 1);
});

test('uptime: переход через полночь UTC делится между сутками, данные переживают перезапуск', () => {
  const store = mem(); let t = Date.UTC(2026, 10, 9, 23, 59, 0);
  const u = createUptime({ file: 'x', ...store, now: () => t });
  u.observe('RUNNING');
  t += 120_000; u.observe('RUNNING'); // 23:59 → 00:01
  const u2 = createUptime({ file: 'x', ...store, now: () => t });
  const s = u2.summary();
  const byDay = Object.fromEntries(s.series.map((d) => [d.day, d.hours]));
  assert.equal(byDay['2026-11-09'], Math.round((60 / 3600) * 100) / 100);
  assert.equal(byDay['2026-11-10'], Math.round((60 / 3600) * 100) / 100);
  assert.ok(s.month > 0);
});
