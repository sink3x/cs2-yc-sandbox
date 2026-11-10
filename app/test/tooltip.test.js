'use strict';
// Подсказки к командам: у каждой команды есть описание и пояснение каждого аргумента, и всё переведено.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '../admin/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

function load() {
  const ctx = vm.createContext({ document: { addEventListener() {}, documentElement: {} }, navigator: { languages: ['ru'] }, localStorage: { getItem() { return null; }, setItem() {} }, location: { reload() {} }, console });
  ctx.window = ctx;
  for (const f of ['i18n.js', 'i18n-extra.js', 'i18n-extra2.js', 'i18n-extra3.js', 'i18n-extra4.js', 'i18n-extra5.js', 'i18n-extra6.js', 'i18n-extra7.js', 'i18n-extra8.js', 'i18n-extra9.js']) vm.runInContext(read(f), ctx, { filename: f });
  vm.runInContext(`var S = {};\n${read('data.js')}\n${read('tooltip.js')}\nglobalThis.__t = { COMMANDS, CHAT_HELP, cmdTipModel, cmdTipFind, cmdTipArgs, CMD_ARG_NUMBER, CMD_ARG_ENUM, D, S };`, ctx, { filename: 'tooltip.js' });
  // h() нужен только для отрисовки, в модели его нет; S задаём здесь
  return ctx.__t;
}

test('every console command has a tooltip model: description, and every argument explained', () => {
  const t = load();
  for (const [name, desc, hint] of t.COMMANDS) {
    const m = t.cmdTipModel(name);
    assert.ok(m, name);
    assert.equal(m.desc, desc);
    if (hint) assert.ok(m.args.length > 0, `${name} ${hint}: аргументы без пояснения`);
    else assert.equal(m.args.length, 0, name);
  }
});

test('every string a tooltip can show is translated into en/de/fr', () => {
  const t = load();
  const strings = new Set();
  const add = (s) => { if (s) strings.add(s); };
  for (const [name] of t.COMMANDS) { const m = t.cmdTipModel(name); add(m.desc); for (const [, d] of m.args) add(d.startsWith(`${t.CMD_ARG_NUMBER} `) ? t.CMD_ARG_NUMBER : d); }
  for (const g of t.CHAT_HELP) for (const [c] of g.items) { const m = t.cmdTipModel(c); assert.ok(m, c); add(m.desc); for (const [, d] of m.args) add(d); for (const f of m.foot.split(' · ')) add(f); }
  add(t.CMD_ARG_ENUM);
  const missing = [...strings].filter((s) => !(t.D[s] && t.D[s].length >= 3 && t.D[s].every(Boolean)));
  assert.deepEqual(missing, []);
});

test('tooltip content: arguments, chat commands, unknown commands and cvars from the catalog', () => {
  const t = load();
  assert.match(t.cmdTipModel('sv_infinite_ammo').args[0][1], /бесконечный запас/);
  assert.equal(t.cmdTipModel('bot_kick').args[0][0], '[all|ct|t]');
  assert.equal(t.cmdTipModel('sv_gravity').args[0][1], `${t.CMD_ARG_NUMBER} 800`);
  const typed = t.cmdTipModel('sv_cheats 1'); assert.equal(typed.title, 'sv_cheats 1'); assert.equal(typed.args[0][0], '0|1');
  const chat = t.cmdTipModel('!ban имя 60'); assert.equal(chat.desc, 'Бан на 60 минут'); assert.equal(chat.args.length, 1);
  assert.equal(t.cmdTipModel('.prac').args.length, 0);
  assert.equal(t.cmdTipModel('definitely_not_a_command'), null);
  assert.equal(t.cmdTipModel('x'.repeat(200)), null);
  assert.equal(t.cmdTipModel('totally_unknown', 'описание от вызывающего').desc, 'описание от вызывающего');
  t.S.catalog = { catalog: [{ items: [{ name: 'mp_test_flag', type: 'bool', hint: 'Проверка флага' }, { name: 'mp_test_mode', type: 'enum:a|b', hint: 'Режим' }, { name: 'mp_test_num', type: 'int', hint: 'Число' }] }] };
  const flag = t.cmdTipModel('mp_test_flag'); assert.equal(flag.desc, 'Проверка флага'); assert.equal(flag.args[0][0], '0|1');
  const mode = t.cmdTipModel('mp_test_mode'); assert.equal(mode.args[0][1], `${t.CMD_ARG_ENUM} a, b.`);
  assert.equal(t.cmdTipModel('mp_test_num').title, 'mp_test_num <значение>');
});
