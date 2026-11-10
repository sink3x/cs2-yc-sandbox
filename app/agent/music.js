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
  const src = String(text); const out = {};
  // секция может встречаться в файле несколько раз (игра склеивает одноимённые блоки) — читаем все
  for (let at = src.indexOf('"music_definitions"'); at >= 0; at = src.indexOf('"music_definitions"', at + 1)) {
    let depth = 0; let end = -1; let started = false;
    for (let i = at; i < src.length; i += 1) {
      const c = src[i];
      if (c === '{') { depth += 1; started = true; } else if (c === '}') { depth -= 1; if (started && depth === 0) { end = i; break; } } else if (!started && c === '\n' && i > at + 40) break; // это не заголовок блока
    }
    if (end < 0) continue;
    for (const m of src.slice(at, end).matchAll(/"(\d+)"\s*\{[^{}]*?"name"\s+"([^"]+)"/g)) out[m[1]] = m[2].toLowerCase();
  }
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

// ---- любые звуки игры (не только музыка): поиск по списку файлов VPK и извлечение одного файла ----
const SOUND_RE = /^sounds\/[a-z0-9_./-]{1,200}\.vsnd_c$/;
/** Путь звука в любом привычном виде (как в команде play, с sounds/ или без, с расширением или без) → путь файла в VPK. */
function normalizeSoundPath(p) {
  let s = String(p || '').trim().toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
  s = s.replace(/\.(vsnd_c|vsnd|wav|mp3)$/, '');
  if (!s.startsWith('sounds/')) s = `sounds/${s}`;
  s = `${s}.vsnd_c`;
  return SOUND_RE.test(s) && !s.includes('..') && !s.includes('//') ? s : null;
}
/** Список файлов VPK → отсортированные пути звуков (музыкальные наборы пропускаем: у них свой раздел). */
function parseSoundList(text) {
  const set = new Set();
  for (const m of String(text).matchAll(/sounds\/[a-z0-9_./-]+?\.vsnd_c/gi)) { const f = m[0].toLowerCase(); if (!f.startsWith('sounds/music/') && SOUND_RE.test(f)) set.add(f); }
  return [...set].sort();
}
/** Поиск: все слова запроса должны встречаться в пути; совпадения в имени файла выше; dir — папка верхнего уровня. */
function searchSounds(files, { q = '', dir = '', offset = 0, limit = 60 } = {}) {
  const words = String(q).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean).slice(0, 6);
  const pre = dir ? `sounds/${dir}/` : '';
  const hits = [];
  for (const f of files) {
    if (pre && !f.startsWith(pre)) continue;
    if (!words.every((w) => f.includes(w))) continue;
    const name = f.slice(f.lastIndexOf('/') + 1);
    hits.push([words.length && words.every((w) => name.includes(w)) ? 0 : 1, f]);
  }
  if (words.length) hits.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || (a[1] < b[1] ? -1 : 1));
  const o = Math.max(0, Number(offset) || 0); const n = Math.min(200, Math.max(1, Number(limit) || 60));
  return { total: hits.length, items: hits.slice(o, o + n).map((x) => x[1]) };
}
const soundDirs = (files) => { const c = {}; for (const f of files) { const d = f.split('/')[1]; if (f.split('/').length > 2) c[d] = (c[d] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([dir, count]) => ({ dir, count })); };
/** Формат по первым байтам: утилита может сохранить файл без расширения. */
function sniffAudio(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

const LOGO_RE = /^[a-z0-9_]{1,24}$/;
/** Список файлов VPK → коды логотипов команд (имя файла без расширения). */
function parseLogoList(text) {
  const set = new Set();
  for (const m of String(text).matchAll(/panorama\/images\/tournaments\/teams\/([a-z0-9_]+)\.vsvg_c/gi)) { const c = m[1].toLowerCase(); if (LOGO_RE.test(c)) set.add(c); }
  return [...set].sort();
}

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
        const { defs, why } = await readDefs();
        if (!Object.keys(defs).length) throw fail(`не удалось прочитать music_definitions из items_game.txt (${why})`);
        const c = { stamp, tool: TOOL.tag, kits, defs };
        // наборы из старой версии игры больше не актуальны
        for (const e of fs.readdirSync(cacheDir, { withFileTypes: true })) if (e.isDirectory() && e.name !== '_snd' && e.name !== '_logos') fs.rmSync(path.join(cacheDir, e.name), { recursive: true, force: true });
        fs.writeFileSync(indexFile, JSON.stringify(c));
        return c;
      })().finally(() => { indexBusy = null; });
    }
    return indexBusy;
  };

  /** items_game.txt из VPK: пробуем выгрузку в каталог (с декомпиляцией и без) и печать в stdout; why — что именно не получилось. */
  async function readDefs() {
    const why = []; const tmp = path.join(cacheDir, '.items');
    for (const extra of [[], ['--vpk_decompile']]) {
      fs.rmSync(tmp, { recursive: true, force: true });
      const r = await exec(bin, ['--input', pak, '--vpk_filepath', 'scripts/items/items_game.txt', '--output', tmp, ...extra], { env, timeout: 180000, maxBuffer: 64 << 20 });
      // один файл утилита пишет прямо по пути --output (без подкаталогов), несколько — в каталог
      let ig = null; try { ig = fs.statSync(tmp).isFile() ? tmp : findFile(tmp, 'items_game.txt'); } catch { /* ничего не выгружено */ }
      if (ig) { const text = fs.readFileSync(ig, 'utf8'); const defs = parseMusicDefs(text); fs.rmSync(tmp, { recursive: true, force: true }); if (Object.keys(defs).length) return { defs, why: '' }; why.push(`файл ${text.length} б, секций ${text.split('"music_definitions"').length - 1}, начало: ${text.slice(0, 80).replace(/\s+/g, ' ')}`); } else why.push(`файл не выгружен${extra.length ? ' (-d)' : ''}: ${tail(r)}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    const r = await exec(bin, ['--input', pak, '--vpk_filepath', 'scripts/items/items_game.txt', '--output', '-'], { env, timeout: 180000, maxBuffer: 128 << 20 });
    const defs = parseMusicDefs(r.stdout);
    if (!Object.keys(defs).length) why.push(`stdout ${r.stdout.length} б: ${tail(r)}`);
    return { defs, why: why.join(' | ').slice(0, 900) };
  }

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

  // ---- звуки игры ----
  const sndIndexFile = path.join(cacheDir, 'sounds-index.json');
  const sndDir = path.join(cacheDir, '_snd');
  let sndMem = null; let sndBusy = null;
  const soundIndex = () => {
    if (!fs.existsSync(pak)) return Promise.reject(fail('игра ещё не установлена: нет pak01_dir.vpk'));
    const stamp = pakStamp();
    if (sndMem && sndMem.stamp === stamp) return Promise.resolve(sndMem);
    const keep = (c) => { sndMem = { stamp, files: c.files, set: new Set(c.files), dirs: soundDirs(c.files) }; return sndMem; };
    try { const c = JSON.parse(fs.readFileSync(sndIndexFile, 'utf8')); if (c.stamp === stamp && c.tool === TOOL.tag && Array.isArray(c.files)) return Promise.resolve(keep(c)); } catch { /* нет кэша */ }
    if (!sndBusy) {
      sndBusy = (async () => {
        await ensureTool();
        fs.mkdirSync(cacheDir, { recursive: true });
        log('indexing game sounds');
        const files = parseSoundList(await run(['--input', pak, '--vpk_list', '--vpk_filepath', 'sounds/', '--vpk_extensions', 'vsnd_c']));
        if (!files.length) throw fail('в pak01_dir.vpk не найдено звуков sounds/*.vsnd_c');
        fs.rmSync(sndDir, { recursive: true, force: true }); // звуки старой версии игры
        fs.writeFileSync(sndIndexFile, JSON.stringify({ stamp, tool: TOOL.tag, files }));
        return keep({ files });
      })().finally(() => { sndBusy = null; });
    }
    return sndBusy;
  };
  async function sounds(opts) { const ix = await soundIndex(); return { ...searchSounds(ix.files, opts), dirs: ix.dirs, all: ix.files.length }; }

  const oneBusy = new Map();
  /** Один звук игры по пути: извлекается из VPK и остаётся в кэше игровой ВМ. */
  async function sound(p) {
    const rel = normalizeSoundPath(p);
    if (!rel) throw fail('bad sound path', 400);
    const ix = await soundIndex();
    if (!ix.set.has(rel)) throw fail('такого файла звука в игре нет (возможно, это имя события, а не путь к файлу)', 404);
    const key = require('node:crypto').createHash('sha1').update(rel).digest('hex').slice(0, 16);
    const cached = () => ['mp3', 'wav'].map((e) => path.join(sndDir, `${key}.${e}`)).find((f) => fs.existsSync(f));
    if (!cached()) {
      if (!oneBusy.has(key)) {
        oneBusy.set(key, (async () => {
          fs.mkdirSync(sndDir, { recursive: true });
          const tmpName = `.tmp-${key}`; const tmp = path.join(sndDir, tmpName);
          const clean = () => { for (const e of fs.readdirSync(sndDir)) if (e.startsWith(tmpName)) fs.rmSync(path.join(sndDir, e), { recursive: true, force: true }); };
          clean();
          const r = await exec(bin, ['--input', pak, '--vpk_filepath', rel, '--vpk_decompile', '--output', tmp], { env, timeout: 120000, maxBuffer: 16 << 20 });
          // один файл утилита пишет прямо по пути --output (возможно, со своим расширением), несколько — в каталог
          const found = [];
          for (const e of fs.readdirSync(sndDir)) { if (!e.startsWith(tmpName)) continue; const f = path.join(sndDir, e); if (fs.statSync(f).isDirectory()) found.push(...findAudio(f)); else found.push(f); }
          let done = false;
          for (const f of found) { const buf = fs.readFileSync(f); const ext = sniffAudio(buf); if (ext && buf.length <= MAX_TRACK) { fs.writeFileSync(path.join(sndDir, `${key}.${ext}`), buf); done = true; break; } }
          clean();
          if (!done) throw fail(`Source2Viewer-CLI не выдал аудио для ${rel}: ${tail(r) || 'пусто'}`);
        })().finally(() => oneBusy.delete(key)));
      }
      await oneBusy.get(key);
    }
    const f = cached(); const ext = f.split('.').pop();
    return { path: rel, type: TYPES[ext], b64: fs.readFileSync(f).toString('base64') };
  }

  // ---- логотипы команд из файлов игры (их же показывает клиент по mp_teamlogo_N) ----
  const LOGO_DIR = 'panorama/images/tournaments/teams/';
  const logoIndexFile = path.join(cacheDir, 'logos-index.json'); const logoDir = path.join(cacheDir, '_logos');
  let logoBusy = null;
  const teamLogos = () => {
    if (!fs.existsSync(pak)) return Promise.reject(fail('игра ещё не установлена: нет pak01_dir.vpk'));
    const stamp = pakStamp();
    try { const c = JSON.parse(fs.readFileSync(logoIndexFile, 'utf8')); if (c.stamp === stamp && c.tool === TOOL.tag && Array.isArray(c.codes)) return Promise.resolve(c.codes); } catch { /* нет кэша */ }
    if (!logoBusy) {
      logoBusy = (async () => {
        await ensureTool(); fs.mkdirSync(cacheDir, { recursive: true });
        const codes = parseLogoList(await run(['--input', pak, '--vpk_list', '--vpk_filepath', LOGO_DIR, '--vpk_extensions', 'vsvg_c']));
        if (!codes.length) throw fail('в файлах игры не найдено логотипов команд');
        fs.rmSync(logoDir, { recursive: true, force: true });
        fs.writeFileSync(logoIndexFile, JSON.stringify({ stamp, tool: TOOL.tag, codes }));
        return codes;
      })().finally(() => { logoBusy = null; });
    }
    return logoBusy;
  };
  const logoOne = new Map();
  async function teamLogo(code) {
    const c = String(code || '').toLowerCase();
    if (!LOGO_RE.test(c)) throw fail('bad logo code', 400);
    if (!(await teamLogos()).includes(c)) throw fail('такого логотипа в игре нет', 404);
    const file = path.join(logoDir, `${c}.svg`);
    if (!fs.existsSync(file)) {
      if (!logoOne.has(c)) {
        logoOne.set(c, (async () => {
          fs.mkdirSync(logoDir, { recursive: true });
          const tmpName = `.tmp-${c}`; const tmp = path.join(logoDir, tmpName);
          const clean = () => { for (const e of fs.readdirSync(logoDir)) if (e.startsWith(tmpName)) fs.rmSync(path.join(logoDir, e), { recursive: true, force: true }); };
          clean();
          const r = await exec(bin, ['--input', pak, '--vpk_filepath', `${LOGO_DIR}${c}.vsvg_c`, '--vpk_decompile', '--output', tmp], { env, timeout: 120000, maxBuffer: 16 << 20 });
          const found = [];
          const walk = (f) => { if (fs.statSync(f).isDirectory()) { for (const e of fs.readdirSync(f)) walk(path.join(f, e)); } else found.push(f); };
          for (const e of fs.readdirSync(logoDir)) if (e.startsWith(tmpName)) walk(path.join(logoDir, e));
          let done = false;
          for (const f of found) { const st = fs.statSync(f); if (st.size > 600000) continue; const text = fs.readFileSync(f, 'utf8'); if (/<svg[\s>]/i.test(text)) { fs.writeFileSync(file, text); done = true; break; } }
          clean();
          if (!done) throw fail(`Source2Viewer-CLI не выдал SVG для ${c}: ${tail(r) || 'пусто'}`);
        })().finally(() => logoOne.delete(c)));
      }
      await logoOne.get(c);
    }
    return { code: c, svg: fs.readFileSync(file, 'utf8') };
  }

  return { kit, track, index, ensureTool, sounds, sound, teamLogos, teamLogo };
}

module.exports = { createMusic, parseLogoList, LOGO_RE, normalizeSoundPath, parseSoundList, searchSounds, soundDirs, sniffAudio, SOUND_RE, parseVpkList, parseMusicDefs, findAudio, TOOL, KIT_RE, FILE_RE, TYPES, MAX_TRACK };
