'use strict';
// Очистка кэшей и мусора, чтобы сервер не лагал: страничный кэш ОС, журнал systemd, старые логи/демо/крэш-дампы, мир на карте.
const fs = require('node:fs');
const path = require('node:path');

const DAY = 86_400_000;

function memInfo(read = () => fs.readFileSync('/proc/meminfo', 'utf8')) {
  const o = {};
  for (const l of String(read()).split('\n')) { const m = /^(\w+):\s+(\d+)/.exec(l); if (m) o[m[1]] = Number(m[2]); }
  return { freeMb: Math.round((o.MemAvailable || 0) / 1024), cachedMb: Math.round((o.Cached || 0) / 1024), totalMb: Math.round((o.MemTotal || 0) / 1024) };
}

/** Удаляет обычные файлы старше maxAgeMs, подходящие под filter; симлинки не трогает. Возвращает {files, bytes}. */
function pruneOld(dir, { maxAgeMs, filter = () => true, now = Date.now(), depth = 3, dry = false } = {}) {
  const res = { files: 0, bytes: 0 };
  const walk = (d, lvl) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (lvl < depth) walk(p, lvl + 1); continue; }
      if (!e.isFile() || !filter(p)) continue;
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs < maxAgeMs) continue;
        if (!dry) fs.unlinkSync(p);
        res.files++; res.bytes += st.size;
      } catch { /* занят или уже удалён */ }
    }
  };
  walk(dir, 0);
  return res;
}

/**
 * actions: ram | journal | files | world. deps: {exec, rcon, dirs, gameDir, now, dropCaches}
 * world требует работающего CS2 (rcon) — рестарт раунда убирает выпавшее оружие, декали и лишние сущности.
 */
async function runCleanup(actions, deps) {
  const { exec, rcon, gameDir, now = Date.now(), dropCaches = (() => fs.writeFileSync('/proc/sys/vm/drop_caches', '3')) } = deps;
  const out = { done: [], skipped: [], freedMb: 0, mem: { before: memInfo(deps.readMem) } };
  const want = new Set(actions);
  if (want.has('files')) {
    let bytes = 0; let files = 0;
    const targets = [
      [path.join(gameDir, 'addons/counterstrikesharp/logs'), { maxAgeMs: 3 * DAY }],
      [path.join(gameDir, 'logs'), { maxAgeMs: 3 * DAY }],
      [gameDir, { maxAgeMs: 7 * DAY, depth: 0, filter: (p) => /\.(dem|dem\.bz2|mdmp|dmp)$/i.test(p) }],
      ['/tmp', { maxAgeMs: 2 * DAY, depth: 1, filter: (p) => /\.(log|tmp|tgz|tar|zip|json)$/i.test(p) }],
      [deps.coreDumpDir || '/var/lib/systemd/coredump', { maxAgeMs: DAY }],
    ];
    for (const [dir, o] of targets) { const r = pruneOld(dir, { now, ...o }); bytes += r.bytes; files += r.files; }
    out.done.push({ action: 'files', files, mb: Math.round(bytes / 1048576) });
  }
  if (want.has('journal')) {
    const r = await exec('journalctl', ['--vacuum-size=100M', '--vacuum-time=7d']);
    out.done.push({ action: 'journal', ok: r.ok });
  }
  if (want.has('world')) {
    try { await rcon(['mp_restartgame 1']); out.done.push({ action: 'world', ok: true }); } catch (e) { out.skipped.push({ action: 'world', reason: `CS2 не отвечает: ${e.message}` }); }
  }
  if (want.has('ram')) {
    try { await exec('sync', []); dropCaches(); out.done.push({ action: 'ram', ok: true }); } catch (e) { out.skipped.push({ action: 'ram', reason: e.message }); }
  }
  out.mem.after = memInfo(deps.readMem);
  out.freedMb = Math.max(0, out.mem.after.freeMb - out.mem.before.freeMb);
  return out;
}

module.exports = { runCleanup, pruneOld, memInfo };
