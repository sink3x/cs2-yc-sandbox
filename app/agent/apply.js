'use strict';
// Renders state.json onto the game directory. Idempotent; safe to run before every start and live.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const S = require('../lib/state');
const { readJson, writeFileAtomic, writeJsonAtomic } = require('../lib/util');
const E = require('./env');

function writeIfChanged(file, text) {
  let cur = null;
  try { cur = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  if (cur === text) return false;
  writeFileAtomic(file, text);
  return true;
}

function moveDirs(from, to, names) {
  const moved = [];
  fs.mkdirSync(to, { recursive: true });
  for (const n of names) {
    const src = path.join(from, n);
    const dst = path.join(to, n);
    if (fs.existsSync(src) && !fs.existsSync(dst)) { fs.renameSync(src, dst); moved.push(n); }
  }
  return moved;
}

/** Enable / disable plugins by moving their folders between plugins/ and plugins_disabled/. */
function syncPluginFolders(state, gp = E.gamePaths) {
  const installed = readJson(E.files.installed, {});
  const changed = [];
  for (const p of S.registry) {
    if (p.dependency) continue;
    const dirs = (installed[p.id] && installed[p.id].dirs && installed[p.id].dirs.length) ? installed[p.id].dirs : p.dirs;
    if (state.plugins[p.id]) {
      if (moveDirs(gp.cssPluginsDisabled, gp.cssPlugins, dirs).length) changed.push(`+${p.id}`);
    } else if (moveDirs(gp.cssPlugins, gp.cssPluginsDisabled, dirs).length) changed.push(`-${p.id}`);
  }
  return changed;
}

/** Fill WeaponPaints DB credentials. Returns 'patched' | 'unchanged' | 'missing'. */
/** CounterStrikeSharp writes plugin configs with a leading "// ..." comment; plain JSON.parse chokes on it. */
function readJsonc(file, fallback = null) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
  } catch { return fallback; }
}

function patchWeaponPaints(secrets, gp = E.gamePaths) {
  const cfg = readJsonc(gp.wpConfig, null);
  if (!cfg) return 'missing';
  const want = { DatabaseHost: '127.0.0.1', DatabasePort: 3306, DatabaseUser: 'weaponpaints', DatabasePassword: secrets.DB_PASSWORD || '', DatabaseName: 'weaponpaints', CmdRefreshCooldownSeconds: 3 };
  let changed = false;
  for (const [k, v] of Object.entries(want)) if (cfg[k] !== v) { cfg[k] = v; changed = true; }
  if (changed) writeJsonAtomic(gp.wpConfig, cfg);
  return changed ? 'patched' : 'unchanged';
}

function applyState(state, secrets, gp = E.gamePaths) {
  const changed = [];
  if (!fs.existsSync(gp.gameDir)) return { changed, skipped: 'game directory not installed yet' };
  if (writeIfChanged(gp.serverCfg, S.renderServerCfg(state, secrets))) changed.push('server.cfg');
  if (writeIfChanged(gp.overrides, S.renderOverrides(state))) changed.push('overrides.cfg');
  if (fs.existsSync(gp.css)) {
    if (writeIfChanged(gp.cssAdmins, S.renderCssAdmins(state))) changed.push('admins.json');
    if (writeIfChanged(gp.cssSounds, S.renderSounds(state))) changed.push('sounds.json');
    const core = S.patchCoreJson(readJsonc(gp.cssCore, null), state);
    if (writeIfChanged(gp.cssCore, JSON.stringify(core, null, 2) + '\n')) changed.push('core.json');
  }
  if (writeIfChanged(gp.matchzyAdmins, S.renderMatchzyAdmins(state))) changed.push('MatchZy/admins.json');
  changed.push(...syncPluginFolders(state, gp));
  const wp = state.plugins.weaponpaints ? patchWeaponPaints(secrets, gp) : 'disabled';
  if (wp === 'patched') changed.push('WeaponPaints.json');
  return { changed, weaponPaints: wp };
}

/** Bring MariaDB up to the state the plugins expect (db + user). Best effort. */
function ensureDatabase(secrets) {
  const pw = String(secrets.DB_PASSWORD || '').replace(/[^A-Za-z0-9]/g, '');
  if (!pw) return Promise.resolve('skipped: no DB_PASSWORD');
  const sql = [
    'CREATE DATABASE IF NOT EXISTS weaponpaints CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
    ...['127.0.0.1', 'localhost'].flatMap((h) => [
      `CREATE USER IF NOT EXISTS 'weaponpaints'@'${h}' IDENTIFIED BY '${pw}';`,
      `ALTER USER 'weaponpaints'@'${h}' IDENTIFIED BY '${pw}';`,
      `GRANT ALL PRIVILEGES ON weaponpaints.* TO 'weaponpaints'@'${h}';`,
    ]),
    'FLUSH PRIVILEGES;',
  ].join('\n');
  return new Promise((resolve) => {
    execFile('mysql', ['-uroot', '-e', sql], { timeout: 30000 }, (err, _o, stderr) => resolve(err ? `error: ${String(stderr || err.message).slice(0, 200)}` : 'ok'));
  });
}

module.exports = { applyState, patchWeaponPaints, readJsonc, syncPluginFolders, ensureDatabase, writeIfChanged };
