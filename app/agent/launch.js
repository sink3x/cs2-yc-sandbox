'use strict';
// ExecStart of cs2.service (runs as user "steam"): builds the argument vector from state.json and runs cs2.
const path = require('node:path');
const { spawn } = require('node:child_process');
const E = require('./env');
const S = require('../lib/state');
const { readJson, makeLogger } = require('../lib/util');

const log = makeLogger('launch');
const state = readJson(E.files.state);
const args = S.launchArgs(state, E.loadGameSecrets());
const cwd = path.dirname(E.cs2Bin);
const libs = [cwd, path.join(E.dirs.server, 'game/csgo/bin/linuxsteamrt64'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

log('starting cs2 with', args.map((a, i) => (args[i - 1] === '+sv_setsteamaccount' || args[i - 1] === '-authkey' ? '***' : a)).join(' '));
const child = spawn(E.cs2Bin, args, { cwd, stdio: 'inherit', env: { ...process.env, LD_LIBRARY_PATH: libs, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('error', (e) => { console.error('[launch] spawn failed:', e.message); process.exit(1); });
child.on('close', (code, signal) => { log(`cs2 exited code=${code} signal=${signal}`); process.exit(code === null ? 0 : code); });
