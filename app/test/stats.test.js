'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine, Stats, toSteam64 } = require('../agent/stats');

const A = '"sink333<2><[U:1:39734372]><CT>"'; const B = '"bob<3><[U:1:39734374]><TERRORIST>"'; const BOT = '"Dave<4><BOT><TERRORIST>"';

test('SteamID conversion', () => {
  assert.equal(toSteam64('[U:1:39734372]'), '76561198000000100');
  assert.equal(toSteam64('STEAM_0:0:19867186'), '76561198000000100');
  assert.equal(toSteam64('BOT'), null);
});

test('parseLine understands CS2 log lines', () => {
  const k = parseLine(`L 11/07/2026 - 09:12:33: ${A} [-1 2 3] killed ${B} [4 5 6] with "ak47" (headshot)`);
  assert.equal(k.t, 'kill'); assert.equal(k.a.id, '76561198000000100'); assert.equal(k.v.name, 'bob'); assert.equal(k.weapon, 'ak47'); assert.equal(k.hs, true);
  const a = parseLine(`L 11/07/2026 - 09:12:33: ${A} [1 2 3] attacked ${BOT} [4 5 6] with "awp" (damage "100") (damage_armor "0") (health "0") (armor "0") (hitgroup "chest")`);
  assert.equal(a.t, 'attack'); assert.equal(a.damage, 100); assert.equal(a.hitgroup, 'chest'); assert.equal(a.v.bot, true);
  assert.equal(parseLine(`L x: ${A} threw hegrenade [1 2 3]`).kind, 'hegrenade');
  assert.equal(parseLine('Started map "de_mirage"').map, 'de_mirage');
  assert.equal(parseLine('L x: World triggered "Round_End"').t, 'round');
  assert.equal(parseLine('random console noise'), null);
});

test('Stats aggregates kills, damage, grenades, playtime per map', () => {
  let t = 1_000_000; const s = new Stats({ now: () => t });
  s.feed('Started map "de_dust2"');
  s.feed(`L x: ${A} entered the game`); t += 60_000;
  s.feed(`L x: ${B} entered the game`); t += 60_000;
  s.feed(`L x: ${A} [1 2 3] attacked ${B} [4 5 6] with "ak47" (damage "27") (damage_armor "5") (health "73") (armor "95") (hitgroup "head")`);
  s.feed(`L x: ${A} [1 2 3] killed ${B} [4 5 6] with "ak47" (headshot)`);
  s.feed(`L x: ${A} [1 2 3] killed ${BOT} [4 5 6] with "ak47"`);
  s.feed(`L x: ${BOT} [1 2 3] killed ${A} [4 5 6] with "glock"`);
  s.feed(`L x: ${A} threw flashbang [1 2 3]`); s.feed(`L x: ${A} threw smokegrenade [1 2 3]`); s.feed(`L x: ${A} threw hegrenade [1 2 3]`);
  s.feed('L x: World triggered "Round_End"');
  t += 60_000;
  s.feed(`L x: ${B} disconnected (reason "x")`);
  const sum = s.summary();
  const a = sum.players.find((p) => p.name === 'sink333'); const b = sum.players.find((p) => p.name === 'bob');
  assert.equal(a.kills, 2); assert.equal(a.deaths, 1); assert.equal(a.headshots, 1); assert.equal(a.hsPct, 50); assert.equal(a.damage, 27); assert.deepEqual(a.grenades, { flash: 1, smoke: 1, he: 1 });
  assert.equal(a.seconds, 180); assert.equal(a.online, true); // ещё в игре — считается до «сейчас»
  assert.equal(b.deaths, 1); assert.equal(b.seconds, 120); assert.equal(b.online, false);
  assert.equal(sum.maps[0].map, 'de_dust2'); assert.equal(sum.maps[0].rounds, 1); assert.equal(sum.maps[0].kills, 2);
  assert.equal(a.maps.de_dust2.kills, 2);
  assert.equal(s.summary('76561198000000100').players.length, 1);
  // смена карты закрывает сессию и открывает новую
  t += 30_000; s.feed('Started map "de_mirage"'); t += 30_000;
  assert.equal(s.summary().players.find((p) => p.name === 'sink333').seconds, 240);
  assert.equal(s.data.players['76561198000000100'].maps.de_dust2.seconds, 210);
});

test('позиции убийств и смертей → тепловая карта по клеткам', () => {
  const POSA = `${A} [-1200.5 340 -64]`; const POSB = `${B} [800 -500 12]`;
  const e = parseLine(`L 11/07/2026 - 12:00:00: ${POSA} killed ${POSB} with "ak47" (headshot)`);
  assert.deepEqual(e.ap, [-1200.5, 340]); assert.deepEqual(e.vp, [800, -500]); assert.equal(e.hs, true); assert.equal(e.weapon, 'ak47');
  const att = parseLine(`L 11/07/2026 - 12:00:00: ${POSA} attacked ${POSB} with "ak47" (damage "27") (damage_armor "0") (health "73") (armor "0") (hitgroup "head")`);
  assert.equal(att.damage, 27); assert.equal(att.hitgroup, 'head');
  const t = parseLine(`L x: ${POSA} threw smokegrenade [1 2 3]`); assert.equal(t.kind, 'smokegrenade');
  const s = new Stats({ now: () => 0 });
  s.apply({ t: 'map', map: 'de_mirage' });
  for (let i = 0; i < 3; i++) s.apply(parseLine(`L: ${POSA} killed ${POSB} with "ak47"`));
  s.apply(parseLine(`L: ${POSB} killed ${POSA} with "awp"`));
  const sum = s.summary('76561198000000100'); const p = sum.players[0];
  assert.equal(p.cell, 256);
  assert.deepEqual(p.heat.de_mirage['-5,1'], [3, 1]); // убивал 3 раза из клетки (-1200,340), умер 1 раз там же
  assert.equal(s.summary().players[0].heat, undefined, 'в общем списке тепловой карты нет');
  // записи без позиции не ломают разбор
  assert.equal(parseLine(`L: ${A} killed ${B} with "ak47"`).ap, null);
});
