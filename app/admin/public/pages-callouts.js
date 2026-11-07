'use strict';
// Callouts: схемы соревновательных карт и названия мест на ru/en/de/fr. Данные: GET /api/callouts, картинки: /callouts/<карта>.webp.
// Схема — собственная отрисовка проходимой геометрии (не радар Valve); названия мест — официальные, из навигации карты.

const CO = { data: null, sel: null, q: '', side: '', lvl: '', all: false };
const CO_NS = 'http://www.w3.org/2000/svg';
const CO_SIDE = { t: 'Сторона T', m: 'Центр карты', ct: 'Сторона CT' };
const CO_NEAR = { a: 'Рядом с точкой A', b: 'Рядом с точкой B', m: 'Между точками A и B' };
const CO_LVL = ['Низкая', 'Средняя', 'Высокая']; // высота над основанием карты (вычислена по координатам, не официальный «этаж»)
const CO_CONF = {
  mid: 'Положение мест на этой карте определено с небольшой погрешностью.',
  low: 'Карта сильно переработана в CS2: положение мест здесь примерное, ориентируйтесь на названия.',
};

/** Название места на языке интерфейса (для en — официальное). Это уже готовый текст: в tr() его не отправляем. */
const coName = (data, en) => { const n = data.names[en]; return LANG === 'en' || !n ? en : (n[LANG] || en); };
const coText = (s) => document.createTextNode(s);
const coPlace = (r) => ({ en: r[0], x: r[1], y: r[2], side: r[3], near: r[4], lvl: r[5] });

function coSvg(tag, attrs = {}, parent) {
  const e = document.createElementNS(CO_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function pageCallouts() {
  const root = h('div', {}, h('h2', {}, 'Callouts'), h('div', { class: 'muted' }, 'Загрузка…'));
  api('GET', '/callouts').then((d) => { CO.data = d; coRender(root); })
    .catch((e) => put(root, h('h2', {}, 'Callouts'), h('div', { class: 'banner' }, e.message)));
  return root;
}

function coRender(root) {
  const d = CO.data; const ids = Object.keys(d.maps); // порядок — как в данных (самые популярные первыми)
  const id = ids.includes(S.route.slug) ? S.route.slug : ids[0];
  const map = d.maps[id]; const places = map.places.map(coPlace);
  if (!places.some((p) => p.en === CO.sel)) CO.sel = null;
  const byEn = new Map(places.map((p) => [p.en, p]));
  const sorted = [...places].sort((a, b) => coName(d, a.en).localeCompare(coName(d, b.en), LANG));

  // ---- схема с метками
  // схема обрезана квадратом вокруг геометрии карты (map.box = [x, y, сторона] в единицах 0..1000); метки и подписи сохраняют экранный размер
  const [bx, by, bs] = map.box || [0, 0, 1000]; const k = bs / 1000;
  const svg = coSvg('svg', { viewBox: `${bx} ${by} ${bs} ${bs}`, class: 'co-svg', role: 'group', 'aria-label': tr('Места на карте'), style: `--k:${k.toFixed(3)}` });
  coSvg('image', { href: `/callouts/${id}.webp`, x: 0, y: 0, width: 1000, height: 1000, preserveAspectRatio: 'none' }, svg).appendChild(document.createElementNS(CO_NS, 'title')).textContent = map.name;
  const pts = new Map();
  for (const p of places) {
    const site = p.en === 'A Site' || p.en === 'B Site';
    const g = coSvg('g', { class: `co-pt s-${p.side}${site ? ' site' : ''}`, tabindex: '0', role: 'button', 'aria-label': coName(d, p.en), transform: `translate(${p.x} ${p.y})` }, svg);
    coSvg('circle', { r: (site ? 11 : 7) * k }, g);
    const t = coSvg('text', { x: 12 * k, y: 5 * k }, g); t.textContent = coName(d, p.en);
    g.addEventListener('click', () => pick(p.en));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p.en); } });
    pts.set(p.en, g);
  }
  const mapBox = h('div', { class: 'co-map' }, svg);

  // ---- список и поиск
  const search = h('input', { type: 'text', placeholder: 'Поиск места…', value: CO.q, 'aria-label': 'Поиск места', oninput: (e) => { CO.q = e.target.value; update(); } });
  const sideBtns = [['', 'Все'], ['t', 'T'], ['m', 'Центр'], ['ct', 'CT']].map(([k, t]) => [k, h('button', { onclick: () => { CO.side = k; update(); } }, t)]);
  const multi = places.some((p) => p.lvl >= 0);
  const lvlBtns = [['', 'Все'], ['0', 'Низкая'], ['1', 'Средняя'], ['2', 'Высокая']].map(([k, t]) => [k, h('button', { onclick: () => { CO.lvl = k; update(); } }, t)]);
  const list = h('div', { class: 'co-list', role: 'list' });
  const detail = h('div', { class: 'card co-detail' });
  const count = h('span', { class: 'muted' });
  const allBtn = h('button', { class: 'btn', onclick: () => { CO.all = !CO.all; update(); } }, 'Все названия на схеме');

  const match = (p) => {
    if (CO.side && p.side !== CO.side) return false;
    if (multi && CO.lvl && String(p.lvl) !== CO.lvl) return false;
    const q = CO.q.trim().toLowerCase(); if (!q) return true;
    return p.en.toLowerCase().includes(q) || coName(d, p.en).toLowerCase().includes(q);
  };
  function pick(en) { CO.sel = CO.sel === en ? null : en; update(); }
  function update() {
    for (const [k, b] of sideBtns) b.classList.toggle('on', k === CO.side);
    for (const [k, b] of lvlBtns) b.classList.toggle('on', k === CO.lvl);
    mapBox.classList.toggle('co-all', CO.all); allBtn.classList.toggle('on', CO.all);
    let n = 0;
    for (const p of places) {
      const g = pts.get(p.en); const ok = match(p); if (ok) n++;
      g.classList.toggle('dim', !ok); g.classList.toggle('on', CO.sel === p.en);
    }
    if (CO.sel) svg.appendChild(pts.get(CO.sel)); // выбранная метка поверх остальных
    count.textContent = tr(`Найдено: ${n}`);
    put(list, sorted.filter(match).map((p) => {
      const nm = coName(d, p.en);
      return h('button', { class: `co-item s-${p.side}${CO.sel === p.en ? ' on' : ''}`, role: 'listitem', onclick: () => pick(p.en) },
        h('i', { class: 'co-dot' }), h('span', { class: 'co-n' }, coText(nm)), nm !== p.en ? h('span', { class: 'muted co-en' }, coText(p.en)) : null);
    }), n ? null : h('div', { class: 'muted' }, 'Ничего не найдено'));
    const p = CO.sel && byEn.get(CO.sel);
    put(detail, p ? coDetail(d, p, map) : h('div', { class: 'muted' }, 'Выберите место на схеме или в списке.'));
  }

  put(root,
    h('h2', {}, 'Callouts'),
    h('div', { class: 'tabs', role: 'tablist' }, ids.map((m) => h('button', { class: m === id ? 'on' : '', role: 'tab', 'aria-selected': m === id ? 'true' : 'false', onclick: () => { CO.sel = null; CO.lvl = ''; go('callouts', m); } }, coText(d.maps[m].name)))),
    map.conf !== 'high' ? h('div', { class: 'banner' }, CO_CONF[map.conf]) : null,
    h('div', { class: 'co-wrap' },
      h('div', {}, mapBox, h('div', { class: 'row' }, allBtn, count)),
      h('div', {}, h('div', { class: 'row' }, search, h('div', { class: 'seg', role: 'group' }, sideBtns.map(([, b]) => b))),
        multi ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Высота'), h('div', { class: 'seg', role: 'group' }, lvlBtns.map(([, b]) => b))) : null, list, detail)),
    h('p', { class: 'muted co-note' }, 'Схема построена по навигационной сетке карты (это не радар Valve). Названия мест — официальные, из данных Valve; ru/de/fr — общепринятые термины сообщества. Источник данных: awpy (MIT).'));
  update();
}

function coDetail(d, p, map) {
  const nm = coName(d, p.en);
  const copy = () => { (navigator.clipboard ? navigator.clipboard.writeText(p.en) : Promise.reject()).then(() => toast(tr('Скопировано')), () => toast(tr('Не удалось скопировать'), 'bad')); };
  return h('div', {},
    h('h3', {}, map.name),
    h('div', { class: 'co-title' }, coText(nm)),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Название в игре'), h('dd', {}, coText(p.en)),
      h('dt', {}, 'Расположение'), h('dd', {}, CO_SIDE[p.side], ' · ', CO_NEAR[p.near]),
      p.lvl >= 0 ? [h('dt', {}, 'Высота'), h('dd', {}, CO_LVL[p.lvl])] : null),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: copy }, 'Скопировать название')));
}
