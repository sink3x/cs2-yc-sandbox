'use strict';
// Свои аудиофайлы: проверка имени и содержимого, хранение в каталоге, манифест для сверки панели и игровой ВМ.
// Используется и панелью (источник правды), и агентом (копия на игровой ВМ).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}\.(wav|mp3|ogg)$/;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_TOTAL = 100 * 1024 * 1024;
const TYPES = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' };

const err = (m, status = 400) => Object.assign(new Error(m), { status });
const extOf = (name) => name.slice(name.lastIndexOf('.') + 1);

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const translit = (t) => t.replace(/[а-яё]/g, (c) => TRANSLIT[c]);

/** Имя из файла пользователя → допустимое имя (латиница, цифры, _ -); null, если расширение не годится. */
function normalizeName(raw) {
  const s = String(raw || '').split(/[\\/]/).pop().toLowerCase();
  const m = /^(.*)\.(wav|mp3|ogg)$/.exec(s);
  if (!m) return null;
  const base = translit(m[1]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sound';
  return `${base}.${m[2]}`;
}

/** Содержимое должно совпадать с расширением: нельзя положить под видом .wav что-то иное. */
function checkContent(name, buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw err('empty file');
  if (buf.length > MAX_FILE) throw err('file too large (max 8 MB)', 413);
  const ext = extOf(name);
  const ok = ext === 'wav' ? buf.length > 44 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE'
    : ext === 'ogg' ? buf.toString('latin1', 0, 4) === 'OggS'
      : (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0));
  if (!ok) throw err(`content does not look like .${ext}`);
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

function createStore(dir) {
  const file = (name) => {
    if (!NAME_RE.test(String(name))) throw err('bad file name');
    return path.join(dir, name);
  };
  function list() {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => NAME_RE.test(n)); } catch { /* каталога ещё нет */ }
    return names.sort().map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtime: Math.floor(st.mtimeMs), sha1: sha1(fs.readFileSync(path.join(dir, name))) };
    });
  }
  function put(name, buf, { overwrite = true } = {}) {
    const f = file(name); checkContent(name, buf);
    const cur = list(); const had = cur.find((x) => x.name === name);
    if (had && !overwrite) throw err('file already exists', 409);
    if (!had && cur.length >= MAX_FILES) throw err(`too many files (max ${MAX_FILES})`, 409);
    if (cur.reduce((a, x) => a + (x.name === name ? 0 : x.size), 0) + buf.length > MAX_TOTAL) throw err('storage limit reached (100 MB)', 409);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${f}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buf, { mode: 0o644 }); fs.renameSync(tmp, f);
    return { name, size: buf.length, sha1: sha1(buf) };
  }
  function read(name) {
    const f = file(name);
    if (!fs.existsSync(f)) throw err('no such file', 404);
    return fs.readFileSync(f);
  }
  function remove(name) {
    const f = file(name);
    if (!fs.existsSync(f)) throw err('no such file', 404);
    fs.unlinkSync(f);
  }
  function rename(from, to) {
    const a = file(from); const b = file(to);
    if (extOf(from) !== extOf(to)) throw err('extension cannot change');
    if (!fs.existsSync(a)) throw err('no such file', 404);
    if (from !== to && fs.existsSync(b)) throw err('file already exists', 409);
    fs.renameSync(a, b);
  }
  /** Отпечаток набора: меняется при любом добавлении/удалении/замене/переименовании. */
  const fingerprint = () => sha1(Buffer.from(list().map((x) => `${x.name}:${x.sha1}`).join('\n')));
  return { dir, list, put, read, remove, rename, fingerprint };
}

module.exports = { NAME_RE, MAX_FILE, MAX_FILES, MAX_TOTAL, TYPES, normalizeName, checkContent, createStore, extOf };
