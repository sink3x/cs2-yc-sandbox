'use strict';
// Статистика сервера: лидеры, карты, карточка игрока (из лога CS2). Игрок видит только свою.

const fmtDur = (sec) => { const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };
const GRENADE_NAMES = { he: 'HE', flash: 'Flash', smoke: 'Smoke', molotov: 'Molotov', decoy: 'Decoy' };

// ---------------------------------------------------------------- места на карте (из позиций убийств и смертей в логе)
const COMPASS = [['юго-запад', 'юг', 'юго-восток'], ['запад', 'центр карты', 'восток'], ['северо-запад', 'север', 'северо-восток']];
/** Зоны карты 2×2 клетки: [{ gx, gy, k, d }] из heat[map] = { 'gx,gy': [убийства, смерти] }. */
function heatZones(cells) {
  const z = new Map();
  for (const [key, [k, d]] of Object.entries(cells || {})) {
    const [gx, gy] = key.split(',').map(Number); const bx = Math.floor(gx / 2); const by = Math.floor(gy / 2); const id = `${bx},${by}`;
    const e = z.get(id) || { gx: bx, gy: by, k: 0, d: 0 }; e.k += k; e.d += d; z.set(id, e);
  }
  return [...z.values()];
}
/** Лучшие / основные / слабые места игрока: { best, main, weak, bbox }. */
function analyzeZones(zones) {
  const xs = zones.map((z) => z.gx); const ys = zones.map((z) => z.gy);
  const bbox = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const tot = (z) => z.k + z.d;
  const main = zones.filter((z) => tot(z) >= 3).sort((a, b) => tot(b) - tot(a)).slice(0, 3);
  const best = zones.filter((z) => z.k >= 3 && (z.k + 1) / (z.d + 1) >= 2).sort((a, b) => (b.k - b.d) - (a.k - a.d)).slice(0, 3);
  const weak = zones.filter((z) => z.d >= 3 && (z.d + 1) / (z.k + 1) >= 1.8).sort((a, b) => (b.d - b.k) - (a.d - a.k)).slice(0, 3);
  return { best, main, weak, bbox };
}
function zoneName(z, bbox) {
  const fx = bbox.x1 === bbox.x0 ? 0.5 : (z.gx - bbox.x0) / (bbox.x1 - bbox.x0); const fy = bbox.y1 === bbox.y0 ? 0.5 : (z.gy - bbox.y0) / (bbox.y1 - bbox.y0);
  return COMPASS[fy < 0.34 ? 0 : fy > 0.66 ? 2 : 1][fx < 0.34 ? 0 : fx > 0.66 ? 2 : 1];
}
function heatSvg(zones, an) {
  const NS = 'http://www.w3.org/2000/svg'; const { bbox } = an; const S0 = 22;
  const w = bbox.x1 - bbox.x0 + 1; const hh = bbox.y1 - bbox.y0 + 1; const maxT = Math.max(1, ...zones.map((z) => z.k + z.d));
  const el = (tag, a = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const svg = el('svg', { viewBox: `-4 -4 ${w * S0 + 8} ${hh * S0 + 8}`, class: 'heatmap', role: 'img', 'aria-label': tr('Тепловая карта убийств и смертей') });
  const px = (z) => [(z.gx - bbox.x0) * S0, (bbox.y1 - z.gy) * S0]; // север сверху
  for (const z of zones) {
    const [x, y] = px(z); const t = z.k + z.d; const kill = z.k >= z.d;
    const r = el('rect', { x, y, width: S0 - 1, height: S0 - 1, rx: 3, class: kill ? 'hz-good' : 'hz-bad', opacity: (0.25 + 0.75 * t / maxT).toFixed(2) }, svg);
    el('title', {}, r).textContent = `${tr('Убийств')}: ${z.k}, ${tr('Смертей')}: ${z.d}`;
  }
  const mark = (list, sym) => list.forEach((z, i) => { const [x, y] = px(z); const t = el('text', { x: x + S0 / 2, y: y + S0 / 2 + 3, class: 'hz-mark', 'text-anchor': 'middle' }, svg); t.textContent = `${sym}${i + 1}`; });
  mark(an.main, '●'); mark(an.best, '▲'); mark(an.weak, '▼');
  return svg;
}
function heatSection(p) {
  const maps = Object.entries(p.heat || {}).map(([m, cells]) => [m, heatZones(cells)]).filter(([, z]) => z.reduce((a, c) => a + c.k + c.d, 0) >= 8).sort((a, b) => b[1].length - a[1].length);
  if (!maps.length) return h('div', { class: 'muted small' }, 'Места на карте: пока мало данных — нужны хотя бы 8 убийств и смертей на одной карте (позиции пишутся с момента этого обновления).');
  const box = h('div'); const sel = h('select', {}, maps.map(([m]) => h('option', { value: m }, m)));
  const draw = () => {
    const [, zones] = maps.find(([m]) => m === sel.value); const an = analyzeZones(zones); const nm = (z) => zoneName(z, an.bbox);
    const line = (sym, z, i, text) => h('li', {}, h('b', {}, `${sym}${i + 1} · ${nm(z)}`), ` — ${text}`);
    const lists = h('div', { class: 'zone-lists' },
      h('div', {}, h('h5', {}, '▲ Лучшие места'), h('ul', {}, an.best.length ? an.best.map((z, i) => line('▲', z, i, `${z.k} убийств при ${z.d} смертях`)) : [h('li', { class: 'muted' }, 'Пока нет явных сильных мест.')]), an.best.length ? h('div', { class: 'muted small' }, 'Здесь вы сильны: используйте как опорные позиции и возвращайтесь на них.') : null),
      h('div', {}, h('h5', {}, '● Основные места'), h('ul', {}, an.main.length ? an.main.map((z, i) => line('●', z, i, `${z.k + z.d} столкновений (${z.k} убийств / ${z.d} смертей)`)) : [h('li', { class: 'muted' }, 'Пока мало данных.')]), an.main.length ? h('div', { class: 'muted small' }, 'Здесь проходит большая часть ваших боёв: отработайте тут тайминги и утилиты.') : null),
      h('div', {}, h('h5', {}, '▼ Слабые места'), h('ul', {}, an.weak.length ? an.weak.map((z, i) => line('▼', z, i, `${z.d} смертей при ${z.k} убийствах`)) : [h('li', { class: 'muted' }, 'Явных слабых мест нет.')]), an.weak.length ? h('div', { class: 'muted small' }, 'Здесь вы чаще проигрываете дуэли: не пикайте в одиночку, сначала флэш или дым, либо смените позицию.') : null));
    box.replaceChildren(h('div', { class: 'heat-wrap' }, heatSvg(zones, an), lists),
      h('div', { class: 'muted small' }, 'Зелёные клетки — больше убийств, красные — больше смертей; насыщенность — число боёв. Север вверху по осям карты, названия позиций (A-плент, мид) не определяются: зоны задаются по сетке ~512 юнитов.'));
  };
  sel.addEventListener('change', draw); draw();
  return h('div', {}, h('div', { class: 'row' }, h('h4', {}, 'Места на карте'), sel), box);
}

function serverRadar(p) {
  if (!p.kills && !p.deaths) return null;
  const hrs = Math.max(p.seconds / 3600, 0.25); const gr = Object.values(p.grenades || {}).reduce((a, n) => a + n, 0);
  const axes = [
    { label: 'K/D', value: norm(p.kd, 0.5, 2), text: String(p.kd) },
    { label: 'Хедшоты', value: norm(p.hsPct, 10, 60), text: `${p.hsPct}%` },
    { label: 'Урон за попадание', value: norm(p.hits ? p.damage / p.hits : 0, 15, 45), text: p.hits ? String(Math.round(p.damage / p.hits)) : '—' },
    { label: 'Убийств в час', value: norm(p.kills / hrs, 5, 60), text: String(Math.round(p.kills / hrs)) },
    { label: 'Гранаты в час', value: norm(gr / hrs, 0, 30), text: String(Math.round(gr / hrs)) },
  ];
  return h('div', {}, h('h4', {}, 'Профиль игрока'), radar({ axes, ref: [norm(1, 0.5, 2), norm(40, 10, 60), norm(27, 15, 45), norm(25, 5, 60), norm(10, 0, 30)], title: 'Профиль игрока' }));
}

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
    serverRadar(p),
    p.heat !== undefined ? heatSection(p) : null,
    Object.keys(p.maps || {}).length ? h('div', {}, h('h4', {}, 'По картам'), h('table', {}, h('thead', {}, h('tr', {}, ['Карта', 'Время', 'Убийств', 'Смертей', 'Урон'].map((x) => h('th', {}, x)))),
      h('tbody', {}, Object.entries(p.maps).sort((a, b) => b[1].seconds - a[1].seconds).map(([m, x]) => h('tr', {}, h('td', {}, m), h('td', {}, fmtDur(x.seconds)), h('td', {}, String(x.kills)), h('td', {}, String(x.deaths)), h('td', {}, String(x.damage))))))) : null);
}

function pageStats() {
  const root = h('div', {}, h('h2', {}, 'Статистика'), h('div', { class: 'muted' }, 'Загрузка…'));
  (async () => {
    let r; try { r = await api('GET', S.role === 'player' ? `/stats/${S.steamid}` : '/stats'); } catch (e) { root.replaceChildren(h('h2', {}, 'Статистика'), h('div', { class: 'banner' }, e.message)); return; }
    const detail = h('div', { class: 'card', hidden: S.role !== 'player' });
    const show = (p) => {
      detail.hidden = false; detail.replaceChildren(h('h3', {}, p.name || p.steamid), statCard(p));
      if (p.heat === undefined && S.role !== 'player') api('GET', `/stats/${p.steamid}`).then((d) => { const full = d.players && d.players[0]; if (full && !detail.hidden) { p.heat = full.heat || {}; detail.replaceChildren(h('h3', {}, p.name || p.steamid), statCard(p)); } }).catch(() => {});
    };
    const note = h('div', { class: 'muted small' }, `Считается с ${r.since ? new Date(r.since).toLocaleDateString(LOCALE) : '—'} по логу сервера: убийства, смерти, хедшоты, урон, гранаты, время. Выстрелы/пули лог не пишет.`);
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
