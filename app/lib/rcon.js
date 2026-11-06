'use strict';
// Minimal Source RCON client (TCP). Used by the agent against 127.0.0.1:27015.
const net = require('node:net');

const T_AUTH = 3;
const T_AUTH_RESP = 2;
const T_EXEC = 2;
const T_RESP = 0;

function pack(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

class PacketParser {
  constructor() { this.buf = Buffer.alloc(0); }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out = [];
    while (this.buf.length >= 4) {
      const size = this.buf.readInt32LE(0);
      if (size < 10 || size > 1 << 20) throw new Error(`rcon: bad packet size ${size}`);
      if (this.buf.length < 4 + size) break;
      const id = this.buf.readInt32LE(4);
      const type = this.buf.readInt32LE(8);
      const body = this.buf.subarray(12, 4 + size - 2).toString('utf8');
      out.push({ id, type, body });
      this.buf = this.buf.subarray(4 + size);
    }
    return out;
  }
}

/**
 * Run one or more commands over a single authenticated RCON connection.
 * Returns an array of output strings (same order as `commands`).
 */
function rcon({ host = '127.0.0.1', port = 27015, password, commands, timeoutMs = 8000, idleMs = 350 }) {
  const cmds = Array.isArray(commands) ? commands : [commands];
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const parser = new PacketParser();
    const results = [];
    let state = 'auth';
    let idx = 0;
    let cur = '';
    let gotAny = false;
    let idleTimer = null;
    let done = false;
    const AUTH_ID = 1;
    const CMD_ID = 100;
    const SENTINEL_ID = 101;

    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(overall);
      clearTimeout(idleTimer);
      sock.destroy();
      if (err) reject(err); else resolve(results);
    };
    const overall = setTimeout(() => finish(new Error('rcon: timeout')), timeoutMs);

    const nextCommand = () => {
      if (idx >= cmds.length) return finish();
      cur = '';
      gotAny = false;
      state = 'exec';
      sock.write(pack(CMD_ID, T_EXEC, cmds[idx]));
      sock.write(pack(SENTINEL_ID, T_RESP, ''));
    };
    const completeCommand = () => {
      clearTimeout(idleTimer);
      results.push(cur);
      idx += 1;
      nextCommand();
    };

    sock.on('connect', () => sock.write(pack(AUTH_ID, T_AUTH, password || '')));
    sock.on('error', (e) => finish(e));
    sock.on('close', () => { if (!done) finish(new Error('rcon: connection closed')); });
    sock.on('data', (chunk) => {
      let packets;
      try { packets = parser.push(chunk); } catch (e) { return finish(e); }
      for (const p of packets) {
        if (state === 'auth') {
          if (p.type === T_AUTH_RESP) {
            if (p.id === -1) return finish(new Error('rcon: authentication failed'));
            nextCommand();
          }
          continue;
        }
        if (p.id === SENTINEL_ID) { completeCommand(); continue; }
        if (p.id === CMD_ID && p.type === T_RESP) {
          cur += p.body;
          gotAny = true;
          clearTimeout(idleTimer);
          // Some builds never echo the sentinel; fall back to an idle window.
          idleTimer = setTimeout(() => { if (gotAny) completeCommand(); }, idleMs + 650);
        }
      }
    });
  });
}

/** Parse the output of the `status` command (Source 2 format) into a compact summary. */
function parseStatus(text) {
  const out = { map: null, hostname: null, players: [], humans: 0, bots: 0, maxPlayers: null, version: null };
  const t = String(text || '');
  let m;
  if ((m = /hostname\s*:\s*(.+)/i.exec(t))) out.hostname = m[1].trim();
  if ((m = /version\s*:\s*(.+)/i.exec(t))) out.version = m[1].trim();
  if ((m = /spawn(?:group)?\s*\d*[^\n]*map(?:name)?[:=\s]+([A-Za-z0-9_\-/.]+)/i.exec(t))) out.map = m[1].trim();
  if (!out.map && (m = /map\s*:\s*([A-Za-z0-9_\-/.]+)/i.exec(t))) out.map = m[1].trim();
  if ((m = /players\s*:\s*(\d+)\s*humans?,\s*(\d+)\s*bots?\s*\((\d+)(?:\s*\/\s*\d+)?\s*max/i.exec(t))) {
    out.humans = Number(m[1]); out.bots = Number(m[2]); out.maxPlayers = Number(m[3]);
  }
  for (const line of t.split('\n')) {
    // "  2   00:35   42    0     active 786432 192.0.2.1:27005 'name'"
    const pm = /^\s*(\d+)\s+(\d+:\d+(?::\d+)?|BOT)\s+(\d+)\s+(\d+)\s+(\w+)\s+\d+\s+(\S+)\s+'(.*)'\s*$/.exec(line);
    if (pm) out.players.push({ id: Number(pm[1]), time: pm[2], ping: Number(pm[3]), state: pm[5], addr: pm[6], name: pm[7], bot: pm[2] === 'BOT' || pm[6] === 'BOT' });
  }
  if (!out.humans && out.players.length) out.humans = out.players.filter((p) => !p.bot).length;
  return out;
}

module.exports = { rcon, pack, PacketParser, parseStatus, T_AUTH, T_AUTH_RESP, T_EXEC, T_RESP };
