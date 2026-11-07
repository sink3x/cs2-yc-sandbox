'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCleanup, pruneOld } = require('../agent/cleanup');

test('pruneOld deletes only old matching regular files and never follows symlinks', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'keep.log'), 'x');
  fs.symlinkSync(outside, path.join(d, 'link'));
  const old = path.join(d, 'old.log'); const fresh = path.join(d, 'fresh.log'); const other = path.join(d, 'old.txt');
  for (const f of [old, fresh, other]) fs.writeFileSync(f, 'abcd');
  const past = new Date(Date.now() - 10 * 86400000); fs.utimesSync(old, past, past); fs.utimesSync(other, past, past);
  const r = pruneOld(d, { maxAgeMs: 86400000, filter: (p) => p.endsWith('.log') });
  assert.deepEqual(r, { files: 1, bytes: 4 });
  assert.ok(!fs.existsSync(old)); assert.ok(fs.existsSync(fresh)); assert.ok(fs.existsSync(other)); assert.ok(fs.existsSync(path.join(outside, 'keep.log')));
});

test('runCleanup runs the requested actions and reports memory; world needs rcon', async () => {
  const calls = []; let free = 1000;
  const readMem = () => `MemTotal: 8000000 kB\nMemAvailable: ${free * 1024} kB\nCached: 500000 kB\n`;
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-'));
  const res = await runCleanup(['files', 'journal', 'world', 'ram', 'bogus'], {
    exec: async (c, a) => { calls.push(c); return { ok: true }; }, rcon: async (c) => { calls.push(c[0]); }, gameDir, readMem, dropCaches: () => { calls.push('drop'); free = 3000; }, coreDumpDir: path.join(gameDir, 'nocore'),
  });
  assert.deepEqual(calls, ['journalctl', 'mp_restartgame 1', 'sync', 'drop']);
  assert.deepEqual(res.done.map((x) => x.action), ['files', 'journal', 'world', 'ram']);
  assert.equal(res.freedMb, 2000);
  const off = await runCleanup(['world'], { exec: async () => ({ ok: true }), rcon: async () => { throw new Error('refused'); }, gameDir, readMem });
  assert.equal(off.skipped[0].action, 'world');
});
