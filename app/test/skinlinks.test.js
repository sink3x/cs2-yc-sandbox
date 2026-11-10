'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const L = require('../admin/public/skin-links.js');

function readVarint(b, i) { let v = 0n, s = 0n; for (;;) { const x = b[i++]; v |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) break; s += 7n; } return [v, i]; }

test('CRC-32 совпадает с zlib', () => {
  for (const s of ['123456789', '', 'cs2']) assert.equal(L.crc32(Buffer.from(s)), zlib.crc32(Buffer.from(s)));
});

test('inspect: структура, поля и контрольная сумма', () => {
  const data = { defindex: 7, paintindex: 941, paintseed: 2, paintwear: 0.25, rarity: 5, quality: 4, customname: 'Hi' };
  const hex = L.inspectHex(data); const b = Buffer.from(hex, 'hex');
  assert.equal(b[0], 0);
  const proto = b.subarray(1, b.length - 4); const crc = BigInt(zlib.crc32(b.subarray(0, b.length - 4)));
  const x = Number(((crc & 0xffffn) ^ (BigInt(proto.length) * crc)) & 0xffffffffn);
  assert.equal(b.readUInt32BE(b.length - 4), x);
  const got = {}; let i = 0;
  while (i < proto.length) { const [tag, j] = readVarint(proto, i); i = j; const f = Number(tag >> 3n); if (Number(tag & 7n) === 2) { const [n, k] = readVarint(proto, i); got[f] = proto.subarray(k, k + Number(n)).toString(); i = k + Number(n); } else { const [v, k] = readVarint(proto, i); got[f] = v; i = k; } }
  assert.equal(got[3], 7n); assert.equal(got[4], 941n); assert.equal(got[5], 5n); assert.equal(got[6], 4n); assert.equal(got[8], 2n);
  assert.equal(Number(got[7]), new Uint32Array(new Float32Array([0.25]).buffer)[0]);
  assert.equal(got[11], 'Hi');
  assert.match(L.inspectUrl(data), /^steam:\/\/rungame\/730\/\d+\/\+csgo_econ_action_preview%20[0-9A-F]+$/);
});

test('previewData: нож, StatTrak, редкость', () => {
  const k = L.previewData({ def: 507, paint: 38, wear: 0.01, seed: 5, kind: 'knife', rarityName: 'Covert', stattrak: true, count: 3 });
  assert.equal(k.quality, 3); assert.equal(k.rarity, 6); assert.equal(k.killeatervalue, 3);
  const w = L.previewData({ def: 7, paint: 44, wear: 0.2, seed: 1, kind: 'weapon', rarityName: 'Classified', stattrak: true, count: 10 });
  assert.equal(w.quality, 9); assert.equal(w.rarity, 5);
  assert.equal(L.previewData({ def: 7, paint: 44, wear: 5, seed: -3, kind: 'weapon', rarityName: 'x' }).paintwear, 1);
});

test('market name и ссылки', () => {
  const it = { weaponName: 'AK-47', skinName: 'Redline', paint: 282, wear: 0.2, kind: 'weapon', stattrak: true };
  assert.equal(L.marketName(it), 'StatTrak™ AK-47 | Redline (Field-Tested)');
  assert.equal(L.marketName({ weaponName: 'Karambit', skinName: 'Fade', paint: 38, wear: 0.01, kind: 'knife' }), '★ Karambit | Fade (Factory New)');
  const l = L.marketLinks(it);
  assert.match(l.lis, /search=StatTrak%E2%84%A2%20AK-47%20%7C%20Redline%20\(Field-Tested\)$/);
  assert.match(l.csfloat, /min_float=0\.190&max_float=0\.210/);
  assert.equal(L.marketLinks({ ...it, wear: 0.005 }).csfloat.includes('min_float=0.000'), true);
});

test('wearLook монотонен', () => {
  assert.ok(L.wearLook(0.6).scratch > L.wearLook(0.1).scratch);
});

test('wearBlend: кроссфейд между соседними износами', () => {
  const A = [0.035, 0.11, 0.265, 0.415, 0.65];
  assert.deepEqual(L.wearBlend(A, 0), [1, 0, 0, 0, 0]);
  assert.deepEqual(L.wearBlend(A, 0.9), [0, 0, 0, 0, 1]);
  const m = L.wearBlend(A, 0.1875); // ровно посередине между MW и FT
  assert.equal(m[1], 1); assert.ok(Math.abs(m[2] - 0.5) < 1e-9); assert.equal(m[0] + m[3] + m[4], 0);
  let prev = -1; for (let w = 0.11; w <= 0.265; w += 0.01) { const o = L.wearBlend(A, w)[2]; assert.ok(o >= prev); prev = o; } // монотонно
  assert.deepEqual(L.wearBlend([], 0.3), []);
});
