'use strict';
// Действия над игроками, которые сейчас на сервере (страница «Игроки онлайн»). Всё, что панель шлёт в консоль, строится здесь:
// id — число из колонки id команды `status` (userid), действие — из белого списка, остальное отбрасывается.
const err = (m) => Object.assign(new Error(m), { status: 400 });

const TEAMS = { ct: 'ct', t: 't', spec: 'spec' };
const BAN_MINUTES = [0, 60, 1440, 10080]; // 0 = навсегда
const REASON = 'panel';

/** → строка консольной команды для игрока с userid `id`. */
function playerCommand(action, id, arg = {}) {
  if (!/^\d{1,4}$/.test(String(id == null ? '' : id))) throw err('bad player id'); // пусто/мусор не превращаем в 0
  const n = Number(id);
  if (n > 4095) throw err('bad player id');
  switch (action) {
    case 'kick': return `kickid ${n}`;
    case 'slay': return `css_slay #${n}`;
    case 'team': {
      const t = TEAMS[String(arg.team || '').toLowerCase()];
      if (!t) throw err('team: ct | t | spec');
      return `css_team #${n} ${t}`;
    }
    case 'ban': {
      const m = arg.minutes === undefined ? 60 : Number(arg.minutes);
      if (!BAN_MINUTES.includes(m)) throw err(`ban: minutes must be one of ${BAN_MINUTES.join(', ')}`);
      return `css_ban #${n} ${m} ${REASON}`;
    }
    default: throw err(`unknown player action: ${action}`);
  }
}

/** Команда не найдена (нет плагина админ-команд) → понятная ошибка вместо «успеха». */
function checkOutput(action, text) {
  if (/unknown command|не известн/i.test(String(text || ''))) {
    throw Object.assign(new Error(action === 'kick' ? 'kick failed' : 'admin command not available: enable the CounterStrikeSharp admin plugin'), { status: 502 });
  }
}

module.exports = { playerCommand, checkOutput, BAN_MINUTES, TEAMS };
