'use strict';
// Small shared helpers. No dependencies; works on Node >= 18.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined && (e.code === 'ENOENT' || e instanceof SyntaxError)) return fallback;
    throw e;
  }
}

function writeFileAtomic(file, text, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, data, mode = 0o644) {
  writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n', mode);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

const STEAMID64_RE = /^7656119\d{10}$/;
const CVAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;
const MAP_RE = /^[A-Za-z0-9_\-]{1,64}$/;
const WORKSHOP_RE = /^\d{6,12}$/;

/** A cvar value must never be able to break out of a quoted cfg line or chain commands. */
function cvarValueOk(v) {
  return typeof v === 'string' && v.length <= 256 && !/[;"\\\r\n\0]/.test(v);
}

function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function loadEnvFile(file) {
  try {
    return parseEnvFile(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeLogger(scope) {
  return (...args) => console.log(new Date().toISOString(), `[${scope}]`, ...args);
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  readJson, writeFileAtomic, writeJsonAtomic, safeEqual, STEAMID64_RE, CVAR_NAME_RE, MAP_RE,
  WORKSHOP_RE, cvarValueOk, parseEnvFile, loadEnvFile, sleep, makeLogger, randomToken,
};
