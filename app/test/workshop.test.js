'use strict';
// Сведения о картах Workshop: разбор ответа Steam, кэш в файле, поведение при ошибке сети.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkshopMeta, parseDetails } = require('../lib/workshop');

const reply = (list) => ({ response: { publishedfiledetails: list } });
const item = (id, extra = {}) => ({ publishedfileid: id, result: 1, title: 'Inspect "Skins" <b>', preview_url: 'https://images.steamusercontent.com/ugc/123/ABCDEF/', file_size: '547951173', time_updated: 5, tags: [{ tag: 'Cs2' }, { tag: 'Map' }, { tag: 'Custom' }, { tag: 'Wingman' }], ...extra });

test('ответ Steam: чистое название, только свои хосты картинок, известные теги', () => {
  const r = parseDetails(reply([item('3071733061'), item('3000000001', { preview_url: 'https://evil.example/x.png' }), { publishedfileid: '3000000002', result: 9 }, { publishedfileid: 'x' }]));
  assert.deepEqual(r['3071733061'], { ok: true, title: 'Inspect Skins b', img: 'https://images.steamusercontent.com/ugc/123/ABCDEF/', mb: 548, tags: ['custom', 'wingman'], updated: 5 });
  assert.equal(r['3000000001'].img, '');
  assert.deepEqual(r['3000000002'], { ok: false });
  assert.equal(Object.keys(r).length, 3);
});

test('кэш: второй запрос не ходит в сеть; ошибка сети не ломает ответ', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')), 'meta.json');
  let calls = 0; let fail = false; let t = 1e12;
  const fetchImpl = async (_u, o) => {
    calls += 1; if (fail) throw new Error('offline');
    const ids = [...new URLSearchParams(o.body)].filter(([k]) => k.startsWith('publishedfileids')).map(([, v]) => v);
    return { ok: true, json: async () => reply(ids.map((id) => (id === '3000000009' ? { publishedfileid: id, result: 9 } : item(id)))) };
  };
  const ws = createWorkshopMeta({ file, fetchImpl, now: () => t });
  const a = await ws.get(['3071733061', '3000000009', 'bad', '3071733061']);
  assert.equal(a['3071733061'].mb, 548); assert.deepEqual(a['3000000009'], { missing: true }); assert.equal(calls, 1);
  await ws.get(['3071733061']); assert.equal(calls, 1, 'из кэша');
  assert.equal(createWorkshopMeta({ file, fetchImpl, now: () => t }).get(['3071733061']) instanceof Promise, true);
  t += 8 * 86400e3; fail = true;
  const b = await ws.get(['3071733061', '3111111111']);
  assert.equal(b['3071733061'].mb, 548, 'устаревшее лучше, чем ничего'); assert.equal(b['3111111111'], undefined);
});
