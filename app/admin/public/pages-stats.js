'use strict';
// Статистика сервера: лидеры, карты, карточка игрока (из лога CS2). Игрок видит только свою.

const fmtDur = (sec) => { const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };
const GRENADE_NAMES = { he: 'HE', flash: 'Flash', smoke: 'Smoke', molotov: 'Molotov', decoy: 'Decoy' };

function statCard(p) {
  const top = (o, n = 5) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
  const grenades = Object.entries(p.grenades || {});
  return h('div', {},
    h('div', { class: 'statgrid' }, [['Убийств', p.kills], ['Смертей', p.deaths], ['K/D', p.kd], ['HS, %', p.hsPct], ['Урон', p.damage], ['Попаданий', p.hits], ['Время на сервере', fmtDur(p.seconds)], ['Гранат', grenades.reduce((a, [, n]) => a + n, 0)]]
      .map(([k, v]) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('small', {}, k)))),
    h('div', { class: 'cols' },
      h('div', {}, h('h4', {}, 'Оружие (убийства)'), top(p.weapons).length ? h('table', {}, h('tbody', {}, top(p.weapons).map(([w, n]) => h('tr', {}, h('td', {}, w), h('td', {}, String(n)))))) : h('div', { class: 'muted small' }, 'Пока нет данных')),
      h('div', {}, h('h4', {}, 'Попадания по частям тела'), top(p.hitgroups, 8).length ? h('table', {}, h('tbody', {}, top(p.hitgroups, 8).map(([w, n]) => h('tr', {}, h('td', {}, w), h('td', {}, String(n)))))) : h('div', { class: 'muted small' }, 'Пока нет данных')),
      h('div', {}, h('h4', {}, 'Гранаты'), grenades.length ? h('table', {}, h('tbody', {}, grenades.map(([k, n]) => h('tr', {}, h('td', {}, GRENADE_NAMES[k] || k), h('td', {}, String(n)))))) : h('div', { class: 'muted small' }, 'Пока нет данных'))),
    Object.keys(p.maps || {}).length ? h('div', {}, h('h4', {}, 'По картам'), h('table', {}, h('thead', {}, h('tr', {}, ['Карта', 'Время', 'Убийств', 'Смертей', 'Урон'].map((x) => h('th', {}, x)))),
      h('tbody', {}, Object.entries(p.maps).sort((a, b) => b[1].seconds - a[1].seconds).map(([m, x]) => h('tr', {}, h('td', {}, m), h('td', {}, fmtDur(x.seconds)), h('td', {}, String(x.kills)), h('td', {}, String(x.deaths)), h('td', {}, String(x.damage))))))) : null);
}

function pageStats() {
  const root = h('div', {}, h('h2', {}, 'Статистика'), h('div', { class: 'muted' }, 'Загрузка…'));
  (async () => {
    let r; try { r = await api('GET', S.role === 'player' ? `/stats/${S.steamid}` : '/stats'); } catch (e) { root.replaceChildren(h('h2', {}, 'Статистика'), h('div', { class: 'banner' }, e.message)); return; }
    const detail = h('div', { class: 'card', hidden: S.role !== 'player' });
    const show = (p) => { detail.hidden = false; detail.replaceChildren(h('h3', {}, p.name || p.steamid), statCard(p)); };
    const note = h('div', { class: 'muted small' }, `Считается с ${r.since ? new Date(r.since).toLocaleDateString() : '—'} по логу сервера: убийства, смерти, хедшоты, урон, гранаты, время. Выстрелы/пули лог не пишет.`);
    const offline = r.offline ? h('div', { class: 'banner' }, 'Сервер выключен — показаны последние сохранённые данные.') : null;
    if (S.role === 'player') {
      const me = r.players[0];
      put(root, h('h2', {}, 'Статистика'), offline, me ? (show(me), detail) : h('div', { class: 'card muted' }, 'Для вас пока нет данных — сыграйте на сервере.'), note); detail.hidden = !me; return;
    }
    const maxK = Math.max(1, ...r.players.map((p) => p.kills));
    put(root, h('h2', {}, 'Статистика'), offline,
      h('div', { class: 'card' }, h('h3', {}, 'Игроки'), r.players.length ? h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Игрок', 'Убийств', 'Смертей', 'K/D', 'HS, %', 'Урон', 'Время'].map((x) => h('th', {}, x)))),
        h('tbody', {}, r.players.map((p, i) => h('tr', { class: 'clickable', onclick: () => { show(p); detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }, h('td', {}, String(i + 1)), h('td', {}, p.name || p.steamid, p.online ? h('span', { class: 'pill ok', style: 'margin-left:8px' }, h('i'), 'в игре') : null),
          h('td', {}, h('span', { class: 'bar-inline', style: `--w:${Math.round(100 * p.kills / maxK)}%` }, String(p.kills))), h('td', {}, String(p.deaths)), h('td', {}, String(p.kd)), h('td', {}, String(p.hsPct)), h('td', {}, String(p.damage)), h('td', {}, fmtDur(p.seconds)))))) : h('div', { class: 'muted' }, 'Пока нет данных — статистика копится, пока игроки на сервере.'),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn danger', onclick: act(async () => { if (!confirm('Сбросить всю статистику сервера?')) return; await api('POST', '/stats/reset', {}); go('stats'); }) }, 'Сбросить статистику'))),
      detail,
      h('div', { class: 'card' }, h('h3', {}, 'Карты'), r.maps.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Карта', 'Время', 'Раундов', 'Убийств', 'Запусков'].map((x) => h('th', {}, x)))),
        h('tbody', {}, r.maps.map((m) => h('tr', {}, h('td', {}, m.map), h('td', {}, fmtDur(m.seconds)), h('td', {}, String(m.rounds)), h('td', {}, String(m.kills)), h('td', {}, String(m.sessions)))))) : h('div', { class: 'muted' }, 'Пока нет данных')),
      note);
  })();
  return root;
}
