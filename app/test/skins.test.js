'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOps, buildSql, parseTsv, parseOnlinePlayers, createSkinsService } = require('../agent/skins');

const ID = '76561198000000100';
const col = (name, type = 'int(11)', extra = {}) => ({ name, type, nullable: false, def: null, auto: false, ...extra });
const SCHEMA = {
  wp_player_skins: [col('steamid', 'varchar(18)'), col('weapon_team'), col('weapon_defindex'), col('weapon_paint_id'), col('weapon_wear', 'float'), col('weapon_seed'),
    col('weapon_nametag', 'varchar(128)', { nullable: true }), col('weapon_stattrak', 'tinyint', { def: '0' }), col('weapon_stattrak_count', 'int', { def: '0' }), col('weapon_sticker_0', 'varchar(128)')],
  wp_player_knife: [col('steamid', 'varchar(18)'), col('weapon_team'), col('knife', 'varchar(64)')],
  wp_player_gloves: [col('steamid', 'varchar(18)'), col('weapon_team'), col('weapon_defindex')],
  wp_player_agents: [col('steamid', 'varchar(18)'), col('agent_ct', 'varchar(128)', { nullable: true }), col('agent_t', 'varchar(128)', { nullable: true })],
  wp_player_music: [col('steamid', 'varchar(18)'), col('weapon_team'), col('music_id')],
  wp_player_pins: null,
};

test('validateOps rejects bad input', () => {
  assert.throws(() => validateOps([]), /ops/);
  assert.throws(() => validateOps([{ op: 'skin', def: 7, paint: 282, wear: 2 }]), /wear/);
  assert.throws(() => validateOps([{ op: 'skin', def: 7, paint: 282, nametag: "x'; DROP TABLE y;--" }]), /nametag/);
  assert.throws(() => validateOps([{ op: 'knife', knife: "weapon_knife'x" }]), /knife/);
  assert.throws(() => validateOps([{ op: 'agents', ct: '../../etc/passwd' }]), /agents/);
  assert.throws(() => validateOps([{ op: 'drop' }]), /unknown op/);
  assert.throws(() => validateOps([{ op: 'unskin', def: 7, teams: [1] }]), /team/);
});

test('skin op becomes an upsert per team, filling unknown NOT NULL columns', () => {
  const sql = buildSql(ID, validateOps([{ op: 'skin', def: 7, paint: 282, wear: 0.07, seed: 42, nametag: 'Мой AK', stattrak: true }]), SCHEMA);
  assert.equal(sql.length, 2);
  assert.match(sql[0], /^INSERT INTO wp_player_skins \(steamid, weapon_team, weapon_defindex, weapon_paint_id, weapon_wear, weapon_seed, weapon_nametag, weapon_stattrak, weapon_stattrak_count, weapon_sticker_0\)/);
  assert.match(sql[0], /VALUES \('76561198000000100', 2, 7, 282, 0\.07, 42, 'Мой AK', 1, 0, ''\)/);
  assert.match(sql[1], /, 3, 7,/);
  assert.match(sql[0], /ON DUPLICATE KEY UPDATE weapon_paint_id=VALUES\(weapon_paint_id\)/);
  assert.doesNotMatch(sql[0], /UPDATE [^V]*steamid=VALUES/);
});

test('paint 0 and unskin delete rows; vanilla knife keeps the knife row', () => {
  const sql = buildSql(ID, validateOps([{ op: 'skin', def: 507, paint: 0, teams: [3] }, { op: 'knife', knife: 'weapon_knife_karambit' }]), SCHEMA);
  assert.equal(sql[0], "DELETE FROM wp_player_skins WHERE steamid='76561198000000100' AND weapon_defindex=507 AND weapon_team IN (3);");
  assert.match(sql[1], /INSERT INTO wp_player_knife \(steamid, weapon_team, knife\) VALUES \('76561198000000100', 2, 'weapon_knife_karambit'\)/);
});

test('agents touch only the provided side; reset clears existing tables only', () => {
  const sql = buildSql(ID, validateOps([{ op: 'agents', ct: 'agents/models/ctm_st6/ctm_st6_variante.vmdl' }, { op: 'reset' }]), SCHEMA);
  assert.match(sql[0], /INSERT INTO wp_player_agents \(steamid, agent_ct\) VALUES \('76561198000000100', 'agents\/models\/ctm_st6\/ctm_st6_variante\.vmdl'\) ON DUPLICATE KEY UPDATE agent_ct=VALUES\(agent_ct\);/);
  assert.equal(sql.filter((s) => s.startsWith('DELETE')).length, 5);
});

test('missing table gives a clear 503 and bad steamid is rejected', () => {
  assert.throws(() => buildSql(ID, validateOps([{ op: 'music', id: 5 }]), { ...SCHEMA, wp_player_music: null }), (e) => e.status === 503);
  assert.throws(() => buildSql('123', validateOps([{ op: 'reset' }]), SCHEMA), /steamid/);
});

test('parseTsv handles NULL and escapes; parseOnlinePlayers is tolerant', () => {
  assert.deepEqual(parseTsv('a\tb\n1\tNULL\n2\tx\\ty\n'), [{ a: '1', b: null }, { a: '2', b: 'x\ty' }]);
  assert.deepEqual(parseOnlinePlayers('Players:\n #3 "sink333" (76561198000000100)\nfoo'), [{ steamid: ID, name: 'sink333' }]);
});

test('service: loadout and apply go through the runner', async () => {
  const seen = [];
  const run = async (sql) => {
    seen.push(sql);
    if (sql.startsWith('SHOW COLUMNS FROM wp_player_skins')) return 'Field\tType\tNull\tKey\tDefault\tExtra\nsteamid\tvarchar(18)\tNO\tPRI\tNULL\t\nweapon_team\tint(11)\tNO\tPRI\tNULL\t\nweapon_defindex\tint(11)\tNO\tPRI\tNULL\t\nweapon_paint_id\tint(11)\tNO\t\tNULL\t\n';
    if (sql.startsWith('SHOW COLUMNS')) throw new Error('no table');
    if (sql.startsWith('SELECT * FROM wp_player_skins')) return 'steamid\tweapon_team\tweapon_defindex\tweapon_paint_id\n76561198000000100\t2\t7\t282\n';
    return '';
  };
  const svc = createSkinsService({ run });
  const l = await svc.loadout(ID);
  assert.equal(l.available, true);
  assert.deepEqual(l.skins[0], { team: 2, def: 7, paint: 282, wear: null, seed: null, nametag: '', stattrak: 0, stattrakCount: 0, stickers: [null, null, null, null, null] });
  const r = await svc.apply(ID, [{ op: 'unskin', def: 7 }]);
  assert.equal(r.changed, 1);
  assert.match(seen.at(-1), /^START TRANSACTION; DELETE FROM wp_player_skins .* COMMIT;$/);
});

test('stickers: validation, column format, parsing back, StatTrak reset', () => {
  const { validateOps, buildSql, parseStickerCell } = require('../agent/skins');
  const ops = validateOps([{ op: 'skin', teams: [2], def: 7, paint: 44, stickers: [{ id: 123, x: 0.5, y: -0.2, rotation: 30, scale: 0.8, wear: 0.1 }, null, { id: 9 }] }]);
  assert.equal(ops[0].stickers.length, 5); assert.equal(ops[0].stickers[1], null);
  const col = (n) => ({ name: n, type: 'varchar', nullable: false, def: 'x', auto: false });
  const sch = { wp_player_skins: [{ name: 'steamid', nullable: false, def: null }, { name: 'weapon_team', nullable: false, def: null }, { name: 'weapon_defindex', nullable: false, def: null }, { name: 'weapon_paint_id', nullable: false, def: null }, col('weapon_sticker_0'), col('weapon_sticker_2'), { name: 'weapon_stattrak_count', nullable: false, def: '0' }] };
  const sql = buildSql('76561198000000100', ops, sch)[0];
  assert.match(sql, /'123;0;0\.5;-0\.2;0\.1;0\.8;30'/); assert.match(sql, /'9;2;0;0;0;1;0'/);
  assert.deepEqual(parseStickerCell('123;0;0.5;-0.2;0.1;0.8;30'), { id: 123, schema: 0, x: 0.5, y: -0.2, wear: 0.1, scale: 0.8, rotation: 30 });
  assert.equal(parseStickerCell('0;0;0;0;0;0;0'), null);
  assert.throws(() => validateOps([{ op: 'skin', teams: [2], def: 7, paint: 44, stickers: [{ id: 1, x: 99 }] }]));
  assert.throws(() => validateOps([{ op: 'skin', teams: [2], def: 7, paint: 44, stickers: new Array(6).fill({ id: 1 }) }]));
  assert.match(buildSql('76561198000000100', validateOps([{ op: 'stattrak-reset', teams: [2, 3], def: 7 }]), sch)[0], /UPDATE wp_player_skins SET weapon_stattrak_count=0 WHERE steamid='76561198000000100' AND weapon_defindex=7 AND weapon_team IN \(2,3\)/);
});
