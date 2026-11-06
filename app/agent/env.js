'use strict';
// Paths and configuration of the CS2 VM. CS2_ROOT / CS2_ETC can be overridden for tests.
const path = require('node:path');
const { loadEnvFile, readJson } = require('../lib/util');
const { paths } = require('../lib/state');

const ROOT = process.env.CS2_ROOT || '/srv/cs2';
const ETC = process.env.CS2_ETC || '/etc/cs2';

const dirs = {
  root: ROOT,
  data: path.join(ROOT, 'data'),
  server: path.join(ROOT, 'server'),
  steamcmd: path.join(ROOT, 'steamcmd'),
  cache: path.join(ROOT, 'data/cache'),
  mysql: path.join(ROOT, 'mysql'),
};
const files = {
  state: path.join(dirs.data, 'state.json'),
  installed: path.join(dirs.data, 'installed.json'),
  phase: '/run/cs2-phase.json',
  updatedMarker: '/run/cs2-prestart-done',
  forceUpdate: path.join(dirs.data, 'force-update'),
  secrets: path.join(ETC, 'secrets.env'), // root only: AGENT_TOKEN, S3 keys
  gameSecrets: path.join(ETC, 'game.env'), // readable by user steam: RCON, GSLT, DB, Steam API key
  config: path.join(ETC, 'config.json'),
};
const gamePaths = paths(path.join(dirs.server, 'game/csgo'));
const cs2Bin = path.join(dirs.server, 'game/bin/linuxsteamrt64/cs2');

const loadGameSecrets = () => loadEnvFile(files.gameSecrets);
const loadSecrets = () => ({ ...loadGameSecrets(), ...loadEnvFile(files.secrets) });
const loadConfig = () => readJson(files.config, {});

module.exports = { ROOT, ETC, dirs, files, gamePaths, cs2Bin, loadSecrets, loadGameSecrets, loadConfig };
