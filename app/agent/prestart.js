'use strict';
// Runs as root before every start of cs2.service: restore state if the disk is empty, update the game
// and plugins (once per VM boot), render config. Exit code != 0 stops the start (systemd retries).
const fs = require('node:fs');
const E = require('./env');
const S = require('../lib/state');
const I = require('./install');
const { applyState, ensureDatabase } = require('./apply');
const backup = require('./backup');
const { readJson, writeJsonAtomic, makeLogger } = require('../lib/util');

const log = makeLogger('prestart');

function setPhase(phase, detail = '') {
  try { writeJsonAtomic(E.files.phase, { phase, detail, at: new Date().toISOString() }); } catch { /* /run not writable in tests */ }
}

async function main() {
  const secrets = E.loadSecrets();
  const config = E.loadConfig();
  setPhase('init');
  for (const d of [E.dirs.data, E.dirs.cache, E.dirs.server, E.dirs.mysql]) fs.mkdirSync(d, { recursive: true });

  log('ensuring database:', await ensureDatabase(secrets));

  if (!fs.existsSync(E.files.state)) {
    setPhase('restore');
    try { const r = await backup.restoreBackup({}); log('restored latest backup:', r.key); } catch (e) { log('no backup restored:', e.message); }
  }
  if (!fs.existsSync(E.files.state)) {
    const admins = (config.admins || []).map((a) => ({ name: a.name, steamid: a.steamid, flags: ['@css/root'] }));
    writeJsonAtomic(E.files.state, S.defaultState({ hostname: config.hostname || 'sandbox-cs-1', admins }));
    log('created default state.json');
  }
  const state = readJson(E.files.state);

  const firstSinceBoot = !fs.existsSync(E.files.updatedMarker);
  const forced = fs.existsSync(E.files.forceUpdate);
  if (!I.gameInstalled() || forced || (firstSinceBoot && state.flags.autoUpdateGame)) {
    await I.updateGame(setPhase);
  }
  if (!I.gameInstalled()) throw new Error('CS2 is not installed after update');

  if (!fs.existsSync(E.gamePaths.css) || forced || (firstSinceBoot && state.flags.autoUpdatePlugins)) {
    const errors = await I.installPlugins(state, setPhase);
    if (errors.length) log(`plugin install finished with ${errors.length} error(s)`);
  } else {
    try { I.patchGameInfo(); } catch (e) { log('gameinfo:', e.message); }
  }

  setPhase('configure');
  const res = applyState(readJson(E.files.state), secrets);
  log('applied:', JSON.stringify(res));

  await I.run('chown', ['-R', 'steam:steam', E.dirs.server, E.dirs.data]);
  fs.rmSync(E.files.forceUpdate, { force: true });
  fs.writeFileSync(E.files.updatedMarker, new Date().toISOString());
  setPhase('starting');
}

main().catch((e) => { setPhase('failed', e.message); console.error('[prestart] FATAL', e.stack || e.message); process.exit(1); });
