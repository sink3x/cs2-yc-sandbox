'use strict';
// Установка закреплённого плагина целиком: скачивание (fetch подменён), проверка sha256, раскладка, повторный запуск.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2root-'));
process.env.CS2_ROOT = root; // до загрузки env.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../agent/env');
const I = require('../agent/install');

const hasZip = spawnSync('zip', ['-v'], { stdio: 'ignore' }).status === 0 && spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;

function makeZip(name, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrc-'));
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  const out = path.join(os.tmpdir(), `${name}-${process.pid}.zip`);
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-qr', out, '.'], { cwd: dir });
  const buf = fs.readFileSync(out);
  return { buf, sha: crypto.createHash('sha256').update(buf).digest('hex') };
}

test('закреплённый плагин: скачивание, проверка sha256, раскладка, повторный запуск без скачивания', { skip: !hasZip && 'нет zip/unzip' }, async () => {
  fs.mkdirSync(E.gamePaths.cssPlugins, { recursive: true });
  const wrapped = makeZip('wrapped', { 'TPR/Readme.txt': 'r', 'TPR/configs/plugins/TPR/c.json': '{}', 'TPR/plugins/TPR/TPR.dll': 'dll' });
  const flat = makeZip('flat', { 'AFK.dll': 'dll', 'lang/en.json': '{}' });
  const urls = [];
  const realFetch = global.fetch;
  const bodies = { 'https://github.com/a/tpr/releases/download/v1/TPR.zip': wrapped.buf, 'https://github.com/a/afk/releases/download/build-1/AFK.zip': flat.buf };
  global.fetch = async (url) => { urls.push(String(url)); const b = bodies[String(url)]; return b ? new Response(b) : new Response('nope', { status: 404 }); };
  try {
    const tpr = { id: 'tpr', repo: 'a/tpr', asset: '^TPR\\.zip$', dirs: ['TPR'], layout: 'strip', pin: { tag: 'v1', asset: 'TPR.zip', sha256: wrapped.sha } };
    await I.installPlugin(tpr);
    assert.ok(fs.existsSync(path.join(E.gamePaths.cssPlugins, 'TPR/TPR.dll')), 'dll на месте');
    assert.ok(fs.existsSync(path.join(E.gamePaths.css, 'configs/plugins/TPR/c.json')), 'конфиг на месте');
    assert.ok(!fs.existsSync(path.join(E.gamePaths.cssPlugins, 'TPR/TPR')), 'обёртка снята');
    const db = JSON.parse(fs.readFileSync(E.files.installed, 'utf8'));
    assert.deepEqual([db.tpr.tag, db.tpr.sha256, db.tpr.dirs], ['v1', wrapped.sha, ['TPR']]);
    assert.equal(urls.length, 1);
    assert.ok(urls.every((u) => !u.includes('api.github.com')), 'API GitHub не трогаем');

    await I.installPlugin(tpr); // уже стоит этой версии
    assert.equal(urls.length, 1, 'повторно не качаем');

    const afk = { id: 'afk', repo: 'a/afk', asset: '^AFK\\.zip$', dirs: ['AFK'], layout: 'flat', pin: { tag: 'build-1', asset: 'AFK.zip', sha256: flat.sha } };
    await I.installPlugin(afk);
    assert.ok(fs.existsSync(path.join(E.gamePaths.cssPlugins, 'AFK/AFK.dll')), 'flat: dll в своей папке');
    assert.ok(fs.existsSync(path.join(E.gamePaths.cssPlugins, 'AFK/lang/en.json')));

    // подменённый файл: хэш не совпал → ничего не ставим и кэш удаляем
    const evil = { ...afk, id: 'evil', dirs: ['EVIL'], pin: { ...afk.pin, sha256: '0'.repeat(64) } };
    await assert.rejects(() => I.installPlugin(evil), /sha256 mismatch/);
    assert.ok(!fs.existsSync(path.join(E.gamePaths.cssPlugins, 'EVIL')));
    assert.ok(!fs.existsSync(path.join(E.dirs.cache, 'evil-AFK.zip')), 'скачанный файл удалён');
    assert.equal(JSON.parse(fs.readFileSync(E.files.installed, 'utf8')).evil, undefined);

    // файла нет на GitHub → понятная ошибка
    await assert.rejects(() => I.installPlugin({ ...afk, id: 'gone', pin: { tag: 'zzz', asset: 'AFK.zip', sha256: flat.sha } }), /HTTP 404/);
  } finally { global.fetch = realFetch; }
});
