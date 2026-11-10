'use strict';
// Подсказки к консольным командам: при наведении (мышь), фокусе (клавиатура) и долгом нажатии (телефон) показывают, что делает команда
// и за что отвечает каждый аргумент. Работает по всему интерфейсу: подходит любой элемент с data-cmd="команда", а также .chip, code, kbd,
// пункты автодополнения и т. п., если их текст — известная команда из COMMANDS или чат-команда из CHAT_HELP.

// Что значит каждый вид аргумента (ключ — запись из третьего поля COMMANDS).
const CMD_ARG_KINDS = {
  '<карта>': 'Имя карты, например de_dust2 (список — на странице «Карты и режимы»).',
  '<ID>': 'Числовой ID карты из Steam Workshop (он в адресе страницы карты).',
  '<сек>': 'Время в секундах.', '<мин>': 'Время в минутах.', '<минуты>': 'Срок в минутах (0 — навсегда).',
  '<имя>': 'Ник игрока (достаточно уникальной части).', '<имя|#userid>': 'Ник игрока или #userid: номер игрока из команды status.',
  '<id>': 'userid игрока: число из команд status или users.', '<текст>': 'Любой текст.', '<команда>': 'Консольная команда целиком, например mp_restartgame 1.',
  '<файл>': 'Имя cfg-файла из папки cfg сервера, например sandbox/overrides.cfg.', '<число>': 'Целое число.', '<сумма>': 'Количество внутриигровых долларов.',
  '<пароль>': 'Пароль входа на сервер; пустое значение снимает пароль.', '<имя> [значение]': 'Имя параметра (cvar) и, если нужно, его новое значение.',
  '0|1': '0 — выключить, 1 — включить.', '0|1|2': 'Режим: 0, 1 или 2 (значения — в описании команды).',
  'weapon_ak47': 'Внутреннее имя предмета: weapon_ak47, weapon_awp, item_kevlar и т. п.',
  '0..3': 'Число от 0 до 3 (0 обычно означает «выключено», остальные — режимы).',
  '0.1..10': 'Множитель скорости игры: 1 — обычная, 0.5 — вдвое медленнее, 2 — вдвое быстрее.',
  '[all|ct|t]': 'Кого убрать: all — всех ботов, ct — только за CT, t — только за T. Без аргумента — всех.',
  'CT|T|any': 'За какую сторону могут играть люди: CT, T или any — за любую.',
  'list|version': 'list — показать список плагинов Metamod, version — показать версию.',
  'list|reload <имя>|load|unload': 'list — показать плагины; reload, load и unload — перезагрузить, загрузить или выгрузить плагин (после слова укажите его имя).',
  '<минуты> <id>': 'Срок бана в минутах (0 — навсегда) и userid игрока из команды status.', '<имя> <минуты>': 'Ник игрока и срок бана в минутах (0 — навсегда).',
};
// Числа без пояснения в скобках — это значения по умолчанию в CS2: sv_gravity 800, sv_airaccelerate 12 и т. д.
const CMD_ARG_ENUM = 'Один из вариантов:';
const CMD_ARG_VALUE = 'Число или текст, как описано выше.';
const CMD_ARG_NUMBER = 'Число. Стандартное значение в CS2:';

// Разбор там, где общего пояснения мало: [запись, пояснение] вместо общего.
const CMD_ARG_NOTES = {
  sv_infinite_ammo: [['0|1|2', '0 — как обычно; 1 — бесконечный запас патронов (перезарядка нужна); 2 — бесконечная обойма (без перезарядки).']],
  mp_free_armor: [['0|1|2', '0 — без бесплатной брони; 1 — бесплатный жилет; 2 — жилет и шлем.']],
  bot_difficulty: [['0..3', '0 — лёгкие боты, 1 — обычные, 2 — сложные, 3 — эксперты.']],
  bot_quota_mode: [['normal|fill|match', 'normal — ровно столько ботов, сколько указано в bot_quota; fill — боты добивают слоты до числа bot_quota вместе с людьми; match — на каждого человека приходится bot_quota ботов.']],
  bot_quota: [['<число>', 'Сколько ботов держать на сервере (как их считать — задаёт bot_quota_mode).']],
};

// Чат-команды: что за аргумент после неё. Вводятся в чате игры, а не в консоли панели.
const CHAT_ARG_NOTES = {
  '!map': 'Название карты, например de_mirage.', '!kick': 'Ник игрока.', '!ban': 'Ник игрока и срок бана в минутах.', '!slay': 'Ник игрока.',
  '!rcon': 'Консольная команда сервера целиком.', '!cvar': 'Имя параметра (cvar) и его новое значение.',
  '.spawn': 'Номер точки возрождения (с единицы).', '.savenade': 'Любое слово — название, под которым сохранится бросок.', '.loadnade': 'Название ранее сохранённого броска.',
};

/** Найти запись в COMMANDS по точному тексту, иначе по первому слову. Возвращает {name, desc, hint, exact} или null. */
function cmdTipFind(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t || t.length > 120) return null;
  const hit = (name, exact) => { const c = COMMANDS.find((x) => x[0].toLowerCase() === name.toLowerCase()); return c ? { name: c[0], desc: c[1], hint: c[2] || '', exact } : null; };
  return hit(t, true) || hit(t.split(' ')[0], false);
}

/** Чат-команда («!kick имя», «.prac») → {name, desc, group} или null. */
function cmdTipFindChat(text) {
  const w = String(text || '').trim().split(/\s+/)[0];
  if (!/^[!.]\w+$/.test(w)) return null;
  for (const g of CHAT_HELP) for (const [c, d] of g.items) if (c.split(' ')[0] === w) return { name: c, word: w, desc: d, group: g.title };
  return null;
}

/** Пояснения к аргументам: [[запись, пояснение], …]. Пусто — у команды нет аргументов. */
function cmdTipArgs(name, hint) {
  if (!hint) return [];
  if (CMD_ARG_NOTES[name]) return CMD_ARG_NOTES[name];
  if (CMD_ARG_KINDS[hint]) return [[hint, CMD_ARG_KINDS[hint]]];
  const out = [];
  for (const tok of hint.split(/\s+(?![^\[]*\])/)) {
    if (CMD_ARG_KINDS[tok]) out.push([tok, CMD_ARG_KINDS[tok]]);
    else if (/^-?\d+(\.\d+)?$/.test(tok)) out.push([tok, `${CMD_ARG_NUMBER} ${tok}`]);
  }
  return out;
}

let cmdTipCatKey = null; let cmdTipCatMap = new Map();
/** cvar из каталога настроек панели (S.catalog загружается страницами) по имени. */
function cmdTipCvar(name) {
  const cat = typeof S !== 'undefined' && S.catalog && S.catalog.catalog;
  if (!cat) return null;
  if (cmdTipCatKey !== cat) { cmdTipCatKey = cat; cmdTipCatMap = new Map(); for (const g of cat) for (const it of g.items) cmdTipCatMap.set(it.name, it); }
  return cmdTipCatMap.get(name) || null;
}

/** Содержимое подсказки: {title, desc, args: [[запись, пояснение]], foot} или null, если команда неизвестна и описания нет. */
function cmdTipModel(text, fallbackDesc) {
  const chat = cmdTipFindChat(text);
  if (chat) {
    const rest = String(text).trim().split(/\s+/).slice(1);
    const hasArg = chat.name.includes(' ');
    const note = CHAT_ARG_NOTES[chat.word];
    return { title: rest.length ? String(text).trim() : chat.name, desc: chat.desc, args: hasArg && note ? [[chat.name.split(' ').slice(1).join(' '), note]] : [], foot: `${chat.group} · ${chat.word[0] === '!' ? 'чат игры: команда плагина' : 'чат игры: команда MatchZy'}` };
  }
  const c = cmdTipFind(text);
  if (!c) {
    const it = cmdTipCvar(String(text).trim().split(/\s+/)[0]);
    if (it) {
      const vals = it.type === 'bool' ? '0|1' : it.type.startsWith('enum:') ? it.type.slice(5) : '';
      return { title: vals ? `${it.name} ${vals}` : `${it.name} <значение>`, desc: it.hint, foot: 'Параметр сервера (cvar): значение сохраняется на странице «Настройки».',
        args: it.type === 'bool' ? [['0|1', CMD_ARG_KINDS['0|1']]] : vals ? [[vals, `${CMD_ARG_ENUM} ${vals.split('|').join(', ')}.`]] : [['<значение>', CMD_ARG_VALUE]] };
    }
    return fallbackDesc ? { title: String(text).trim(), desc: fallbackDesc, args: [], foot: '' } : null;
  }
  const typed = String(text).trim().replace(/\s+/g, ' ');
  return { title: c.exact ? `${c.name}${c.hint ? ` ${c.hint}` : ''}` : typed, desc: c.desc, args: cmdTipArgs(c.name, c.hint), foot: '' };
}

// ---------------------------------------------------------------- отрисовка
const CMD_TIP_SEL = '[data-cmd], .chip, code, kbd, .ac-i, .cmd-tip';
const cmdTipHolder = (el) => (el && el.closest ? el.closest(CMD_TIP_SEL) : null);
let cmdTipEl = null; let cmdTipTarget = null; let cmdTipTimer = 0; let cmdTipTouch = 0;

function cmdTipFor(el) {
  const holder = cmdTipHolder(el);
  if (!holder) return null;
  const v = holder.dataset && holder.dataset.cmd;
  const raw = v || (holder.classList.contains('ac-i') ? (holder.querySelector('.ac-v') || holder).textContent : holder.textContent);
  const m = cmdTipModel(raw, holder.dataset && holder.dataset.desc);
  return m ? { holder, model: m } : null;
}

/** Пояснение к аргументу; у «Число…: N» и «Один из вариантов: …» переводится только постоянная часть. */
function cmdTipArgText(d) { for (const k of [CMD_ARG_NUMBER, CMD_ARG_ENUM]) if (d.startsWith(`${k} `)) return `${tr(k)}${d.slice(k.length)}`; return tr(d); }

function cmdTipHide() {
  clearTimeout(cmdTipTimer);
  if (cmdTipEl) { cmdTipEl.remove(); cmdTipEl = null; }
  if (cmdTipTarget) { cmdTipTarget.removeAttribute('aria-describedby'); cmdTipTarget = null; }
}

function cmdTipShow(holder, model) {
  cmdTipHide();
  cmdTipTarget = holder;
  const el = h('div', { class: 'cmdtip', role: 'tooltip', id: 'cmdtip' },
    h('div', { class: 'cmdtip-h' }, model.title.split(' ').map((w) => tr(w)).join(' ')),
    h('div', { class: 'cmdtip-d' }, tr(model.desc)),
    model.args.length ? h('dl', { class: 'cmdtip-a' }, model.args.map(([k, d]) => [h('dt', {}, k.split(' ').map((w) => tr(w)).join(' ')), h('dd', {}, cmdTipArgText(d))])) : null,
    model.foot ? h('div', { class: 'cmdtip-f' }, model.foot.split(' · ').map(tr).join(' · ')) : null);
  document.body.append(el);
  cmdTipEl = el; holder.setAttribute('aria-describedby', 'cmdtip');
  const r = holder.getBoundingClientRect(); const w = el.offsetWidth; const hh = el.offsetHeight; const pad = 8;
  let top = r.bottom + 6; if (top + hh > innerHeight - pad && r.top - hh - 6 > pad) top = r.top - hh - 6;
  top = Math.max(pad, Math.min(top, innerHeight - hh - pad));
  const left = Math.max(pad, Math.min(r.left, innerWidth - w - pad));
  el.style.top = `${top}px`; el.style.left = `${left}px`;
}

function cmdTipSchedule(el, delay) {
  const f = cmdTipFor(el);
  if (!f) return;
  if (f.holder === cmdTipTarget) return;
  clearTimeout(cmdTipTimer);
  cmdTipTimer = setTimeout(() => { if (f.holder.isConnected) cmdTipShow(f.holder, f.model); }, delay);
}

document.addEventListener('mouseover', (e) => { if (e.target instanceof Element) cmdTipSchedule(e.target, 350); });
document.addEventListener('mouseout', (e) => { const from = e.target instanceof Element ? cmdTipHolder(e.target) : null; if (from && from !== (e.relatedTarget instanceof Element ? cmdTipHolder(e.relatedTarget) : null)) cmdTipHide(); });
document.addEventListener('focusin', (e) => { if (e.target instanceof Element) cmdTipSchedule(e.target, 0); });
document.addEventListener('focusout', cmdTipHide);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cmdTipHide(); }, true);
document.addEventListener('scroll', cmdTipHide, true);
document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') cmdTipHide(); });
// телефон: долгое нажатие показывает подсказку, обычное касание работает как раньше
document.addEventListener('touchstart', (e) => { clearTimeout(cmdTipTouch); const t = e.target instanceof Element ? e.target : null; const f = t && cmdTipFor(t); if (!f) { cmdTipHide(); return; } cmdTipTouch = setTimeout(() => cmdTipShow(f.holder, f.model), 450); }, { passive: true });
document.addEventListener('touchend', () => clearTimeout(cmdTipTouch), { passive: true });
document.addEventListener('touchmove', () => clearTimeout(cmdTipTouch), { passive: true });
/** Показать подсказку сразу (для выбора стрелками в автодополнении). */
function cmdTipNow(el) { const f = el && cmdTipFor(el); if (f) cmdTipShow(f.holder, f.model); else cmdTipHide(); }
