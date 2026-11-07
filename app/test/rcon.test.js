'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { rcon, pack, PacketParser, parseStatus, T_AUTH_RESP, T_RESP } = require('../lib/rcon');

function mockServer(password, replies) {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      const p = new PacketParser();
      sock.on('data', (c) => {
        for (const pkt of p.push(c)) {
          if (pkt.type === 3) {
            sock.write(pack(pkt.id, 0, ''));
            sock.write(pack(pkt.body === password ? pkt.id : -1, T_AUTH_RESP, ''));
          } else if (pkt.type === 2) {
            const out = replies[pkt.body] ?? `unknown command ${pkt.body}`;
            sock.write(pack(pkt.id, T_RESP, out));
          } else if (pkt.type === 0) {
            sock.write(pack(pkt.id, T_RESP, '')); // sentinel echo
          }
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('rcon runs several commands over one connection', async () => {
  const srv = await mockServer('pw', { status: 'hostname: x', 'echo hi': 'hi' });
  try {
    const out = await rcon({ port: srv.address().port, password: 'pw', commands: ['status', 'echo hi'], timeoutMs: 3000 });
    assert.deepEqual(out, ['hostname: x', 'hi']);
  } finally { srv.close(); }
});

test('rcon rejects a wrong password', async () => {
  const srv = await mockServer('pw', {});
  try {
    await assert.rejects(rcon({ port: srv.address().port, password: 'nope', commands: 'status', timeoutMs: 3000 }), /authentication failed/);
  } finally { srv.close(); }
});

test('rcon fails fast when nothing listens', async () => {
  await assert.rejects(rcon({ port: 1, password: 'x', commands: 'status', timeoutMs: 1000 }));
});

test('parseStatus reads map, players and counts', () => {
  const text = [
    'hostname: sandbox-cs-1', 'version : 1.40.1.2/14012 10000 secure', 'spawngroup 1 source:  loaded: ok  map: de_mirage',
    'players : 2 humans, 1 bots (10 max) (not hibernating)',
    '  id    time ping loss      state   rate adr name',
    '  2   00:35   42    0     active 786432 192.0.2.1:27005 \'alice\'',
    '  3   00:10   30    0     active 786432 192.0.2.2:27005 \'friend\'',
    '65535 BOT    0    0     active      0 \'BOT\' \'Dave\'',
  ].join('\n');
  const s = parseStatus(text);
  assert.equal(s.humans, 2);
  assert.equal(s.bots, 1);
  assert.equal(s.maxPlayers, 10);
  assert.equal(s.map, 'de_mirage');
  assert.deepEqual(s.players.filter((x) => !x.bot).map((x) => x.name), ['alice', 'friend']);
  assert.equal(s.players.filter((x) => x.bot).length, 1);
});

test('parseStatus handles the real CS2 format (spawngroup line, hibernating 0/0 max)', () => {
  const text = ['Server:  Running [0.0.0.0:27015]', 'hostname: sandbox', 'version : 1.41.9.6/14196 8803 secure  public', 'loaded spawngroup(  1)  : SV:  [1: de_dust2 | main lump | mapload]',
    'players : 0 humans, 0 bots (0/0 max) (hibernating) (unreg)'].join('\n');
  const s = parseStatus(text);
  assert.equal(s.map, 'de_dust2'); assert.equal(s.humans, 0); assert.equal(s.maxPlayers, null);
  const w = parseStatus('loaded spawngroup(  1)  : SV:  [1: workshop/3070244462/aim_botz | main lump | mapload]\nplayers : 1 humans, 0 bots (10/10 max) (not hibernating)');
  assert.equal(w.map, 'workshop/3070244462/aim_botz'); assert.equal(w.maxPlayers, 10);
});
