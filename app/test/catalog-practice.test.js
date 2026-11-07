'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCatalog, CatalogCache } = require('../lib/catalog');
const P = require('../lib/practice');

const skin = (id, wid, cat, paint, name) => ({ weapon: { id, weapon_id: wid, name: id }, category: { name: cat }, paint_index: paint, pattern: { name }, rarity: { name: 'Covert', color: '#eb4b4b' }, min_float: 0, max_float: 1, stattrak: true, image: `https://community.akamai.steamstatic.com/economy/image/${name}` });
const SRC = {
  skins: [skin('weapon_ak47', 7, 'Rifles', '282', 'Redline'), skin('weapon_knife_karambit', 507, 'Knives', null, 'x'), skin('sfui_wpnhud_knifekaram', 507, 'Knives', null, 'y'), skin('weapon_ak47', 7, 'Rifles', '282', 'dup')],
  agents: [{ def_index: '4613', name: 'A', team: { id: 'terrorists' }, model_player: 'agents/models/tm_professional/tm_professional_varf5.vmdl', image: 'i', rarity: { name: 'Covert' } }, { def_index: '1', name: 'bad' }],
  music: [{ def_index: '3', name: 'M', image: 'https://cdn.steamstatic.com/a.png' }],
};

test('buildCatalog compacts, dedupes and keeps vanilla knives', () => {
  const c = buildCatalog(SRC);
  assert.equal(c.skins.length, 2);
  assert.deepEqual(c.skins[0], [282, 0, 'Redline', 0, 0, 1, 1, 'Redline']);
  assert.equal(c.skins[1][0], 0);
  assert.equal(c.weapons[1].kind, 'knife');
  assert.equal(c.agents.length, 1);
  assert.equal(c.agents[0].team, 't');
  assert.equal(c.music[0].img, 'https://cdn.steamstatic.com/a.png');
});

test('CatalogCache caches on disk, serves stale data on failure, 503 without any', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
  let calls = 0; let fail = false; let t = 1000;
  const fetchJson = async (url) => { calls += 1; if (fail) throw new Error('offline'); return SRC[/\/(\w+)\.json$/.exec(url)[1].replace('music_kits', 'music')]; };
  const file = path.join(dir, 'c.json');
  const cache = new CatalogCache({ file, fetchJson, now: () => t, ttlMs: 100 });
  await cache.get(); await cache.get();
  assert.equal(calls, 4);
  assert.equal(new CatalogCache({ file, fetchJson, now: () => t, ttlMs: 100 }).mem, null);
  await new CatalogCache({ file, fetchJson, now: () => t, ttlMs: 100 }).get();
  assert.equal(calls, 4, 'fresh disk cache is reused');
  t += 500; fail = true;
  assert.equal((await cache.get()).skins.length, 2, 'stale on failure');
  fs.rmSync(file);
  await assert.rejects(new CatalogCache({ file, fetchJson, now: () => t, ttlMs: 100 }).get(), (e) => e.status === 503);
});

test('practice commands are validated', () => {
  assert.deepEqual(P.buildCommands('bot-add', { team: 'ct', count: 2 }), ['bot_add_ct', 'bot_add_ct']);
  assert.deepEqual(P.buildCommands('bot-kick', {}), ['bot_kick']);
  assert.deepEqual(P.buildCommands('bot-difficulty', { level: 3 }), ['bot_difficulty "3"']);
  assert.throws(() => P.buildCommands('bot-add', { count: 99 }), /count/);
  assert.throws(() => P.buildCommands('say', { text: 'hi; quit' }), /say/);
  assert.throws(() => P.buildCommands('cvars', { pairs: { 'sv_cheats; quit': '1' } }), /bad cvar/);
  assert.throws(() => P.buildCommands('cvars', { pairs: { sv_cheats: '1"; quit' } }), /bad value/);
  assert.throws(() => P.buildCommands('rm -rf', {}), /unknown/);
  assert.equal(P.buildCommands('fun', { id: 'slowmo' })[0], 'sv_cheats "1"');
  assert.ok(P.buildCommands('fun', { id: 'reset' }).includes('sv_gravity "800"'));
  assert.equal(P.parseCvarOutput('sv_cheats', '"sv_cheats" = "1" ( def. "0" )'), '1');
});

test('buildCatalog: картинка «голого» оружия из base_weapons, без неё — поле не создаётся', () => {
  const c = buildCatalog({ ...SRC, base: [{ def_index: 7, image: 'https://community.akamai.steamstatic.com/economy/image/AKvanilla', name: 'AK-47' }, { def_index: 999, image: 'x' }, { def_index: 'bad' }] });
  assert.equal(c.weapons[0].img, 'AKvanilla'); assert.equal(c.weapons[1].img, undefined);
  assert.equal(buildCatalog(SRC).weapons[0].img, undefined);
});

test('practice: animals — chicken spawn, pig/cow cosplay, validation', () => {
  const c = P.buildCommands('animal', { kind: 'chicken', count: 3 });
  assert.deepEqual(c, ['sv_cheats "1"', 'ent_create chicken', 'ent_create chicken', 'ent_create chicken']);
  const pig = P.buildCommands('animal', { kind: 'pig', count: 1 });
  assert.ok(pig.includes('ent_fire chicken color "255 150 175"')); assert.ok(pig.some((x) => /modelscale 2\.2/.test(x)));
  assert.deepEqual(P.buildCommands('animal-clear'), ['ent_fire chicken kill']);
  assert.throws(() => P.buildCommands('animal', { kind: 'dragon' })); assert.throws(() => P.buildCommands('animal', { kind: 'cow', count: 99 }));
});

test('presets: curated workshop map catalog has valid ids and known categories', () => {
  const { WORKSHOP_MAPS, WORKSHOP_CATS } = require('../lib/presets');
  assert.ok(WORKSHOP_MAPS.length >= 10);
  for (const w of WORKSHOP_MAPS) { assert.match(w.id, /^\d{6,12}$/); assert.ok(WORKSHOP_CATS[w.cat], w.cat); assert.ok(w.label && w.note); }
  assert.equal(new Set(WORKSHOP_MAPS.map((w) => w.id)).size, WORKSHOP_MAPS.length);
});

test('музыкальные наборы: двойники StatTrak™ с тем же def_index убраны', () => {
  const { buildCatalog } = require('../lib/catalog');
  const mk = (id, name, def) => ({ id, name, def_index: String(def), image: 'https://cdn.steamstatic.com/apps/730/icons/x.png' });
  const cat = buildCatalog({ music: [mk('music_kit-3', 'Daniel Sadowski, Crimson Assault', 3), mk('music_kit-3_st', 'StatTrak™ Music Kit | Daniel Sadowski, Crimson Assault', 3), mk('music_kit-4', 'Noisia, Sharpened', 4)] });
  assert.deepEqual(cat.music.map((m) => m.id), [3, 4]);
  assert.ok(cat.music.every((m) => !/stattrak/i.test(m.name)));
});

test('зомби-осада: порядок команд и лимит батча агента (≤25)', () => {
  const on = P.buildCommands('zombies', { count: 12, difficulty: 3 });
  assert.ok(on.length <= 25, `команд: ${on.length}`);
  assert.ok(on.indexOf('css_exitprac') < on.indexOf('bot_quota "12"'), 'сначала выход из практики');
  assert.ok(on.includes('mp_humanteam "CT"') && on.includes('bot_knives_only "1"') && on.includes('bot_difficulty "3"'));
  assert.equal(on[on.length - 1], 'mp_restartgame 3');
  const off = P.buildCommands('zombies', { stop: true });
  assert.ok(off.includes('bot_quota "0"') && off.includes('mp_humanteam "any"'));
  assert.throws(() => P.buildCommands('zombies', { count: 99 }));
});
