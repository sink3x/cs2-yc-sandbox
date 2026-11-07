'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { playerCommand, checkOutput } = require('../lib/online');

test('online: команды строятся только из белого списка и числового id', () => {
  assert.equal(playerCommand('kick', 7), 'kickid 7');
  assert.equal(playerCommand('slay', '12'), 'css_slay #12');
  assert.equal(playerCommand('team', 3, { team: 'CT' }), 'css_team #3 ct');
  assert.equal(playerCommand('ban', 3, { minutes: 1440 }), 'css_ban #3 1440 panel');
  assert.equal(playerCommand('ban', 3, {}), 'css_ban #3 60 panel');
  for (const bad of ['-1', 'x', '1; quit', 99999, 1.5, '']) assert.throws(() => playerCommand('kick', bad), /bad player id/);
  assert.throws(() => playerCommand('team', 1, { team: 'ct; quit' }), /team/);
  assert.throws(() => playerCommand('ban', 1, { minutes: 5 }), /minutes/);
  assert.throws(() => playerCommand('quit', 1), /unknown player action/);
  assert.throws(() => playerCommand('constructor', 1), /unknown player action/);
});

test('online: «unknown command» превращается в ошибку', () => {
  assert.doesNotThrow(() => checkOutput('slay', ''));
  assert.throws(() => checkOutput('ban', 'Unknown command: css_ban'), /admin command not available/);
});
