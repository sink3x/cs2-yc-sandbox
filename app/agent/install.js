'use strict';
// Installs / updates SteamCMD, CS2, Metamod, CounterStrikeSharp and plugins. Used from prestart.js.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const E = require('./env');
const S = require('../lib/state');
const { readJson, writeJsonAtomic, makeLogger, sleep } = require('../lib/util');

const log = makeLogger('install');
const UA = { 'User-Agent': 'cs2-yc-sandbox-agent', Accept: 'application/vnd.github+json' };

function run(cmd, args, { cwd, env, timeoutMs = 0, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: quiet ? 'ignore' : 'inherit' });
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')} exited with ${code}`));
    });
  });
}
const capture = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 16 << 20 }, (e, out) => (e ? reject(e) : resolve(out)));
});

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'] }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}

async function ghLatest(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: UA });
  if (!res.ok) throw new Error(`github ${repo}: HTTP ${res.status}`);
  return res.json();
}

const installedDb = () => readJson(E.files.installed, {});
const saveInstalled = (db) => writeJsonAtomic(E.files.installed, db);

async function ensureSteamcmd() {
  const sh = path.join(E.dirs.steamcmd, 'steamcmd.sh');
  if (fs.existsSync(sh)) return;
  log('downloading SteamCMD');
  const tgz = path.join(E.dirs.cache, 'steamcmd_linux.tar.gz');
  const urls = ['https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz', 'https://media.steampowered.com/installer/steamcmd_linux.tar.gz'];
  let lastErr;
  for (const u of urls) { try { await download(u, tgz); lastErr = null; break; } catch (e) { lastErr = e; } }
  if (lastErr) throw lastErr;
  fs.mkdirSync(E.dirs.steamcmd, { recursive: true });
  await run('tar', ['xzf', tgz, '-C', E.dirs.steamcmd]);
  await run('chown', ['-R', 'steam:steam', E.dirs.steamcmd]);
}

async function updateGame(setPhase) {
  await ensureSteamcmd();
  fs.mkdirSync(E.dirs.server, { recursive: true });
  await run('chown', ['steam:steam', E.dirs.server]);
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    setPhase('update-game', `steamcmd app_update 730 (attempt ${attempt})`);
    log(`steamcmd app_update 730, attempt ${attempt}`);
    try {
      await run('runuser', ['-u', 'steam', '--', path.join(E.dirs.steamcmd, 'steamcmd.sh'),
        '+force_install_dir', E.dirs.server, '+login', 'anonymous', '+app_update', '730', '+quit']);
      lastErr = null;
      break;
    } catch (e) { lastErr = e; log('steamcmd failed:', e.message); await sleep(5000); }
  }
  if (lastErr) throw lastErr;
  // steamclient.so for the server's Steam API
  const sdk = '/home/steam/.steam/sdk64';
  fs.mkdirSync(sdk, { recursive: true });
  const target = path.join(E.dirs.steamcmd, 'linux64/steamclient.so');
  const link = path.join(sdk, 'steamclient.so');
  try { fs.rmSync(link, { force: true }); fs.symlinkSync(target, link); } catch (e) { log('steamclient link:', e.message); }
  await run('chown', ['-R', 'steam:steam', '/home/steam/.steam']);
}

function gameInstalled() { return fs.existsSync(E.cs2Bin) && fs.existsSync(path.join(E.gamePaths.gameDir, 'gameinfo.gi')); }

/** Adds `Game csgo/addons/metamod` to SearchPaths (Valve overwrites gameinfo.gi on every game update). */
function patchGameInfo() {
  const file = path.join(E.gamePaths.gameDir, 'gameinfo.gi');
  const txt = fs.readFileSync(file, 'utf8');
  if (/csgo\/addons\/metamod/.test(txt)) return false;
  const next = txt.replace(/^(\s*)Game(\s+)csgo\s*$/m, '$1Game$2csgo/addons/metamod\n$1Game$2csgo');
  if (next === txt) throw new Error('gameinfo.gi: could not find the "Game csgo" search path line');
  fs.writeFileSync(file, next);
  return true;
}

async function unzipInto(zip, destRoot) {
  fs.mkdirSync(destRoot, { recursive: true });
  await run('unzip', ['-o', '-q', zip, '-d', destRoot]);
}

async function installMetamod() {
  const base = 'https://mms.alliedmods.net/mmsdrop/2.0/';
  const name = (await (await fetch(`${base}mmsource-latest-linux`, { headers: { 'User-Agent': UA['User-Agent'] } })).text()).trim();
  if (!/^mmsource-[\w.\-]+\.tar\.gz$/.test(name)) throw new Error(`metamod: unexpected latest file "${name}"`);
  const db = installedDb();
  const present = fs.existsSync(path.join(E.gamePaths.gameDir, 'addons/metamod'));
  if (!(db.metamod && db.metamod.tag === name && present)) {
    log('installing Metamod', name);
    const tgz = await download(base + name, path.join(E.dirs.cache, name));
    await run('tar', ['xzf', tgz, '-C', E.gamePaths.gameDir]);
    db.metamod = { tag: name, installedAt: new Date().toISOString() };
    saveInstalled(db);
  }
  if (patchGameInfo()) log('patched gameinfo.gi for Metamod');
}

async function installCss() {
  const rel = await ghLatest('roflmuffin/CounterStrikeSharp');
  const asset = rel.assets.find((a) => /with-runtime.*linux.*\.zip$/i.test(a.name)) || rel.assets.find((a) => /linux.*\.zip$/i.test(a.name));
  if (!asset) throw new Error(`CounterStrikeSharp ${rel.tag_name}: no linux asset`);
  const db = installedDb();
  if (db.css && db.css.tag === rel.tag_name && fs.existsSync(E.gamePaths.css)) return;
  log('installing CounterStrikeSharp', rel.tag_name, asset.name);
  const zip = await download(asset.browser_download_url, path.join(E.dirs.cache, asset.name));
  await unzipInto(zip, E.gamePaths.gameDir);
  db.css = { tag: rel.tag_name, asset: asset.name, installedAt: new Date().toISOString() };
  saveInstalled(db);
}

const lsDirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name); } catch { return []; } };

const BUNDLED_DIR = path.join(__dirname, '..', 'plugins-bundled');

/** Свой плагин из бандла панели (репозиторий приватный — с GitHub агент его не скачает). Тег = хэш файла: новый zip → переустановка. */
function bundledRelease(p) {
  const file = path.join(BUNDLED_DIR, p.bundled);
  if (path.basename(p.bundled) !== p.bundled || !fs.existsSync(file)) throw new Error(`${p.id}: bundled file ${p.bundled} is missing`);
  const tag = `bundled-${require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12)}`;
  return { file, rel: { tag_name: tag }, asset: { name: p.bundled } };
}

async function installPlugin(p) {
  let rel; let asset; let bundledFile = null;
  if (p.bundled) { const b = bundledRelease(p); rel = b.rel; asset = b.asset; bundledFile = b.file; } else {
    rel = await ghLatest(p.repo);
    const re = new RegExp(p.asset, 'i');
    asset = rel.assets.find((a) => re.test(a.name)) || rel.assets.find((a) => /\.zip$/i.test(a.name) && !/windows|win64|source/i.test(a.name));
    if (!asset) throw new Error(`${p.id} ${rel.tag_name}: no matching asset (${rel.assets.map((a) => a.name).join(', ')})`);
  }
  const db = installedDb();
  const gp = E.gamePaths;
  const known = db[p.id];
  const stillThere = known && (known.dirs || []).every((d) => fs.existsSync(path.join(gp.cssPlugins, d)) || fs.existsSync(path.join(gp.cssPluginsDisabled, d)));
  if (known && known.tag === rel.tag_name && stillThere) return;
  log('installing plugin', p.id, rel.tag_name, asset.name);
  const zip = bundledFile || await download(asset.browser_download_url, path.join(E.dirs.cache, `${p.id}-${asset.name}`));
  const entries = (await capture('unzip', ['-Z1', zip])).split('\n').map((x) => x.trim()).filter(Boolean);
  const before = new Set([...lsDirs(gp.cssPlugins), ...lsDirs(gp.cssPluginsDisabled)]);
  let dest;
  if (entries.some((x) => x.startsWith('game/'))) dest = E.dirs.server;
  else if (entries.some((x) => x.startsWith('addons/') || x.startsWith('cfg/'))) dest = gp.gameDir;
  else if (entries.some((x) => /^(plugins|shared|gamedata|configs)\//.test(x))) dest = gp.css;
  else dest = gp.cssPlugins;
  await unzipInto(zip, dest);
  const added = lsDirs(gp.cssPlugins).filter((d) => !before.has(d));
  db[p.id] = { tag: rel.tag_name, asset: asset.name, installedAt: new Date().toISOString(), dirs: added.length ? added : ((known && known.dirs) || p.dirs) };
  saveInstalled(db);
}

/** Install everything the state needs; failures of single plugins are logged but not fatal. */
async function installPlugins(state, setPhase) {
  const errors = [];
  const step = async (name, fn) => {
    setPhase('plugins', name);
    try { await fn(); } catch (e) { log(`ERROR ${name}: ${e.message}`); errors.push(`${name}: ${e.message}`); }
  };
  await step('metamod', installMetamod);
  await step('counterstrikesharp', installCss);
  for (const id of S.requiredPlugins(state)) {
    const p = S.registry.find((x) => x.id === id);
    await step(id, () => installPlugin(p));
  }
  return errors;
}

module.exports = { bundledRelease, run, updateGame, gameInstalled, installPlugins, installMetamod, installCss, patchGameInfo, ensureSteamcmd };
