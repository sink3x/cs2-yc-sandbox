'use strict';
// Practice / bots / fun helpers: validated RCON command builders and the data behind the "Practice" page.
// Everything the panel sends to the game console from the practice UI goes through buildCommands().

const err = (m) => Object.assign(new Error(m), { status: 400 });
const CVAR_NAME = /^[a-z_][a-z0-9_]{1,63}$/;
const CVAR_VALUE = /^[A-Za-z0-9_.,:+\-/ ]{0,64}$/;

function int(v, min, max, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw err(`${name}: целое число ${min}–${max}`);
  return n;
}
function pick(v, list, name) {
  if (!list.includes(v)) throw err(`${name}: одно из ${list.join(', ')}`);
  return v;
}
const flag = (v) => (v === true || v === 1 || v === '1' ? '1' : '0');

/** Live toggles on the Practice page. type: bool | enum | range. */
const TOGGLES = [
  { group: 'Патроны и урон', cvar: 'sv_cheats', title: 'Читы (noclip, god, give)', type: 'bool', hint: 'Нужны для noclip, host_timescale и части весёлых режимов.' },
  { group: 'Патроны и урон', cvar: 'sv_infinite_ammo', title: 'Бесконечные патроны', type: 'enum', options: ['0', '1', '2'], hint: '1 — без перезарядки, 2 — вообще бесконечный магазин.' },
  { group: 'Патроны и урон', cvar: 'weapon_recoil_scale', title: 'Сила отдачи', type: 'range', min: 0, max: 4, step: 0.1, hint: '2 — стандарт, 0 — лазер.' },
  { group: 'Патроны и урон', cvar: 'mp_friendlyfire', title: 'Огонь по своим', type: 'bool', hint: '' },
  { group: 'Гранаты и прицеливание', cvar: 'sv_grenade_trajectory_prac_pipreview', title: 'Траектория гранаты (предпросмотр)', type: 'bool', hint: 'Показывает линию полёта, пока граната в руке.' },
  { group: 'Гранаты и прицеливание', cvar: 'sv_grenade_trajectory_prac_trailtime', title: 'Время следа гранаты, с', type: 'range', min: 0, max: 30, step: 1, hint: 'Сколько секунд держится след после броска.' },
  { group: 'Гранаты и прицеливание', cvar: 'sv_showimpacts', title: 'Показывать попадания', type: 'enum', options: ['0', '1', '2', '3'], hint: '1 — следы пуль, 2 — только сервер, 3 — оба.' },
  { group: 'Экономика', cvar: 'mp_buy_anywhere', title: 'Покупка где угодно', type: 'enum', options: ['0', '1', '2', '3'], hint: '1 — везде для обеих команд, 2 — T, 3 — CT.' },
  { group: 'Экономика', cvar: 'mp_free_armor', title: 'Бесплатная броня', type: 'enum', options: ['0', '1', '2'], hint: '1 — бронежилет, 2 — с шлемом.' },
  { group: 'Экономика', cvar: 'mp_startmoney', title: 'Стартовые деньги', type: 'range', min: 800, max: 60000, step: 800, hint: 'Применяется со следующего раунда или после рестарта.' },
  { group: 'Раунд', cvar: 'mp_roundtime', title: 'Длина раунда, мин', type: 'range', min: 1, max: 60, step: 1, hint: '' },
  { group: 'Раунд', cvar: 'mp_freezetime', title: 'Заморозка в начале, с', type: 'range', min: 0, max: 30, step: 1, hint: '' },
  { group: 'Раунд', cvar: 'mp_ignore_round_win_conditions', title: 'Раунд не заканчивается сам', type: 'bool', hint: 'Удобно для тренировки: убийства не завершают раунд.' },
  { group: 'Раунд', cvar: 'mp_respawn_on_death_ct', title: 'Респавн CT', type: 'bool', hint: '' },
  { group: 'Раунд', cvar: 'mp_respawn_on_death_t', title: 'Респавн T', type: 'bool', hint: '' },
  { group: 'Раунд', cvar: 'sv_gravity', title: 'Гравитация', type: 'range', min: 100, max: 1600, step: 50, hint: '800 — стандарт.' },
  { group: 'Боты', cvar: 'bot_difficulty', title: 'Сложность ботов', type: 'enum', options: ['0', '1', '2', '3'], hint: '0 — лёгкие … 3 — эксперты.' },
  { group: 'Боты', cvar: 'bot_stop', title: 'Боты замерли', type: 'bool', hint: 'Мишени: боты стоят на месте.' },
  { group: 'Боты', cvar: 'bot_knives_only', title: 'Боты только с ножами', type: 'bool', hint: '' },
  { group: 'Боты', cvar: 'bot_pistols_only', title: 'Боты только с пистолетами', type: 'bool', hint: '' },
];

/** Fun presets: applied live, never saved to the permanent config. `reset` returns the touched cvars to defaults. */
const FUN_PRESETS = [
  { id: 'moon', icon: '🌙', title: 'Луна', note: 'Гравитация 200 — прыгаешь как космонавт.', cvars: { sv_gravity: '200' } },
  { id: 'bhop', icon: '🐇', title: 'Банихоп', note: 'Автопрыжки и сильный аэроконтроль.', cvars: { sv_enablebunnyhopping: '1', sv_autobunnyhopping: '1', sv_airaccelerate: '100' } },
  { id: 'ice', icon: '🧊', title: 'Лёд', note: 'Скользишь как по катку.', cvars: { sv_friction: '0.5', sv_accelerate: '3' } },
  { id: 'laser', icon: '🔦', title: 'Лазер', note: 'Нет отдачи и разброса.', cvars: { weapon_recoil_scale: '0', weapon_accuracy_nospread: '1' }, cheats: true },
  { id: 'headshots', icon: '🎯', title: 'Только в голову', note: 'Урон по телу обнулён — считаются одни хедшоты.', cvars: { mp_damage_scale_ct_body: '0', mp_damage_scale_t_body: '0' } },
  { id: 'onetap', icon: '☝️', title: 'Ван-тап', note: 'Любой хедшот убивает с одного попадания.', cvars: { mp_damage_scale_ct_head: '100', mp_damage_scale_t_head: '100' } },
  { id: 'slowmo', icon: '🐌', title: 'Замедленное время', note: 'host_timescale 0.5 — разбор спрея в замедлении.', cvars: { host_timescale: '0.5' }, cheats: true },
  { id: 'nostamina', icon: '🦘', title: 'Без усталости', note: 'Прыжки не снижают скорость.', cvars: { sv_staminamax: '0', sv_staminajumpcost: '0', sv_staminalandcost: '0' } },
  { id: 'neo', icon: '🕶️', title: 'Нео', note: 'Секретный режим: низкая гравитация, bhop, замедление.', secret: true, cvars: { sv_gravity: '120', sv_enablebunnyhopping: '1', sv_autobunnyhopping: '1', sv_airaccelerate: '1000', host_timescale: '0.7' }, cheats: true },
  { id: 'jelly', icon: '🍮', title: 'Желе', note: 'Секретный режим: скользко и прыгуче.', secret: true, cvars: { sv_gravity: '300', sv_friction: '0.8', sv_accelerate: '2.5' } },
];

const FUN_DEFAULTS = {
  sv_gravity: '800', sv_airaccelerate: '12', sv_enablebunnyhopping: '0', sv_autobunnyhopping: '0', sv_friction: '5.2', sv_accelerate: '5.5',
  weapon_recoil_scale: '2', weapon_accuracy_nospread: '0', host_timescale: '1',
  mp_damage_scale_ct_body: '1', mp_damage_scale_t_body: '1', mp_damage_scale_ct_head: '1', mp_damage_scale_t_head: '1',
  sv_staminamax: '80', sv_staminajumpcost: '0.08', sv_staminalandcost: '0.05',
};

const READABLE = new Set([...TOGGLES.map((t) => t.cvar), ...Object.keys(FUN_DEFAULTS)]);

const q = (k, v) => `${k} "${v}"`;

// Животные. В CS2 штатно есть только курица (ent_create chicken). «Свинья» и «корова» — та же курица, перекрашенная и увеличенная:
// настоящих моделей свиней/коров в игре нет (нужен плагин + Workshop-модель).
const ANIMALS = {
  chicken: { title: 'Курица', color: null, scale: null },
  pig: { title: 'Свинья (косплей курицы)', color: '255 150 175', scale: 2.2 },
  cow: { title: 'Корова (косплей курицы)', color: '245 245 245', scale: 3.2 },
};
const ACTIONS = {
  animal: (a) => {
    const kind = pick(a.kind ?? 'chicken', Object.keys(ANIMALS), 'kind'); const n = int(a.count ?? 1, 1, 30, 'count'); const an = ANIMALS[kind];
    const out = ['sv_cheats "1"', ...Array(n).fill('ent_create chicken')];
    if (an.color) out.push(`ent_fire chicken color "${an.color}"`);
    if (an.scale) out.push(`ent_fire chicken addoutput "modelscale ${an.scale}"`);
    return out;
  },
  'animal-clear': () => ['ent_fire chicken kill'],
  'bot-add': (a) => {
    const team = pick(a.team ?? 'any', ['ct', 't', 'any'], 'team');
    const n = int(a.count ?? 1, 1, 10, 'count');
    return Array(n).fill(team === 'any' ? 'bot_add' : `bot_add_${team}`);
  },
  'bot-kick': (a) => {
    const team = pick(a.team ?? 'all', ['all', 'ct', 't'], 'team');
    return [team === 'all' ? 'bot_kick' : `bot_kick ${team}`];
  },
  'bot-kill': () => ['bot_kill'],
  'bot-difficulty': (a) => [q('bot_difficulty', int(a.level, 0, 3, 'level'))],
  'bot-flags': (a) => {
    const out = [];
    for (const k of ['bot_stop', 'bot_knives_only', 'bot_pistols_only', 'bot_zombie']) if (a[k] !== undefined) out.push(q(k, flag(a[k])));
    if (!out.length) throw err('нет флагов ботов');
    return out;
  },
  restart: (a) => [`mp_restartgame ${int(a.delay ?? 1, 1, 10, 'delay')}`],
  'warmup-end': () => ['mp_warmup_end'],
  say: (a) => {
    const t = String(a.text || '').trim();
    if (!t || t.length > 120 || /[;"\\\r\n\0]/.test(t)) throw err('say: до 120 символов, без кавычек и «;»');
    return [`say ${t}`];
  },
  cvars: (a) => {
    const pairs = Object.entries(a.pairs || {});
    if (!pairs.length || pairs.length > 20) throw err('cvars: от 1 до 20 пар');
    return pairs.map(([k, v]) => {
      if (!CVAR_NAME.test(k)) throw err(`bad cvar name: ${k}`);
      if (!CVAR_VALUE.test(String(v))) throw err(`bad value for ${k}`);
      return q(k, v);
    });
  },
  fun: (a) => {
    if (a.id === 'reset') return Object.entries(FUN_DEFAULTS).map(([k, v]) => q(k, v));
    const p = FUN_PRESETS.find((x) => x.id === a.id);
    if (!p) throw err('unknown fun preset');
    return [...(p.cheats ? [q('sv_cheats', 1)] : []), ...Object.entries(p.cvars).map(([k, v]) => q(k, v))];
  },
};

function buildCommands(action, args = {}) {
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!fn) throw err(`unknown practice action: ${action}`);
  return fn(args || {});
}

/** `"sv_cheats" = "1" ( def. "0" ) ...` -> { sv_cheats: '1' } */
function parseCvarOutput(name, text) {
  const m = new RegExp(`"${name}"\\s*=\\s*"([^"]*)"`, 'i').exec(String(text || ''));
  return m ? m[1] : null;
}

module.exports = { ANIMALS, TOGGLES, FUN_PRESETS, FUN_DEFAULTS, READABLE, ACTIONS, buildCommands, parseCvarOutput, CVAR_NAME };
