'use strict';
// Backups of everything that is NOT the 60 GB game itself: state, plugin configs, MySQL dump.
// Stored in Yandex Object Storage under cs2/<timestamp>.tgz, last N kept.
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { S3 } = require('../lib/s3');
const E = require('./env');
const { makeLogger } = require('../lib/util');

const log = makeLogger('backup');
const PREFIX = 'cs2/';
const KEEP = 14;
const LAST_MARK = '/run/cs2-last-backup';

function s3Client(secrets = E.loadSecrets(), config = E.loadConfig()) {
  if (!config.bucket || !secrets.S3_ACCESS_KEY) return null;
  return new S3({ endpoint: config.endpoint, region: config.region, bucket: config.bucket, accessKey: secrets.S3_ACCESS_KEY, secretKey: secrets.S3_SECRET_KEY });
}

const exec = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 64 << 20, ...opts }, (e, out, err) => (e ? reject(new Error(`${cmd}: ${String(err || e.message).slice(0, 300)}`)) : resolve(out)));
});

function dumpDatabase(dest) {
  return new Promise((resolve) => {
    const dump = spawn('sh', ['-c', `mysqldump -uroot --all-databases --single-transaction --routines | gzip > '${dest}'`], { stdio: 'ignore' });
    dump.on('error', () => resolve(false));
    dump.on('close', (code) => resolve(code === 0));
  });
}

async function createBackup({ s3 = s3Client(), reason = 'manual' } = {}) {
  if (!s3) throw new Error('backup: object storage is not configured');
  if (!fs.existsSync(E.files.state)) throw new Error('backup: nothing to back up yet (no state.json)');
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}Z/g, '').replace('T', '-');
  const dumpPath = path.join(E.dirs.data, 'db-dump.sql.gz');
  const hasDb = await dumpDatabase(dumpPath);
  const rel = (p) => path.relative(E.dirs.root, p);
  const gp = E.gamePaths;
  const candidates = [E.files.state, E.files.installed, hasDb ? dumpPath : null,
    path.join(gp.cfgDir, 'sandbox'), path.join(gp.cfgDir, 'MatchZy'), path.join(gp.css, 'configs')]
    .filter((p) => p && fs.existsSync(p)).map(rel);
  const tmp = path.join(E.dirs.cache, `backup-${stamp}.tgz`);
  fs.mkdirSync(E.dirs.cache, { recursive: true });
  await exec('tar', ['czf', tmp, '-C', E.dirs.root, ...candidates]);
  const body = fs.readFileSync(tmp);
  const key = `${PREFIX}${stamp}-${reason}.tgz`;
  await s3.put(key, body);
  fs.rmSync(tmp, { force: true });
  fs.rmSync(dumpPath, { force: true });
  log(`uploaded ${key} (${body.length} bytes)`);
  try { fs.writeFileSync(LAST_MARK, String(Date.now())); } catch { /* /run not writable in tests */ }
  const all = (await s3.list(PREFIX)).sort((a, b) => a.key.localeCompare(b.key));
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) { await s3.del(old.key); log('pruned', old.key); }
  return { key, size: body.length };
}

async function listBackups(s3 = s3Client()) {
  if (!s3) return [];
  return (await s3.list(PREFIX)).sort((a, b) => b.key.localeCompare(a.key));
}

/**
 * Восстановление идёт от root, а архив лежит в бакете: прежде чем распаковывать, смотрим оглавление. Только обычные файлы и каталоги,
 * внутри корня сервера (без абсолютных путей и «..», без ссылок и устройств, которыми можно выйти за его пределы).
 */
async function assertSafeArchive(file) {
  const out = await exec('tar', ['tzvf', file], { maxBuffer: 64 << 20 });
  for (const line of out.split('\n').filter(Boolean)) {
    const type = line[0];
    const name = line.replace(/^\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+/, '');
    if (type !== '-' && type !== 'd') throw new Error(`restore: unsafe entry in the archive (${type}): ${name.slice(0, 80)}`);
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`restore: unsafe path in the archive: ${name.slice(0, 80)}`);
  }
}

async function restoreBackup({ key = 'latest', s3 = s3Client() } = {}) {
  if (!s3) throw new Error('restore: object storage is not configured');
  let k = key;
  if (key === 'latest') {
    const list = await listBackups(s3);
    if (!list.length) throw new Error('restore: no backups found');
    k = list[0].key;
  }
  if (!k.startsWith(PREFIX) || k.includes('..')) throw new Error('restore: bad key');
  const tmp = path.join(E.dirs.cache, 'restore.tgz');
  fs.mkdirSync(E.dirs.cache, { recursive: true });
  fs.writeFileSync(tmp, await s3.get(k));
  await assertSafeArchive(tmp);
  await exec('tar', ['xzf', tmp, '-C', E.dirs.root, '--no-same-owner']);
  fs.rmSync(tmp, { force: true });
  const dumpPath = path.join(E.dirs.data, 'db-dump.sql.gz');
  if (fs.existsSync(dumpPath)) {
    await new Promise((resolve) => {
      const p = spawn('sh', ['-c', `gunzip -c '${dumpPath}' | mysql -uroot`], { stdio: 'ignore' });
      p.on('close', resolve); p.on('error', resolve);
    });
    fs.rmSync(dumpPath, { force: true });
  }
  log('restored', k);
  return { key: k };
}

module.exports = { createBackup, listBackups, restoreBackup, s3Client, assertSafeArchive };

if (require.main === module) {
  const cmd = process.argv[2];
  const reason = process.argv[3] || 'cli';
  // `backup <reason> --if-stale`: skip when a backup was uploaded in the last 15 minutes (shutdown safety net).
  let recent = false;
  if (process.argv.includes('--if-stale')) {
    try { recent = Date.now() - Number(fs.readFileSync(LAST_MARK, 'utf8')) < 15 * 60_000; } catch { /* no marker */ }
  }
  const job = recent ? Promise.resolve({ skipped: 'recent backup exists' })
    : cmd === 'restore' ? restoreBackup({ key: process.argv[3] || 'latest' }) : createBackup({ reason });
  job.then((r) => { console.log(JSON.stringify(r)); }).catch((e) => { console.error(e.message); process.exit(1); });
}
