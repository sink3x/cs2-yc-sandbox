'use strict';
// Редактор скинов: игрок → оружие/нож/перчатки/агент/музыка → предпросмотр → запись в базу WeaponPaints.

const K = { cat: null, players: [], steamid: store.get('skinPlayer', ''), loadout: null, tab: 'Rifles', weapon: null, q: '', sel: null, shown: 48, err: null, sort: store.get('skinSort', 'default') };
const SORTS = [['default', 'По умолчанию'], ['name', 'По названию А–Я'], ['rar', 'Редкость: высокая → низкая'], ['rar_asc', 'Редкость: низкая → высокая'], ['float', 'Float: меньше → больше'], ['float_desc', 'Float: больше → меньше'], ['eq', 'Надетые первыми']];
const RAR_ORDER = ['consumer', 'industrial', 'mil-spec', 'restricted', 'classified', 'covert', 'contraband', 'extraordinary'];
const rarRank = (r) => { const n = String((r && r.n) || '').toLowerCase(); const i = RAR_ORDER.findIndex((x) => n.includes(x)); return i < 0 ? (n === 'своё' ? 99 : -1) : i; };
const SKIN_TABS = [['Knives', 'Ножи'], ['Gloves', 'Перчатки'], ['Rifles', 'Винтовки'], ['Pistols', 'Пистолеты'], ['SMGs', 'Пистолеты-пулемёты'], ['Heavy', 'Тяжёлое'], ['Equipment', 'Zeus'], ['Agents', 'Агенты'], ['Music', 'Музыка'], ['Custom', 'Свои']];

/** Моменты, на которые играет музыкальный набор: [id, подпись, когда играет, кто слышит, слово для поиска]. */
const MUSIC_EVENTS = [
  ['mainmenu', 'Главное меню', 'играет в меню игры', 'me', 'main menu'],
  ['chooseteam', 'Выбор команды', 'пока вы выбираете сторону', 'me', 'choose team'],
  ['startround', 'Начало раунда', 'в начале раунда, во время заморозки', 'me', 'round start'],
  ['startaction', 'Экшн-старт', 'в первые секунды после заморозки', 'me', 'start action'],
  ['bombplanted', 'Бомба заложена', 'сразу после установки бомбы', 'me', 'bomb planted'],
  ['bombtenseccount', '10 сек до взрыва', 'последние 10 секунд таймера бомбы', 'me', 'bomb 10 second'],
  ['roundtenseccount', '10 сек до конца', 'последние 10 секунд раунда', 'me', 'round 10 seconds'],
  ['wonround', 'Победа в раунде', 'когда ваша команда выиграла раунд', 'me', 'won round'],
  ['lostround', 'Поражение', 'когда ваша команда проиграла раунд', 'me', 'lost round'],
  ['roundmvpanthem', 'MVP-гимн', 'когда вас выбрали MVP раунда', 'all', 'MVP anthem'],
  ['deathcam', 'Камера смерти', 'после вашей гибели', 'me', 'deathcam'],
];
const extLink = (href, text) => h('a', { class: 'btn', href, target: '_blank', rel: 'noopener noreferrer' }, text);
const WEAR_PRESETS = [['FN', 0.03], ['MW', 0.1], ['FT', 0.25], ['WW', 0.41], ['BS', 0.6]];
const wearName = (w) => (w < 0.07 ? 'Прямо с завода' : w < 0.15 ? 'Немного поношенное' : w < 0.38 ? 'После полевых' : w < 0.45 ? 'Поношенное' : 'Закалённое в боях');

const imgUrl = (u) => (!u ? '' : /^https?:/.test(u) ? u : K.cat.imgBase + u);
const skinImg = (u, alt) => (u ? h('img', { src: imgUrl(u), alt: alt || '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.display = 'none'; } }) : h('span', { class: 'muted small' }, 'нет картинки'));

/** Плоский список скинов каталога + пользовательские. */
function skinItems() {
  if (K.items) return K.items;
  const c = K.cat; const weapons = c.weapons.slice();
  const items = c.skins.map(([paint, wi, name, ri, min, max, st, img]) => ({ paint, wi, weapon: weapons[wi], name, rar: c.rarities[ri], min, max, st: !!st, img }));
  for (const s of c.custom || []) {
    let wi = weapons.findIndex((w) => w.def === s.def);
    if (wi < 0) { weapons.push({ id: s.weaponId || `custom_${s.def}`, def: s.def, name: s.weaponName || `Предмет ${s.def}`, cat: 'Custom', kind: s.kind || 'weapon' }); wi = weapons.length - 1; }
    items.push({ paint: s.paint, wi, weapon: weapons[wi], name: s.name, rar: { n: 'Своё', c: '#a371f7' }, min: 0, max: 1, st: true, img: s.img, custom: true });
  }
  K.weapons = weapons; K.items = items;
  return items;
}
const findSkin = (def, paint) => skinItems().find((s) => s.weapon.def === def && s.paint === paint);

async function loadSkinCatalog() {
  if (K.cat) return;
  K.cat = await api('GET', '/skins/catalog'); K.items = null; skinItems();
}
async function loadPlayers() {
  if (S.role === 'player') { K.players = [{ steamid: S.steamid, name: S.display || S.user, self: true }]; K.steamid = S.steamid; return; }
  const base = []; const admins = (S.state && S.state.state.admins) || [];
  for (const a of admins) base.push({ steamid: a.steamid, name: a.name, admin: true });
  try { const r = await api('GET', '/skins/players'); for (const p of r.players) { const e = base.find((x) => x.steamid === p.steamid); if (e) Object.assign(e, p, { name: p.name || e.name }); else base.push(p); } } catch { /* сервер выключен */ }
  K.players = base;
  if (!K.steamid && base.length) K.steamid = (base.find((p) => p.online) || base[0]).steamid;
}
async function loadLoadout() {
  K.err = null; K.loadout = null;
  if (!K.steamid) return;
  try { K.loadout = await api('GET', `/skins/loadout/${K.steamid}`); } catch (e) { K.err = e.message; }
}
async function applyOps(ops, msg) {
  await api('POST', `/skins/apply/${K.steamid}`, { ops });
  await loadLoadout();
  toast(`${msg || 'Сохранено'}. Игроку: напишите !wp в чате (или перезайдите).`, 's');
}

function pageSkins() {
  const root = h('div', {});
  const draw = () => {
    if (!K.cat) { root.replaceChildren(h('h2', {}, 'Скины'), h('div', { class: 'muted' }, 'Загружаю каталог скинов (в первый раз — до минуты)…')); return; }
    root.replaceChildren(skinsView(draw));
  };
  draw();
  (async () => {
    try { await loadSkinCatalog(); await loadPlayers(); await loadLoadout(); } catch (e) { root.replaceChildren(h('h2', {}, 'Скины'), h('div', { class: 'banner' }, e.message)); return; }
    draw();
  })();
  return root;
}

function skinsView(redraw) {
  const items = skinItems(); const L = K.loadout && K.loadout.available ? K.loadout : null;
  const warn = () => (!K.steamid ? 'Выберите игрока или введите SteamID.' : K.err ? K.err : K.loadout && !K.loadout.available ? K.loadout.reason : null);
  const player = K.players.find((p) => p.steamid === K.steamid);

  // ---- выбор игрока
  const sel = h('select', {}, [h('option', { value: '' }, '— выберите игрока —')].concat(K.players.map((p) => h('option', { value: p.steamid, selected: p.steamid === K.steamid }, `${p.name || p.steamid}${p.online ? ` ${tr('● в игре')}` : ''}${p.admin ? ` ${tr('· админ')}` : ''}${p.hasLoadout ? ` ${tr('· есть скины')}` : ''}`))));
  sel.addEventListener('change', async () => { K.steamid = sel.value; store.set('skinPlayer', K.steamid); await loadLoadout(); redraw(); });
  const manual = h('input', { type: 'text', placeholder: 'SteamID64, STEAM_0:…, [U:1:…] или ссылка /profiles/…', style: 'width:340px' });
  const openManual = act(async () => { const id = parseSteamId(manual.value); if (!id) throw new Error('Не распознал SteamID. Нужен 17-значный SteamID64 (ссылки вида /id/имя не подходят — возьмите ID на steamid.io).'); K.steamid = id; store.set('skinPlayer', id); if (!K.players.some((p) => p.steamid === id)) K.players.push({ steamid: id, name: null }); await loadLoadout(); redraw(); });

  // ---- вкладки и оружия
  const tabs = h('div', { class: 'tabs' }, SKIN_TABS.map(([k, t]) => h('button', { class: K.tab === k ? 'on' : '', onclick: () => { K.tab = k; K.weapon = null; K.shown = 48; redraw(); } }, t)));
  const catWeapons = K.weapons.filter((w) => w.cat === K.tab && items.some((s) => s.weapon === w));
  // ---- точный выбор оружия из любой категории + сортировка
  const allWeapons = K.weapons.filter((w) => items.some((s) => s.weapon === w));
  const wInput = h('input', { type: 'text', placeholder: 'Конкретное оружие: ak-47, m4a1-s, awp, карамбит…', style: 'width:300px' });
  const wBox = autocomplete(wInput, (t) => rank(allWeapons.map((w) => ({ value: w.name, desc: SKIN_TABS.find((x) => x[0] === w.cat)?.[1] || w.cat, w })), t), {
    limit: 10, onPick: (o) => { K.tab = o.w.cat; K.weapon = o.w.def; K.q = ''; K.shown = 48; redraw(); } });
  const curW = K.weapon !== null ? K.weapons.find((w) => w.def === K.weapon) : null;
  if (curW) wInput.value = curW.name;
  const sortSel = h('select', { title: 'Сортировка' }, SORTS.map(([k, t]) => h('option', { value: k, selected: K.sort === k }, t)));
  sortSel.addEventListener('change', () => { K.sort = sortSel.value; store.set('skinSort', K.sort); K.shown = 48; gridUpdate(); });
  const resetW = curW ? h('button', { class: 'btn', onclick: () => { K.weapon = null; K.shown = 48; redraw(); } }, 'Все ' + (SKIN_TABS.find((x) => x[0] === K.tab)?.[1] || '').toLowerCase()) : null;
  const weaponBar = ['Agents', 'Music'].includes(K.tab) ? null : h('div', { class: 'row', style: 'margin-bottom:10px' }, wBox, resetW, h('span', { class: 'spacer' }), 'Сортировка:', sortSel);

  // ---- выбор модели оружия/ножа: карточки с «голым» оружием (без скина и окраса); ниже — все скины выбранной модели
  const modelEq = (w) => L && (w.kind === 'knife' ? L.knives.some((k) => k.knife === w.id) : L.skins.some((x) => x.def === w.def));
  const modelPicker = ['Agents', 'Music', 'Custom'].includes(K.tab) ? null : h('div', { style: 'margin-bottom:12px' },
    h('div', { class: 'muted small', style: 'margin-bottom:6px' }, K.tab === 'Knives' ? 'Выберите модель ножа — ниже появятся только его скины. Нож надевается кнопкой «Надеть нож» в редакторе справа.' : 'Выберите модель — ниже появятся все её скины. Картинки здесь без скинов, как стандартное оружие.'),
    h('div', { class: 'skin-grid knife-grid' }, [null].concat(catWeapons).map((w) => {
      // картинка: стандартное оружие из каталога; у ножей — «ваниль»; окрашенный скин для списка моделей не подставляем
      const van = w && (w.img ? { img: w.img } : items.find((s) => s.weapon === w && s.paint === 0 && s.img));
      return h('button', { class: `skin ${(w ? K.weapon === w.def : K.weapon === null) ? 'sel' : ''} ${w && modelEq(w) ? 'eq' : ''}`, onclick: () => { K.weapon = w ? w.def : null; K.q = ''; K.shown = 48; redraw(); } },
        h('div', { class: 'img' }, w ? (van ? skinImg(van.img, w.name) : h('span', { class: 'muted small' }, 'нет фото')) : h('span', { class: 'muted' }, 'Все')),
        h('div', { class: 'nm' }, w ? w.name : (K.tab === 'Knives' ? 'Все ножи' : 'Все'), h('small', {}, w ? `${items.filter((s) => s.weapon === w).length} скинов` : '')));
    })));
  const weaponChips = K.tab !== 'Custom' ? null : h('div', { class: 'chips', style: 'margin-bottom:10px' },
    h('span', { class: 'chip', style: K.weapon === null ? 'border-color:var(--accent)' : '', onclick: () => { K.weapon = null; K.shown = 48; redraw(); } }, 'Все'),
    K.weapons.filter((w) => items.some((s) => s.custom && s.weapon === w)).map((w) => h('span', { class: 'chip', style: K.weapon === w.def ? 'border-color:var(--accent);color:var(--accent)' : '', onclick: () => { K.weapon = w.def; K.shown = 48; redraw(); } }, w.name)));

  // ---- поиск по всем скинам
  const search = h('input', { type: 'text', value: K.q, placeholder: 'Поиск: «редлайн», fade, ak, карамбит…', style: 'width:320px' });
  const searchW = autocomplete(search, (t) => (t.length < 2 ? [] : rank(items.filter((s) => s.paint || s.weapon.kind === 'knife').map((s) => ({ value: `${s.weapon.name} | ${s.name}`, desc: s.rar.n, s })), t)), {
    limit: 8, onPick: (o) => { K.q = ''; K.tab = o.s.weapon.cat; K.weapon = o.s.weapon.def; K.sel = { skin: o.s }; initEdit(); redraw(); } });
  search.addEventListener('input', () => { K.q = search.value.trim().toLowerCase(); K.shown = 48; gridUpdate(); });

  // ---- сетка
  const gridBox = h('div', {});
  const equipped = (s) => {
    if (!L) return false;
    if (s.weapon.kind === 'knife') return L.knives.some((k) => k.knife === s.weapon.id) && (s.paint === 0 ? !L.skins.some((x) => x.def === s.weapon.def) : L.skins.some((x) => x.def === s.weapon.def && x.paint === s.paint));
    return L.skins.some((x) => x.def === s.weapon.def && x.paint === s.paint) && (s.weapon.kind !== 'glove' || L.gloves.some((g) => g.def === s.weapon.def));
  };
  function gridUpdate() {
    let nodes;
    if (K.tab === 'Agents' && !K.q) {
      nodes = K.cat.agents.map((a) => card({ img: a.img, title: a.name.split(' | ')[0], sub: `${a.name.split(' | ')[1] || ''} · ${a.team === 'ct' ? 'CT' : 'T'}`, color: K.cat.rarities[a.rarity].c, eq: L && (L.agents.ct === a.model || L.agents.t === a.model), sel: K.sel && K.sel.agent === a, onclick: () => { K.sel = { agent: a }; redraw(); } }));
    } else if (K.tab === 'Music' && !K.q) {
      nodes = K.cat.music.map((m) => card({ img: m.img, title: m.name, sub: `Набор №${m.id}`, eq: L && L.music.some((x) => x.id === m.id), sel: K.sel && K.sel.music === m, onclick: () => { K.sel = { music: m }; redraw(); } }));
    } else {
      let list = items;
      if (K.q) list = list.filter((s) => `${s.weapon.name} ${s.name}`.toLowerCase().includes(K.q));
      else list = list.filter((s) => s.weapon.cat === K.tab || (K.tab === 'Custom' && s.custom));
      if (K.weapon !== null) list = list.filter((s) => s.weapon.def === K.weapon);
      if (K.sort !== 'default') {
        const fl = (s) => (s.paint === 0 ? -1 : s.min);
        const cmp = { name: (a, b) => a.name.localeCompare(b.name, 'ru'), rar: (a, b) => rarRank(b.rar) - rarRank(a.rar), rar_asc: (a, b) => rarRank(a.rar) - rarRank(b.rar),
          float: (a, b) => fl(a) - fl(b) || a.max - b.max, float_desc: (a, b) => b.max - a.max || b.min - a.min, eq: (a, b) => Number(equipped(b)) - Number(equipped(a)) }[K.sort];
        if (cmp) list = list.slice().sort(cmp);
      }
      const total = list.length; list = list.slice(0, K.shown);
      nodes = list.map((s) => card({ img: s.img, title: s.paint === 0 ? 'Ваниль' : s.name, sub: s.weapon.name, color: s.rar.c, eq: equipped(s), sel: K.sel && K.sel.skin === s, badge: s.custom ? 'своё' : null, onclick: () => { K.sel = { skin: s }; initEdit(); redraw(); } }));
      if (total > K.shown) nodes.push(h('button', { class: 'btn', onclick: () => { K.shown += 96; gridUpdate(); } }, `Показать ещё (${total - K.shown})`));
      if (!total) nodes = [h('div', { class: 'muted' }, K.tab === 'Custom' ? 'Своих скинов пока нет — добавьте внизу.' : 'Ничего не найдено.')];
    }
    gridBox.replaceChildren(h('div', { class: 'skin-grid' }, nodes));
  }
  function card({ img, title, sub, color, eq, sel: s, onclick, badge }) {
    return h('button', { class: `skin ${s ? 'sel' : ''} ${eq ? 'eq' : ''}`, style: color ? `--rar:${color}` : '', onclick }, h('div', { class: 'img' }, skinImg(img, title)), h('div', { class: 'nm' }, title, h('small', {}, sub), badge ? h('small', { style: 'color:var(--accent)' }, badge) : null));
  }
  gridUpdate();

  return h('div', {}, h('h2', {}, 'Скины, ножи, перчатки, агенты'),
    h('div', { class: 'card' }, S.role === 'player' ? null : h('div', { class: 'row' }, 'Игрок:', sel, h('button', { class: 'btn', onclick: act(async () => { await loadPlayers(); await loadLoadout(); redraw(); }, 'Список обновлён') }, 'Обновить')),
      S.role === 'player' ? null : h('div', { class: 'row' }, manual, h('button', { class: 'btn', onclick: openManual }, 'Открыть по SteamID')),
      warn() ? h('div', { class: 'warn small' }, warn()) : h('div', { class: 'muted small' }, `${player && player.name ? player.name + ' · ' : ''}${K.steamid}. Скины попадают в базу сразу; в игре игрок пишет !wp (или перезаходит). Новые игроки появляются в списке после первого входа и выбора скина или через ввод SteamID.`)),
    h('div', { class: 'skin-layout' },
      h('div', {}, h('div', { class: 'row' }, searchW), tabs, weaponBar, modelPicker, weaponChips, gridBox),
      h('div', { class: 'side-sticky' }, previewPanel(redraw, L), loadoutPanel(redraw, L))),
    S.role === 'admin' ? customSkinForm(redraw) : null);
}

// ---------------------------------------------------------------- редактор выбранного предмета
const E = { wear: 0.01, seed: 0, nametag: '', stattrak: false, count: 0, teams: 'both' };
function initEdit() {
  const s = K.sel && K.sel.skin; if (!s) return;
  const L = K.loadout && K.loadout.available ? K.loadout : null;
  const cur = L && L.skins.find((x) => x.def === s.weapon.def && x.paint === s.paint);
  Object.assign(E, cur ? { wear: cur.wear ?? 0.01, seed: cur.seed ?? 0, nametag: cur.nametag, stattrak: !!cur.stattrak, count: cur.stattrakCount } : { wear: Math.min(Math.max(0.01, s.min), s.max), seed: 0, nametag: '', stattrak: false, count: 0 });
}
const teamList = () => (E.teams === 'both' ? [2, 3] : [Number(E.teams)]);

function previewPanel(redraw, L) {
  const sel = K.sel;
  if (!sel) return h('div', { class: 'card preview' }, h('h3', {}, 'Предпросмотр'), h('div', { class: 'muted' }, 'Выберите скин слева: здесь появятся картинка, настройки износа, паттерна и кнопка «Надеть».'));
  const need = () => { if (!K.steamid || !L) throw new Error(warn2()); };
  const warn2 = () => (!K.steamid ? 'Сначала выберите игрока' : (K.err || (K.loadout && K.loadout.reason) || 'База скинов недоступна'));
  const teamSel = h('select', {}, [['both', 'За обе команды'], ['2', 'Только T'], ['3', 'Только CT']].map(([v, t]) => h('option', { value: v, selected: E.teams === v }, t)));
  teamSel.addEventListener('change', () => { E.teams = teamSel.value; });

  if (sel.agent) {
    const a = sel.agent;
    return h('div', { class: 'card preview' }, h('h3', {}, 'Агент'), h('div', { class: 'big', style: `--rar:${K.cat.rarities[a.rarity].c}` }, skinImg(a.img, a.name)), h('b', {}, a.name), h('div', { class: 'muted small' }, `Команда: ${a.team === 'ct' ? 'CT' : 'T'} · модель ${a.model.split('/').pop()}`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: act(async () => { need(); await applyOps([{ op: 'agents', [a.team]: a.model }], 'Агент надет'); redraw(); }) }, 'Надеть агента'),
        h('button', { class: 'btn', onclick: act(async () => { need(); await applyOps([{ op: 'agents', [a.team]: null }], 'Агент снят'); redraw(); }) }, `Снять (${a.team === 'ct' ? 'CT' : 'T'})`)),
      h('div', { class: 'viewlinks' }, h('b', {}, 'Посмотреть агента'),
        h('div', { class: 'row' },
          extLink(`https://www.google.com/search?q=${encodeURIComponent(`"${a.name}" CS2 agent 3D viewer`)}`, '🧍 3D, в полный рост'),
          extLink(`https://www.google.com/search?q=${encodeURIComponent(`"${a.name}" CS2 agent first person sleeves arms`)}`, '✋ Руки от первого лица'),
          extLink(`https://steamcommunity.com/market/listings/730/${encodeURIComponent(a.name)}`, 'Steam Market')),
        h('div', { class: 'hint' }, 'В каталоге у агента только портрет. Полноростовая 3D-модель и вид рук от первого лица есть у сторонних просмотрщиков (поиск откроется в новой вкладке); собственный 3D-просмотр потребует вытащить модели из файлов игры на сервере.')),
      h('div', { class: 'hint' }, 'Модель агента сохраняется как путь agents/models/…; если после надевания агент не сменился, откройте /agents в игре один раз — это подскажет формат вашей версии плагина.'));
  }
  if (sel.music) {
    const m = sel.music;
    const ev = MUSIC_EVENTS.find((e) => e[0] === (K.musicEvent || 'wonround')) || MUSIC_EVENTS[0];
    const q = (extra) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${m.name} CS2 music kit ${extra}`.trim())}`;
    const info = h('div', { class: 'muted small' });
    const chips = h('div', { class: 'chips' });
    const paintEv = () => {
      chips.replaceChildren(...MUSIC_EVENTS.map(([id, label]) => h('button', { class: `chip ${id === ev[0] ? 'on' : ''}`, onclick: () => { K.musicEvent = id; redraw(); } }, label)));
      info.replaceChildren(h('b', {}, ev[1]), ' — ', ev[2], ' ', h('span', { class: ev[3] === 'all' ? 'tag okc' : 'tag' }, ev[3] === 'all' ? 'слышат все игроки' : 'слышите только вы'));
    };
    paintEv();
    return h('div', { class: 'card preview' }, h('h3', {}, 'Музыкальный набор'), h('div', { class: 'big' }, skinImg(m.img, m.name)), h('b', {}, m.name),
      h('div', { class: 'row' }, teamSel, h('button', { class: 'btn primary', onclick: act(async () => { need(); await applyOps([{ op: 'music', id: m.id, teams: teamList() }], 'Музыка выбрана'); redraw(); }) }, 'Выбрать'),
        h('button', { class: 'btn', onclick: act(async () => { need(); await applyOps([{ op: 'music', id: 0 }], 'Музыка сброшена'); redraw(); }) }, 'Сбросить')),
      h('div', { class: 'viewlinks' }, h('b', {}, 'Прослушать и выбрать момент'), chips, info,
        h('div', { class: 'row' }, extLink(q(ev[4]), `▶ Слушать: ${ev[1]}`), extLink(q(''), '▶ Весь набор'), extLink(`https://steamcommunity.com/market/listings/730/${encodeURIComponent(`Music Kit | ${m.name}`)}`, 'Steam Market')),
        h('div', { class: 'hint' }, 'Звук набора Valve не публикует, поэтому прослушивание открывается на YouTube в новой вкладке (по выбранному моменту).')),
      h('div', { class: 'hint' }, 'Набор применяется целиком: выбрать звук для отдельного события (MVP, конец раунда) нельзя — это ограничение игры и плагина WeaponPaints. StatTrak™ для музыкальных наборов плагин не поддерживает (в базе нет поля для счётчика MVP), поэтому дубли «StatTrak» убраны из списка, а переключателя нет.'));
  }
  const s = sel.skin; const kind = s.weapon.kind;
  const wearIn = h('input', { type: 'range', min: s.min, max: s.max, step: 0.001, value: Math.min(Math.max(E.wear, s.min), s.max) });
  const wearNum = h('input', { type: 'number', min: 0, max: 1, step: 0.001, value: E.wear, style: 'width:90px' });
  const seedIn = h('input', { type: 'number', min: 0, max: 1000, value: E.seed, style: 'width:90px' });
  const tagIn = h('input', { type: 'text', value: E.nametag, maxlength: 20, placeholder: 'Бирка с именем (до 20 символов)' });
  const stIn = h('input', { type: 'checkbox', checked: E.stattrak }); const cntIn = h('input', { type: 'number', min: 0, value: E.count, style: 'width:90px' });
  const scratch = h('div', { class: 'wear-scratch' });
  const bigImg = h('div', { class: 'big', style: `--rar:${s.rar.c}` }, skinImg(s.img, s.name), s.paint === 0 ? null : scratch);
  const meta = h('div', { class: 'muted small' });
  const upd = () => {
    E.wear = Number(wearNum.value); E.seed = Number(seedIn.value); E.nametag = tagIn.value; E.stattrak = stIn.checked; E.count = Number(cntIn.value);
    if (s.paint !== 0) { const lk = SkinLinks.wearLook(E.wear); const im = bigImg.querySelector('img'); if (im) im.style.filter = lk.filter; scratch.style.opacity = lk.scratch; }
    meta.textContent = tr(`${wearName(E.wear)} · float ${E.wear.toFixed(3)} · паттерн ${E.seed}${E.nametag ? ` · «${E.nametag}»` : ''}${E.stattrak ? ` · StatTrak™ ${E.count}` : ''}`);
  };
  wearIn.addEventListener('input', () => { wearNum.value = wearIn.value; upd(); }); wearNum.addEventListener('input', () => { wearIn.value = wearNum.value; upd(); });
  for (const el of [seedIn, tagIn, stIn, cntIn]) el.addEventListener('input', upd);
  upd();
  const ops = (withPaint = true) => {
    const base = { op: 'skin', teams: teamList(), def: s.weapon.def, paint: withPaint ? s.paint : 0, wear: E.wear, seed: E.seed, nametag: E.nametag, stattrak: E.stattrak, stattrakCount: E.count };
    if (kind === 'knife') return [{ op: 'knife', teams: teamList(), knife: s.weapon.id }, base];
    if (kind === 'glove') return [{ op: 'gloves', teams: teamList(), def: s.weapon.def }, base];
    return [base];
  };
  return h('div', { class: 'card preview' }, h('h3', {}, kind === 'knife' ? 'Нож' : kind === 'glove' ? 'Перчатки' : 'Оружие'), bigImg,
    h('div', { style: 'margin-top:8px' }, h('b', {}, s.paint === 0 ? `${s.weapon.name} (ваниль)` : `${s.weapon.name} | ${s.name}`), h('div', { class: 'small', style: `color:${s.rar.c}` }, s.rar.n)),
    s.paint === 0 ? h('div', { class: 'hint' }, 'Ваниль — нож без скина.') : h('div', {},
      h('div', { class: 'row' }, 'Износ', wearIn, wearNum), h('div', { class: 'chips' }, WEAR_PRESETS.map(([t, w]) => h('span', { class: 'chip', onclick: () => { const v = Math.min(Math.max(w, s.min), s.max); wearIn.value = v; wearNum.value = v.toFixed(3); upd(); } }, t))),
      h('div', { class: 'row' }, 'Паттерн', seedIn, h('button', { class: 'btn', title: 'Случайный', onclick: () => { seedIn.value = Math.floor(Math.random() * 1001); upd(); } }, 'Случайный')),
      kind === 'weapon' ? h('div', {}, h('div', { class: 'row' }, tagIn), s.st ? h('div', { class: 'row' }, h('label', { class: 'switch' }, stIn, 'StatTrak™'), cntIn, 'убийств') : null) : null),
    s.paint === 0 ? null : h('div', { class: 'hint' }, 'Вид износа на картинке приблизительный: в каталоге одна картинка на скин. Точный вид покажет осмотр в игре.'),
    meta, h('div', { class: 'row' }, teamSel),
    s.paint === 0 ? null : skinLinksBlock(s),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: act(async () => { need(); await applyOps(ops(), 'Надето'); redraw(); }) }, kind === 'weapon' ? 'Надеть скин' : kind === 'knife' ? 'Надеть нож' : 'Надеть перчатки'),
      kind === 'weapon' ? h('button', { class: 'btn', onclick: act(async () => { need(); await applyOps([{ op: 'unskin', teams: teamList(), def: s.weapon.def }], 'Скин снят'); redraw(); }) }, 'Снять скин') : null,
      kind === 'glove' ? h('button', { class: 'btn', onclick: act(async () => { need(); await applyOps([{ op: 'gloves', def: 0 }, { op: 'unskin', def: s.weapon.def }], 'Перчатки сняты'); redraw(); }) }, 'Снять перчатки') : null));
}

/** Осмотр в игре, 3D/скриншот, поиск такого же скина на маркетах — по текущим настройкам редактора (E). */
function skinLinksBlock(s) {
  const item = () => ({ def: s.weapon.def, paint: s.paint, wear: E.wear, seed: E.seed, kind: s.weapon.kind, rarityName: s.rar.n, stattrak: E.stattrak, count: E.count, nametag: E.nametag, weaponName: s.weapon.name, skinName: s.name });
  const inspect = () => SkinLinks.inspectUrl(SkinLinks.previewData(item()));
  const open = (url) => window.open(url, '_blank', 'noopener');
  const copyText = async (t, msg) => { try { await navigator.clipboard.writeText(t); toast(msg, 's'); } catch { toast(t); } };
  const market = (key, label) => h('a', { class: 'btn', href: '#', target: '_blank', rel: 'noopener', onclick: (e) => { e.preventDefault(); open(SkinLinks.marketLinks(item())[key]); } }, label);
  return h('details', { class: 'skin-links' }, h('summary', {}, 'Осмотр, 3D и поиск такого скина'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { location.href = inspect(); } }, 'Осмотреть в игре'),
      h('button', { class: 'btn', onclick: () => copyText(inspect(), 'Ссылка на осмотр скопирована') }, 'Копировать ссылку')),
    h('div', { class: 'hint' }, 'Ссылка содержит все параметры (износ, паттерн, StatTrak, бирка): предмет в инвентаре не нужен. Для «в игре» на вашем компьютере должен быть запущен Steam.'),
    h('div', { class: 'row' }, SkinLinks.VIEWERS.map(([t, url]) => h('button', { class: 'btn', onclick: () => { copyText(inspect(), 'Ссылка скопирована: вставьте её на открывшейся странице'); open(url); } }, t))),
    h('div', { class: 'muted small' }, 'Похожий скин (тот же износ):'),
    h('div', { class: 'row' }, market('csmoney', 'CS.MONEY'), market('lis', 'LIS-SKINS'), market('csfloat', 'CSFloat'), market('steam', 'Steam Market')));
}

function loadoutPanel(redraw, L) {
  if (!L) return null;
  const nm = (def, paint) => { const s = findSkin(def, paint); return s ? { t: `${s.weapon.name} | ${s.name}`, img: s.img } : { t: `оружие ${def}, скин ${paint}`, img: null }; };
  const cells = [];
  for (const x of L.skins) { const n = nm(x.def, x.paint); cells.push(h('div', { class: 'li', title: `${n.t}\nfloat ${x.wear ?? '—'}, паттерн ${x.seed ?? '—'}${x.nametag ? `, «${x.nametag}»` : ''}`, onclick: () => { const s = findSkin(x.def, x.paint); if (s) { K.sel = { skin: s }; initEdit(); Object.assign(E, { wear: x.wear ?? 0.01, seed: x.seed ?? 0, nametag: x.nametag, stattrak: !!x.stattrak, count: x.stattrakCount }); K.tab = s.weapon.cat; K.weapon = s.weapon.def; redraw(); } } },
    skinImg(n.img, n.t), h('div', {}, `${x.team === 2 ? 'T' : x.team === 3 ? 'CT' : ''} ${n.t.split(' | ')[0]}`))); }
  for (const k of L.knives) cells.push(h('div', { class: 'li', title: 'Нож: ' + k.knife }, h('b', {}, 'Нож'), h('div', {}, `${k.team === 2 ? 'T' : 'CT'} ${k.knife.replace('weapon_knife_', '').replace('weapon_', '')}`)));
  for (const g of L.gloves) { const w = K.weapons.find((x) => x.def === g.def); cells.push(h('div', { class: 'li', title: 'Перчатки' }, h('b', {}, 'Перчатки'), h('div', {}, `${g.team === 2 ? 'T' : 'CT'} ${w ? w.name : g.def}`))); }
  if (L.agents.ct) cells.push(h('div', { class: 'li' }, h('b', {}, 'Агент'), h('div', {}, 'CT')));
  if (L.agents.t) cells.push(h('div', { class: 'li' }, h('b', {}, 'Агент'), h('div', {}, 'T')));
  for (const m of L.music) { const mm = K.cat.music.find((x) => x.id === m.id); cells.push(h('div', { class: 'li', title: mm ? mm.name : '' }, h('b', {}, 'Музыка'), h('div', {}, mm ? mm.name.slice(0, 18) : `№${m.id}`))); }
  return h('div', { class: 'card' }, h('h3', {}, 'Сейчас надето'), cells.length ? h('div', { class: 'load' }, cells) : h('div', { class: 'muted small' }, 'Пока ничего — у игрока стандартные предметы.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: act(async () => { const r = await api('POST', '/skins/reload'); toast('Плагин скинов перезагружен' + (r.output ? '' : ''), 's'); }) }, 'Перезагрузить плагин'),
      h('button', { class: 'btn danger', onclick: act(async () => { if (!confirm('Снять ВСЕ скины, нож, перчатки, агентов и музыку у этого игрока?')) return; await applyOps([{ op: 'reset' }], 'Всё сброшено'); redraw(); }) }, 'Сбросить всё')));
}

// ---------------------------------------------------------------- свои скины
function customSkinForm(redraw) {
  const weapons = K.weapons.filter((w) => w.cat !== 'Custom');
  const wsel = h('select', {}, weapons.map((w) => h('option', { value: w.def }, `${w.name} (${w.def})`)));
  const paint = h('input', { type: 'number', min: 1, max: 99999, placeholder: 'Paint ID', style: 'width:110px' });
  const name = h('input', { type: 'text', placeholder: 'Название', maxlength: 40 });
  const img = h('input', { type: 'text', placeholder: 'Картинка (https://… steamstatic / raw.githubusercontent.com), необязательно', style: 'width:100%' });
  const list = (K.cat.custom || []);
  const save = (next) => act(async () => { const r = await api('PUT', '/custom-skins', { skins: next }); K.cat.custom = r.skins; K.items = null; skinItems(); redraw(); }, 'Сохранено');
  return h('div', { class: 'card' }, h('h3', {}, 'Свои скины (по Paint ID)'),
    h('div', { class: 'muted small' }, 'Если нужного скина нет в каталоге (новый кейс, коллекция, воркшоп), добавьте его по Paint ID: он появится на вкладке «Свои» и будет записываться в базу так же, как обычные. Работает для любого paint, который существует в игре у игрока. Кастомные текстуры из воркшопа сервер на клиентов не доставляет — игроки должны подписаться на них сами.'),
    h('div', { class: 'row' }, wsel, paint, name), h('div', { class: 'row' }, img),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: act(async () => {
      const w = weapons.find((x) => String(x.def) === wsel.value);
      if (!paint.value || !name.value.trim()) throw new Error('Укажите Paint ID и название');
      await save(list.concat([{ def: w.def, paint: Number(paint.value), name: name.value.trim(), img: img.value.trim(), weaponName: w.name, weaponId: w.id, kind: w.kind }]))();
    }) }, '＋ Добавить скин')),
    list.length ? h('div', { class: 'chips' }, list.map((s, i) => h('span', { class: 'chip', title: 'Удалить', onclick: save(list.filter((_x, j) => j !== i)) }, `${s.weaponName || s.def} | ${s.name} (#${s.paint}) `))) : null);
}
