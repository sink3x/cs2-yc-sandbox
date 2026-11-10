'use strict';
// Прослушивание музыкальных наборов: звук достаём из файлов самой игры (pak01_dir.vpk) утилитой Source2Viewer-CLI
// (https://s2v.app, ValveResourceFormat, MIT). Утилита скачивается один раз, версия закреплена по sha256.
// Наружу ничего не уходит: файлы лежат в кэше игровой ВМ и по запросу отдаются панели.
const fs = require('node:fs');
const path = require('node:path');

const TOOL = {
  tag: '20.1',
  url: 'https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.1/cli-linux-x64.zip',
  sha256: '29d25a6d6b62377fc5386c3e5145b0a2180a401a50041afe9494b3f503deaef5',
  bin: 'Source2Viewer-CLI',
};
const KIT_RE = /^[a-z0-9_]{1,64}$/;
const FILE_RE = /^[a-z0-9_.-]{1,80}\.(mp3|wav)$/;
const TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav' };
const MAX_TRACK = 24 << 20;

/** Список файлов VPK → { kit: [имя без расширения] }. Формат вывода утилиты не фиксируем: ищем пути в любом месте строки. */
function parseVpkList(text) {
  const kits = {};
  for (const m of String(text).matchAll(/sounds\/music\/([a-z0-9_]+)\/([a-z0-9_.-]+?)\.vsnd_c/gi)) {
    const kit = m[1].toLowerCase(); const file = m[2].toLowerCase();
    (kits[kit] = kits[kit] || new Set()).add(file);
  }
  return Object.fromEntries(Object.entries(kits).map(([k, v]) => [k, [...v].sort()]));
}

/** items_game.txt → { defIndex: имя папки набора }. Берём только блок music_definitions. */
function parseMusicDefs(text) {
  const src = String(text); const at = src.indexOf('"music_definitions"');
  if (at < 0) return {};
  // блок заканчивается закрывающей скобкой на своём уровне
  let depth = 0; let end = src.length; let started = false;
  for (let i = at; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') { depth += 1; started = true; } else if (c === '}') { depth -= 1; if (started && depth === 0) { end = i; break; } }
  }
  const out = {};
  for (const m of src.slice(at, end).matchAll(/"(\d+)"\s*\{[^{}]*?"name"\s+"([^"]+)"/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

/** Все аудиофайлы под каталогом (утилита сама решает, mp3 это или wav, и может сохранить вложенные папки). */
function findAudio(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(mp3|wav)$/i.test(e.name)) out.push(p); } };
  try { walk(dir); } catch { /* каталога нет */ }
  return out;
}
const findFile = (dir, name) => { let hit = null; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === name) hit = hit || p; } }; try { walk(dir); } catch { /* нет */ } return hit; };

function createMusic({ pak, cacheDir, toolsDir, exec, download, sha256File, log = () => {} }) {
  const toolDir = path.join(toolsDir, `s2v-${TOOL.tag}`);
  const bin = path.join(toolDir, TOOL.bin);
  const env = { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', DOTNET_BUNDLE_EXTRACT_BASE_DIR: path.join(toolsDir, '.dotnet'), HOME: toolsDir };
  const fail = (msg, status = 503) => Object.assign(new Error(msg), { status });
  const tail = (r) => `${r.stderr || ''} ${r.stdout || ''}`.replace(/\s+/g, ' ').trim().slice(-300);
  const run = async (args, timeout = 180000) => {
    const r = await exec(bin, args, { env, timeout, maxBuffer: 64 << 20 });
    if (!r.ok) throw fail(`Source2Viewer-CLI: ${tail(r) || `код ${r.code}`}`);
    return r.stdout;
  };

  let toolBusy = null;
  const ensureTool = () => {
    if (fs.existsSync(bin)) return Promise.resolve(bin);
    if (!toolBusy) {
      toolBusy = (async () => {
        if (!fs.existsSync(pak)) throw fail('игра ещё не установлена: нет pak01_dir.vpk');
        fs.mkdirSync(toolDir, { recursive: true });
        const zip = path.join(toolsDir, `s2v-${TOOL.tag}.zip`);
        log('downloading Source2Viewer-CLI', TOOL.tag);
        await download(TOOL.url, zip);
        const sum = await sha256File(zip);
        if (sum !== TOOL.sha256) { fs.rmSync(zip, { force: true }); throw fail(`Source2Viewer-CLI: sha256 не совпал (${sum.slice(0, 12)}…): не устанавливаю`); }
        const r = await exec('unzip', ['-o', '-q', zip, '-d', toolDir]);
        fs.rmSync(zip, { force: true });
        if (!r.ok || !fs.existsSync(bin)) throw fail(`Source2Viewer-CLI: распаковка не удалась ${tail(r)}`);
        fs.chmodSync(bin, 0o755);
        return bin;
      })().finally(() => { toolBusy = null; });
    }
    return toolBusy;
  };

  // индекс наборов зависит только от файлов игры: пересобираем, когда pak01_dir.vpk изменился (обновление CS2)
  const indexFile = path.join(cacheDir, 'index.json');
  let indexBusy = null;
  const pakStamp = () => { const st = fs.statSync(pak); return `${st.size}-${Math.round(st.mtimeMs)}`; };
  const index = () => {
    if (!fs.existsSync(pak)) return Promise.reject(fail('игра ещё не установлена: нет pak01_dir.vpk'));
    const stamp = pakStamp();
    try { const c = JSON.parse(fs.readFileSync(indexFile, 'utf8')); if (c.stamp === stamp && c.tool === TOOL.tag) return Promise.resolve(c); } catch { /* нет кэша */ }
    if (!indexBusy) {
      indexBusy = (async () => {
        await ensureTool();
        fs.mkdirSync(cacheDir, { recursive: true });
        const kits = parseVpkList(await run(['--input', pak, '--vpk_list', '--vpk_filepath', 'sounds/music/', '--vpk_extensions', 'vsnd_c']));
        if (!Object.keys(kits).length) throw fail('в pak01_dir.vpk не найдено sounds/music/*.vsnd_c');
        const tmp = path.join(cacheDir, '.items');
        fs.rmSync(tmp, { recursive: true, force: true });
        await run(['--input', pak, '--vpk_filepath', 'scripts/items/items_game.txt', '--output', tmp]);
        const ig = findFile(tmp, 'items_game.txt');
        const defs = ig ? parseMusicDefs(fs.readFileSync(ig, 'utf8')) : {};
        fs.rmSync(tmp, { recursive: true, force: true });
        if (!Object.keys(defs).length) throw fail('не удалось прочитать music_definitions из items_game.txt');
        const c = { stamp, tool: TOOL.tag, kits, defs };
        // наборы из старой версии игры больше не актуальны
        for (const e of fs.readdirSync(cacheDir, { withFileTypes: true })) if (e.isDirectory()) fs.rmSync(path.join(cacheDir, e.name), { recursive: true, force: true });
        fs.writeFileSync(indexFile, JSON.stringify(c));
        return c;
      })().finally(() => { indexBusy = null; });
    }
    return indexBusy;
  };

  const kitBusy = new Map();
  /** Треки набора по номеру из каталога (def_index). Первый вызов извлекает звук из VPK. */
  async function kit(id) {
    const ix = await index();
    const name = ix.defs[String(id)];
    if (!name || !KIT_RE.test(name)) throw fail(`музыкальный набор №${id} не найден в файлах игры`, 404);
    if (!ix.kits[name]) throw fail(`в файлах игры нет звука набора ${name}`, 404);
    const dir = path.join(cacheDir, name);
    const list = () => findAudio(dir).map((p) => ({ file: path.basename(p).toLowerCase(), size: fs.statSync(p).size, path: p })).filter((t) => FILE_RE.test(t.file) && t.size <= MAX_TRACK).sort((a, b) => a.file.localeCompare(b.file));
    if (!fs.existsSync(path.join(dir, '.done'))) {
      if (!kitBusy.has(name)) {
        kitBusy.set(name, (async () => {
          fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
          log('extracting music kit', name);
          await run(['--input', pak, '--vpk_filepath', `sounds/music/${name}/`, '--vpk_extensions', 'vsnd_c', '--vpk_decompile', '--output', dir]);
          if (!findAudio(dir).length) throw fail(`Source2Viewer-CLI не выдал аудио для набора ${name}`);
          fs.writeFileSync(path.join(dir, '.done'), '');
        })().finally(() => kitBusy.delete(name)));
      }
      await kitBusy.get(name);
    }
    return { id: Number(id), kit: name, tracks: list() };
  }

  async function track(id, file) {
    const f = String(file || '').toLowerCase();
    if (!FILE_RE.test(f)) throw fail('bad track name', 400);
    const t = (await kit(id)).tracks.find((x) => x.file === f);
    if (!t) throw fail('no such track', 404);
    return { file: f, type: TYPES[f.split('.').pop()], b64: fs.readFileSync(t.path).toString('base64') };
  }

  return { kit, track, index, ensureTool };
}

module.exports = { createMusic, parseVpkList, parseMusicDefs, findAudio, TOOL, KIT_RE, FILE_RE, TYPES, MAX_TRACK };
