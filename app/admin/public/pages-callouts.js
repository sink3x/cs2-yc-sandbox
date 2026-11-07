'use strict';
// Callouts: схемы соревновательных карт и названия мест на ru/en/de/fr. Данные: GET /api/callouts, картинки: /callouts/<карта>.webp.
// Схема — собственная отрисовка проходимой геометрии (не радар Valve); названия мест — официальные, из навигации карты.
// Админ может переименовать место, перенести метку и добавить своё место (PUT /api/callouts/custom, общее для всех).

const CO = { data: null, sel: null, q: '', side: '', lvl: '', all: false, mode: null, draft: null };
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
const coCan = () => S.role !== 'player'; // правки — только админам
const coCustom = () => { const c = (CO.data && CO.data.custom) || {}; return { rename: c.rename || {}, move: c.move || {}, added: c.added || {}, side: c.side || {}, deleted: c.deleted || [] }; };
const coClone = (o) => JSON.parse(JSON.stringify(o));

function coSvg(tag, attrs = {}, parent) {
  const e = document.createElementNS(CO_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** Места карты с учётом правок: официальные (возможно переименованные/сдвинутые) + свои. key уникален среди всех карт. */
function coPlaces(d, id) {
  const cu = coCustom();
  const base = d.maps[id].places.filter(([en]) => !cu.deleted.includes(`${id}|${en}`)).map(([en, x, y, side, near, lvl]) => {
    const key = `${id}|${en}`; const mv = cu.move[key]; const sd = cu.side[key];
    return { key, en, x: mv ? mv[0] : x, y: mv ? mv[1] : y, side: sd || side, near, lvl, custom: false, renamed: !!cu.rename[key], moved: !!mv, sided: !!sd && sd !== side, name: cu.rename[key] || coName(d, en) };
  });
  const own = (cu.added[id] || []).map((a) => ({ key: `${id}|${a.id}`, id: a.id, en: '', x: a.x, y: a.y, side: a.side, near: 'm', lvl: -1, custom: true, renamed: false, moved: false, name: a.name }));
  return base.concat(own);
}

/** Сохранить правки целиком и перерисовать страницу. */
async function coSave(root, next, okMsg) {
  const r = await api('PUT', '/callouts/custom', next);
  CO.data.custom = r.custom; if (okMsg) toast(tr(okMsg), 's');
  coRender(root);
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
  const map = d.maps[id]; const places = coPlaces(d, id);
  const byKey = new Map(places.map((p) => [p.key, p]));
  if (!byKey.has(CO.sel)) CO.sel = null;
  const sorted = [...places].sort((a, b) => a.name.localeCompare(b.name, LANG));
  const can = coCan();

  // ---- схема с метками
  // схема обрезана квадратом вокруг геометрии карты (map.box = [x, y, сторона] в единицах 0..1000); метки и подписи сохраняют экранный размер
  const [bx, by, bs] = map.box || [0, 0, 1000]; const k = bs / 1000;
  const svg = coSvg('svg', { viewBox: `${bx} ${by} ${bs} ${bs}`, class: 'co-svg', role: 'group', 'aria-label': tr('Места на карте'), style: `--k:${k.toFixed(3)}` });
  coSvg('image', { href: `/callouts/${id}.webp`, x: 0, y: 0, width: 1000, height: 1000, preserveAspectRatio: 'none' }, svg).appendChild(document.createElementNS(CO_NS, 'title')).textContent = map.name;
  const pts = new Map();
  const mkPoint = (p, x, y) => {
    const site = !p.custom && (p.en === 'A Site' || p.en === 'B Site');
    const g = coSvg('g', { class: `co-pt s-${p.side}${site ? ' site' : ''}${p.custom ? ' own' : ''}`, tabindex: '0', role: 'button', 'aria-label': p.name, transform: `translate(${x} ${y})` }, svg);
    coSvg('circle', { r: (site ? 11 : 7) * k }, g);
    const t = coSvg('text', { x: 12 * k, y: 5 * k }, g); t.textContent = p.name;
    return g;
  };
  for (const p of places) {
    const g = mkPoint(p, p.x, p.y);
    g.addEventListener('click', (e) => { if (CO.mode) return; e.stopPropagation(); pick(p.key); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p.key); } });
    pts.set(p.key, g);
  }
  if (CO.draft && CO.draft.map === id) { const g = mkPoint({ name: CO.draft.name || tr('Новое место'), side: CO.draft.side, custom: true }, CO.draft.x, CO.draft.y); g.classList.add('on', 'draft'); }
  // клик по схеме в режиме «поставить / перенести»: переводим экранную точку в координаты схемы (0..1000)
  svg.addEventListener('click', (e) => {
    if (!CO.mode) return;
    const m = svg.getScreenCTM(); if (!m) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    const x = Math.min(1000, Math.max(0, Math.round(q.x * 10) / 10)); const y = Math.min(1000, Math.max(0, Math.round(q.y * 10) / 10));
    if (CO.mode === 'add') { CO.draft = { map: id, x, y, name: (CO.draft && CO.draft.name) || '', side: (CO.draft && CO.draft.side) || 'm' }; CO.mode = null; coRender(root); return; }
    if (CO.mode === 'move' && CO.sel && byKey.has(CO.sel)) { // перенос выбранной метки
      const p = byKey.get(CO.sel); CO.mode = null;
      const next = coClone(coCustom());
      if (p.custom) next.added[id] = (next.added[id] || []).map((a) => (a.id === p.id ? { ...a, x, y } : a));
      else next.move[p.key] = [x, y];
      act(() => coSave(root, next, 'Положение сохранено'))();
    }
  });
  const mapBox = h('div', { class: `co-map${CO.mode ? ' co-pick' : ''}` }, svg);

  // ---- список и поиск
  const search = h('input', { type: 'text', placeholder: 'Поиск места…', value: CO.q, 'aria-label': 'Поиск места', oninput: (e) => { CO.q = e.target.value; update(); } });
  const sideBtns = [['', 'Все'], ['t', 'T'], ['m', 'Центр'], ['ct', 'CT']].map(([key, t]) => [key, h('button', { onclick: () => { CO.side = key; update(); } }, t)]);
  const multi = places.some((p) => p.lvl >= 0);
  const lvlBtns = [['', 'Все'], ['0', 'Низкая'], ['1', 'Средняя'], ['2', 'Высокая']].map(([key, t]) => [key, h('button', { onclick: () => { CO.lvl = key; update(); } }, t)]);
  const list = h('div', { class: 'co-list', role: 'list' });
  const detail = h('div', { class: 'card co-detail' });
  const count = h('span', { class: 'muted' });
  const allBtn = h('button', { class: 'btn', onclick: () => { CO.all = !CO.all; update(); } }, 'Все названия на схеме');
  const addBtn = can ? h('button', { class: `btn${CO.mode === 'add' ? ' on' : ''}`, onclick: () => { CO.mode = CO.mode === 'add' ? null : 'add'; CO.sel = null; coRender(root); } }, 'Добавить своё место') : null;

  const match = (p) => {
    if (CO.side && p.side !== CO.side) return false;
    if (multi && CO.lvl && String(p.lvl) !== CO.lvl) return false;
    const q = CO.q.trim().toLowerCase(); if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.en.toLowerCase().includes(q) || (p.en ? coName(d, p.en).toLowerCase().includes(q) : false);
  };
  function pick(key) { CO.sel = CO.sel === key ? null : key; CO.draft = null; update(); }
  function update() {
    for (const [key, b] of sideBtns) b.classList.toggle('on', key === CO.side);
    for (const [key, b] of lvlBtns) b.classList.toggle('on', key === CO.lvl);
    mapBox.classList.toggle('co-all', CO.all); allBtn.classList.toggle('on', CO.all);
    let n = 0;
    for (const p of places) {
      const g = pts.get(p.key); const ok = match(p); if (ok) n++;
      g.classList.toggle('dim', !ok); g.classList.toggle('on', CO.sel === p.key);
    }
    if (CO.sel) svg.appendChild(pts.get(CO.sel)); // выбранная метка поверх остальных
    count.textContent = tr(`Найдено: ${n}`);
    put(list, sorted.filter(match).map((p) => h('button', { class: `co-item s-${p.side}${CO.sel === p.key ? ' on' : ''}`, role: 'listitem', onclick: () => pick(p.key) },
      h('i', { class: 'co-dot' }), h('span', { class: 'co-n' }, coText(p.name)), p.en && p.name !== p.en ? h('span', { class: 'muted co-en' }, coText(p.en)) : null)),
    n ? null : h('div', { class: 'muted' }, 'Ничего не найдено'));
    const p = CO.sel && byKey.get(CO.sel);
    put(detail, CO.draft && CO.draft.map === id ? coDraftForm(root, id) : p ? coDetail(root, d, id, p, map) : h('div', { class: 'muted' }, CO.mode === 'add' ? 'Нажмите на схему, чтобы поставить метку.' : 'Выберите место на схеме или в списке.'));
  }

  put(root,
    h('h2', {}, 'Callouts'),
    h('div', { class: 'tabs', role: 'tablist' }, ids.map((m) => h('button', { class: m === id ? 'on' : '', role: 'tab', 'aria-selected': m === id ? 'true' : 'false', onclick: () => { CO.sel = null; CO.lvl = ''; CO.mode = null; CO.draft = null; go('callouts', m); } }, coText(d.maps[m].name)))),
    map.conf !== 'high' ? h('div', { class: 'banner' }, CO_CONF[map.conf]) : null,
    CO.mode === 'add' ? h('div', { class: 'banner' }, 'Нажмите на схему, чтобы поставить метку своего места.') : null,
    CO.mode === 'move' ? h('div', { class: 'banner' }, 'Нажмите на схему, куда перенести выбранную метку.') : null,
    h('div', { class: 'co-wrap' },
      h('div', {}, mapBox, h('div', { class: 'row' }, allBtn, addBtn, count)),
      h('div', {}, h('div', { class: 'row' }, search, h('div', { class: 'seg', role: 'group' }, sideBtns.map(([, b]) => b))),
        multi ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Высота'), h('div', { class: 'seg', role: 'group' }, lvlBtns.map(([, b]) => b))) : null, list, detail)),
    coHidden(root, d, id, can),
    h('p', { class: 'muted co-note' }, 'Схема построена по навигационной сетке карты (это не радар Valve). Названия мест — официальные, из данных Valve; ru/de/fr — общепринятые термины сообщества. Источник данных: awpy (MIT).'));
  update();
}

/** Форма нового места: название и сторона; метка уже стоит на схеме. */
function coDraftForm(root, id) {
  const dr = CO.draft;
  const name = h('input', { type: 'text', maxlength: '40', value: dr.name, placeholder: 'Название места', 'aria-label': 'Название места', oninput: (e) => { dr.name = e.target.value; } });
  const side = h('div', { class: 'seg', role: 'group' }, [['t', 'T'], ['m', 'Центр'], ['ct', 'CT']].map(([key, t]) => h('button', { class: dr.side === key ? 'on' : '', onclick: (e) => { dr.side = key; [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, t)));
  const ok = act(async () => {
    const nm = name.value.trim(); if (!nm) throw new Error(tr('Введите название места'));
    const cu = coClone(coCustom()); const used = new Set((cu.added[id] || []).map((a) => a.id));
    let n = Date.now() % 1e6; let nid; do { nid = `c${n.toString(36)}`; n++; } while (used.has(nid));
    cu.added[id] = [...(cu.added[id] || []), { id: nid, name: nm, x: dr.x, y: dr.y, side: dr.side }];
    CO.draft = null; await coSave(root, cu, 'Место добавлено');
  });
  return h('div', {},
    h('h3', {}, 'Новое место'), h('div', { class: 'row' }, name), h('div', { class: 'row' }, side),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: ok }, 'Сохранить'),
      h('button', { class: 'btn', onclick: () => { CO.mode = 'add'; coRender(root); } }, 'Выбрать точку заново'),
      h('button', { class: 'btn', onclick: () => { CO.draft = null; CO.mode = null; coRender(root); } }, 'Отмена')));
}

function coDetail(root, d, id, p, map) {
  const copy = () => { (navigator.clipboard ? navigator.clipboard.writeText(p.name) : Promise.reject()).then(() => toast(tr('Скопировано')), () => toast(tr('Не удалось скопировать'), 'bad')); };
  const edit = !coCan() ? null : (() => {
    const next = () => coClone(coCustom());
    const input = h('input', { type: 'text', maxlength: '40', value: p.name, 'aria-label': 'Своё название', onkeydown: (e) => { if (e.key === 'Enter') saveName(e); } });
    const saveName = act(async () => {
      const nm = input.value.trim(); const n = next();
      if (p.custom) { if (!nm) throw new Error(tr('Введите название места')); n.added[id] = n.added[id].map((a) => (a.id === p.id ? { ...a, name: nm } : a)); }
      else if (!nm || nm === coName(d, p.en)) delete n.rename[p.key]; else n.rename[p.key] = nm;
      await coSave(root, n, 'Сохранено');
    });
    const reset = act(async () => { const n = next(); delete n.rename[p.key]; delete n.move[p.key]; delete n.side[p.key]; await coSave(root, n, 'Сброшено к исходному'); });
    const del = act(async () => {
      if (!confirm(tr(p.custom ? 'Удалить это место?' : 'Скрыть это место? Его можно вернуть в списке скрытых мест.'))) return;
      const n = next();
      if (p.custom) { n.added[id] = (n.added[id] || []).filter((a) => a.id !== p.id); if (!n.added[id].length) delete n.added[id]; }
      else { n.deleted = [...new Set([...n.deleted, p.key])]; delete n.rename[p.key]; delete n.move[p.key]; delete n.side[p.key]; } // официальное место только скрываем: его можно вернуть
      CO.sel = null; await coSave(root, n, p.custom ? 'Место удалено' : 'Место скрыто');
    });
    const setSide = (key) => act(async () => {
      const n = next();
      if (p.custom) n.added[id] = n.added[id].map((a) => (a.id === p.id ? { ...a, side: key } : a)); else n.side[p.key] = key;
      await coSave(root, n);
    });
    const sideSeg = h('div', { class: 'seg', role: 'group' }, [['t', 'T'], ['m', 'Центр'], ['ct', 'CT']].map(([key, t]) => h('button', { class: p.side === key ? 'on' : '', onclick: setSide(key) }, t)));
    return h('div', { class: 'co-edit' },
      h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: saveName }, 'Сохранить название')),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Сторона'), sideSeg),
      h('div', { class: 'row' },
        h('button', { class: `btn${CO.mode === 'move' ? ' on' : ''}`, onclick: () => { CO.mode = CO.mode === 'move' ? null : 'move'; coRender(root); } }, 'Перенести метку'),
        !p.custom && (p.renamed || p.moved || p.sided) ? h('button', { class: 'btn', onclick: reset }, 'Сбросить к исходному') : null,
        h('button', { class: 'btn danger', onclick: del }, p.custom ? 'Удалить место' : 'Скрыть место')));
  })();
  return h('div', {},
    h('h3', {}, map.name),
    h('div', { class: 'co-title' }, coText(p.name)),
    h('dl', { class: 'kv' },
      p.custom ? [h('dt', {}, 'Тип'), h('dd', {}, 'Своё место')] : [h('dt', {}, 'Название в игре'), h('dd', {}, coText(p.en))],
      h('dt', {}, 'Расположение'), h('dd', {}, CO_SIDE[p.side], p.custom ? null : [' · ', CO_NEAR[p.near]]),
      p.lvl >= 0 ? [h('dt', {}, 'Высота'), h('dd', {}, CO_LVL[p.lvl])] : null),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: copy }, 'Скопировать название')),
    edit);
}

/** Скрытые официальные места карты: список с возвратом (только админам). */
function coHidden(root, d, id, can) {
  const cu = coCustom(); const hidden = cu.deleted.filter((k) => k.startsWith(`${id}|`));
  if (!can || !hidden.length) return null;
  const back = (keys) => act(async () => { const n = coClone(coCustom()); n.deleted = n.deleted.filter((k) => !keys.includes(k)); await coSave(root, n, 'Место возвращено'); });
  return h('div', { class: 'card co-hidden' }, h('h3', {}, `${tr('Скрытые места')} (${hidden.length})`),
    h('div', { class: 'chips' }, hidden.map((k) => { const en = k.slice(id.length + 1); return h('button', { class: 'chip', title: tr('Вернуть'), onclick: back([k]) }, `↩ ${coName(d, en)}`); })),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: back(hidden) }, 'Вернуть все')));
}
