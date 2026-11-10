'use strict';
// Ссылки для скинов: «осмотр в игре» (inspect link), поиск похожего на маркетах, вид износа.
// Чистые функции без DOM: подключаются в браузере как глобальные (SkinLinks) и в тестах через require.
(function (root) {
  // ---- CRC-32 (тот же, что zlib/npm "crc") ----
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  // ---- protobuf: CEconItemPreviewDataBlock (только нужные поля) ----
  function varint(n) { let v = BigInt(n); const out = []; while (v > 0x7fn) { out.push(Number(v & 0x7fn) | 0x80); v >>= 7n; } out.push(Number(v)); return out; }
  const FIELDS = { defindex: 3, paintindex: 4, rarity: 5, quality: 6, paintwear: 7, paintseed: 8, killeaterscoretype: 9, killeatervalue: 10 };
  const floatBits = (f) => { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, f, true); return dv.getUint32(0, true); };
  const utf8 = (s) => Array.from(new TextEncoder().encode(s));

  /** data: { defindex, paintindex, rarity, quality, paintwear(0..1), paintseed, killeaterscoretype?, killeatervalue?, customname? } → байты protobuf */
  function encodeProto(data) {
    const out = [];
    for (const [key, num] of Object.entries(FIELDS)) {
      let v = data[key];
      if (v === undefined || v === null) continue;
      if (key === 'paintwear') v = floatBits(v);
      out.push(...varint((num << 3) | 0), ...varint(v));
    }
    if (data.customname) { const b = utf8(String(data.customname)); out.push(...varint((11 << 3) | 2), ...varint(b.length), ...b); }
    return out;
  }

  /** Hex-строка «masked» inspect-ссылки: 00 + protobuf + 4 байта контрольной суммы (big-endian). */
  function inspectHex(data) {
    const proto = encodeProto(data);
    const buf = [0, ...proto];
    const crc = BigInt(crc32(buf));
    const x = ((crc & 0xffffn) ^ (BigInt(proto.length) * crc)) & 0xffffffffn;
    const sum = [Number((x >> 24n) & 0xffn), Number((x >> 16n) & 0xffn), Number((x >> 8n) & 0xffn), Number(x & 0xffn)];
    return [...buf, ...sum].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  const inspectUrl = (data) => `steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20${inspectHex(data)}`;

  // ---- сопоставление с каталогом ----
  const RAR = [['consumer', 1], ['industrial', 2], ['mil-spec', 3], ['restricted', 4], ['classified', 5], ['covert', 6], ['contraband', 6], ['extraordinary', 6]];
  const rarityNum = (name, kind) => { if (kind === 'knife' || kind === 'glove') return 6; const n = String(name || '').toLowerCase(); const hit = RAR.find(([k]) => n.includes(k)); return hit ? hit[1] : 3; };

  /** Данные предмета редактора → поля protobuf. it: { def, paint, wear, seed, kind, rarityName, stattrak, count, nametag } */
  function previewData(it) {
    const d = { defindex: it.def, paintindex: it.paint, rarity: rarityNum(it.rarityName, it.kind), quality: it.kind === 'knife' || it.kind === 'glove' ? 3 : it.stattrak ? 9 : 4, paintwear: Math.min(1, Math.max(0, Number(it.wear) || 0)), paintseed: Math.max(0, Math.round(Number(it.seed) || 0)) };
    if (it.stattrak && it.kind !== 'glove') { d.killeaterscoretype = 0; d.killeatervalue = Math.max(0, Math.round(Number(it.count) || 0)); if (it.kind === 'knife') d.quality = 3; }
    if (it.nametag) d.customname = String(it.nametag).slice(0, 20);
    return d;
  }

  // ---- износ / маркеты ----
  const wearCat = (w) => (w < 0.07 ? 'Factory New' : w < 0.15 ? 'Minimal Wear' : w < 0.38 ? 'Field-Tested' : w < 0.45 ? 'Well-Worn' : 'Battle-Scarred');
  /** Имя в формате Steam Market (market_hash_name). */
  function marketName(it) {
    const base = it.paint ? `${it.weaponName} | ${it.skinName} (${wearCat(it.wear)})` : it.weaponName;
    const st = it.stattrak && it.kind !== 'glove' ? 'StatTrak™ ' : '';
    return `${it.kind === 'knife' || it.kind === 'glove' ? '★ ' : ''}${st}${base}`;
  }
  const BANDS = { 'Factory New': [0, 0.07], 'Minimal Wear': [0.07, 0.15], 'Field-Tested': [0.15, 0.38], 'Well-Worn': [0.38, 0.45], 'Battle-Scarred': [0.45, 1] };
  /** Ссылки «найти похожий»: тот же скин, тот же износ (категория), для CSFloat — ещё и диапазон float вокруг выбранного. */
  function marketLinks(it) {
    const name = marketName(it); const q = encodeURIComponent(name);
    const band = BANDS[wearCat(it.wear)]; const lo = Math.max(band[0], it.wear - 0.01); const hi = Math.min(band[1], it.wear + 0.01);
    return {
      name,
      steam: `https://steamcommunity.com/market/search?appid=730&q=${q}`,
      csmoney: `https://cs.money/market/buy/?search=${q}`,
      lis: `https://lis-skins.com/market/csgo/?search=${q}`,
      csfloat: `https://csfloat.com/search?market_hash_name=${q}&min_float=${lo.toFixed(3)}&max_float=${hi.toFixed(3)}`,
    };
  }
  // Сервисы 3D/скриншота принимают inspect-ссылку вставкой: открываем страницу, ссылку кладём в буфер.
  const VIEWERS = [['CSFloat — float и скриншот', 'https://csfloat.com/checker'], ['SteamAnalyst — 3D и скриншот', 'https://www.steamanalyst.com/inspect']];

  /** Параметры вида износа: CSS-фильтр картинки и сила «царапин» (0..1). Приблизительно: в каталоге одна картинка на скин. */
  function wearLook(w) { const x = Math.min(1, Math.max(0, w)); return { filter: `saturate(${(1 - 0.45 * x).toFixed(2)}) contrast(${(1 + 0.12 * x).toFixed(2)}) brightness(${(1 - 0.22 * x).toFixed(2)})`, scratch: Math.min(0.9, x * 1.6) }; }

  /** Плавный переход между настоящими картинками износа. anchors — float-центры доступных износов по возрастанию;
   *  → непрозрачности слоёв (картинки лежат друг на друге): нижний соседний слой 1, верхний — доля t, остальные 0. */
  function wearBlend(anchors, w) {
    const n = anchors.length; const out = new Array(n).fill(0); if (!n) return out;
    const x = Math.min(1, Math.max(0, Number(w) || 0));
    if (x <= anchors[0]) { out[0] = 1; return out; }
    if (x >= anchors[n - 1]) { out[n - 1] = 1; return out; }
    let i = 0; while (anchors[i + 1] <= x) i++;
    out[i] = 1; out[i + 1] = (x - anchors[i]) / (anchors[i + 1] - anchors[i]); return out;
  }
  const api = { wearBlend, crc32, encodeProto, inspectHex, inspectUrl, previewData, wearCat, marketName, marketLinks, wearLook, rarityNum, VIEWERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SkinLinks = api;
})(typeof window !== 'undefined' ? window : globalThis);
