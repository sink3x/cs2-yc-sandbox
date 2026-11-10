'use strict';
// Звуки игры: разбор списка файлов VPK, приведение пути, поиск и определение формата по содержимому.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../agent/music');

test('путь звука приводится к файлу в VPK, опасные пути отклоняются', () => {
  assert.equal(M.normalizeSoundPath('UI/Beep07.wav'), 'sounds/ui/beep07.vsnd_c');
  assert.equal(M.normalizeSoundPath('sounds/weapons/ak47/ak47_01.vsnd'), 'sounds/weapons/ak47/ak47_01.vsnd_c');
  assert.equal(M.normalizeSoundPath('/sounds/ui/x.vsnd_c'), 'sounds/ui/x.vsnd_c');
  for (const bad of ['', 'a/../b', 'a//b', 'a b', 'a;rm', 'ui/"x"', 'x'.repeat(300)]) assert.equal(M.normalizeSoundPath(bad), null, bad);
});

test('список VPK: только звуки, без музыкальных наборов и повторов', () => {
  const files = M.parseSoundList('1 sounds/ui/beep07.vsnd_c crc\nsounds/UI/beep07.vsnd_c\nsounds/music/kit/mainmenu.vsnd_c\nsounds/weapons/ak47/ak47_01.vsnd_c\nmodels/x.vmdl_c');
  assert.deepEqual(files, ['sounds/ui/beep07.vsnd_c', 'sounds/weapons/ak47/ak47_01.vsnd_c']);
  assert.deepEqual(M.soundDirs(files).map((d) => d.dir).sort(), ['ui', 'weapons']);
});

test('поиск: все слова, папка, совпадение в имени файла выше, постранично', () => {
  const files = ['sounds/ambient/bomb/far.vsnd_c', 'sounds/ui/bomb_planted.vsnd_c', 'sounds/weapons/c4/c4_beep.vsnd_c', 'sounds/weapons/ak47/ak47_01.vsnd_c'];
  assert.deepEqual(M.searchSounds(files, { q: 'bomb' }).items, ['sounds/ui/bomb_planted.vsnd_c', 'sounds/ambient/bomb/far.vsnd_c']);
  assert.deepEqual(M.searchSounds(files, { q: 'weapons beep' }).items, ['sounds/weapons/c4/c4_beep.vsnd_c']);
  assert.equal(M.searchSounds(files, { dir: 'weapons' }).total, 2);
  const page = M.searchSounds(files, { offset: 3, limit: 2 });
  assert.equal(page.total, 4); assert.equal(page.items.length, 1);
});

test('формат определяется по содержимому', () => {
  const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(8)]);
  assert.equal(M.sniffAudio(wav), 'wav');
  assert.equal(M.sniffAudio(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(12)])), 'mp3');
  assert.equal(M.sniffAudio(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(12)])), 'mp3');
  assert.equal(M.sniffAudio(Buffer.from('<html>not audio</html>')), null);
});

test('сервис: поиск по индексу и извлечение одного звука (утилита подменена)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-'));
  const pak = path.join(dir, 'pak01_dir.vpk'); fs.writeFileSync(pak, 'x');
  const toolsDir = path.join(dir, 'tools'); const bin = path.join(toolsDir, `s2v-${M.TOOL.tag}`, M.TOOL.bin);
  fs.mkdirSync(path.dirname(bin), { recursive: true }); fs.writeFileSync(bin, '');
  const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(64)]);
  const calls = [];
  const exec = async (_b, args) => {
    calls.push(args.join(' '));
    if (args.includes('--vpk_list')) return { ok: true, stdout: 'sounds/ui/beep07.vsnd_c\nsounds/weapons/ak47/ak47_01.vsnd_c\n', stderr: '' };
    fs.writeFileSync(args[args.indexOf('--output') + 1], wav); // один файл утилита пишет прямо по пути --output
    return { ok: true, stdout: '', stderr: '' };
  };
  const svc = M.createMusic({ pak, cacheDir: path.join(dir, 'cache'), toolsDir, exec, download: async () => {}, sha256File: async () => M.TOOL.sha256 });
  const r = await svc.sounds({ q: 'ak47' });
  assert.equal(r.total, 1); assert.equal(r.all, 2);
  const s = await svc.sound('weapons/ak47/ak47_01');
  assert.equal(s.type, 'audio/wav'); assert.equal(Buffer.from(s.b64, 'base64').length, wav.length);
  const n = calls.length; await svc.sound('sounds/weapons/ak47/ak47_01.vsnd_c'); assert.equal(calls.length, n, 'второй раз — из кэша');
  await assert.rejects(svc.sound('ui/nope'), (e) => e.status === 404);
  await assert.rejects(svc.sound('../etc/passwd'), (e) => e.status === 400);
});
