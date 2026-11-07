'use strict';
// Консоль с автодополнением, карты и режимы с предпросмотром, настройки с разницей изменений.

// ---------------------------------------------------------------- общие функции
const cvarIndex = () => {
  const m = new Map();
  for (const g of (S.catalog && S.catalog.catalog) || []) for (const it of g.items) m.set(it.name, it);
  return m;
};
const cvarValues = (it) => (!it ? [] : it.type === 'bool' ? ['0', '1'] : it.type.startsWith('enum:') ? it.type.slice(5).split('|') : []);

function diffCvars(cur, next) {
  const rows = [];
  for (const [k, v] of Object.entries(next)) {
    if (!(k in cur)) rows.push({ k, from: null, to: v, kind: 'add' });
    else if (String(cur[k]) !== String(v)) rows.push({ k, from: cur[k], to: v, kind: 'chg' });
  }
  for (const [k, v] of Object.entries(cur)) if (!(k in next)) rows.push({ k, from: v, to: null, kind: 'del' });
  return rows.sort((a, b) => a.k.localeCompare(b.k));
}
function diffTable(rows) {
  if (!rows.length) return h('div', { class: 'muted' }, 'Различий нет — настройки уже совпадают.');
  const L = { add: ['добавится', 'diff-add'], chg: ['изменится', 'diff-chg'], del: ['будет убрано', 'diff-del'] };
  return h('table', {}, h('thead', {}, h('tr', {}, ['cvar', 'Сейчас', 'Станет', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { class: 'small', style: 'font-family:ui-monospace,monospace' }, r.k), h('td', { class: 'muted' }, r.from ?? '—'), h('td', {}, r.to ?? '—'), h('td', { class: `small ${L[r.kind][1]}` }, L[r.kind][0])))));
}

// ---------------------------------------------------------------- консоль
function pageConsole() {
  const idx = cvarIndex();
  const out = h('div', { class: 'console' });
  const hist = JSON.parse(sessionStorage.getItem('rconHist') || '[]'); let hi = hist.length;
  const input = h('input', { type: 'text', placeholder: 'Команда, например: status — начните вводить и жмите Tab', style: 'flex:1', spellcheck: 'false', autocomplete: 'off' });
  const pre = sessionStorage.getItem('rconPrefill'); if (pre) { input.value = pre; sessionStorage.removeItem('rconPrefill'); setTimeout(() => input.focus(), 0); }
  const syntax = h('div', { class: 'hint' }, 'Подсказка появится при вводе. ↑/↓ — история, Tab — автодополнение.');
  const print = (t, cls) => { out.append(h('div', { class: cls || '' }, t)); out.scrollTop = out.scrollHeight; };
  const run = async (cmd) => {
    cmd = cmd.trim(); if (!cmd) return;
    hist.push(cmd); sessionStorage.setItem('rconHist', JSON.stringify(hist.slice(-50))); hi = hist.length;
    print(`> ${cmd}`, 'cmd');
    try {
      const r = await api('POST', '/rcon', { command: cmd });
      const text = (r.output || '').trim() || '(пусто)';
      print(text, /unknown command|error|invalid/i.test(text) ? 'bad' : '');
    } catch (e) { print(e.message, 'bad'); }
  };
  const options = (text) => {
    const sp = text.indexOf(' ');
    if (sp < 0) return rank(COMMANDS.map(([n, d, a]) => ({ value: n, desc: d, args: a })), text).concat(rank([...idx.values()].filter((i) => !COMMANDS.some((c) => c[0] === i.name)).map((i) => ({ value: i.name, desc: i.hint })), text));
    const name = text.slice(0, sp); const rest = text.slice(sp + 1);
    const vals = cvarValues(idx.get(name));
    return vals.length ? rank(vals.map((v) => ({ value: `${name} ${v}`, label: `${name} ${v}`, desc: idx.get(name).hint })), `${name} ${rest}`) : [];
  };
  const upd = () => {
    const name = input.value.trim().split(/\s+/)[0]; const c = COMMANDS.find((x) => x[0] === name); const i = idx.get(name);
    syntax.textContent = c ? `${c[0]} ${tr(c[2] || '')} — ${tr(c[1])}` : i ? `${i.name} — ${tr(i.hint)}` : tr('Подсказка появится при вводе. ↑/↓ — история, Tab — автодополнение.');
  };
  const wrap = autocomplete(input, options, { limit: 9 });
  input.addEventListener('input', upd);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { run(input.value); input.value = ''; upd(); }
    if (e.key === 'ArrowUp' && hi > 0 && !input.parentNode.querySelector('.ac:not([hidden])')) { hi -= 1; input.value = hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown' && !input.parentNode.querySelector('.ac:not([hidden])')) { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; }
  });
  const groups = {
    'Игра': ['status', 'mp_restartgame 1', 'mp_warmup_end', 'mp_swapteams', 'exec sandbox/overrides.cfg'],
    'Боты': ['bot_add_ct', 'bot_add_t', 'bot_kick', 'bot_kill', 'bot_stop 1', 'bot_stop 0'],
    'Плагины': ['css_plugins list', 'meta list', 'css_plugins reload WeaponPaints', 'css_plugins reload MatchZy', 'css_players'],
    'Читы': ['sv_cheats 1', 'sv_cheats 0', 'sv_infinite_ammo 1', 'host_timescale 0.5', 'host_timescale 1'],
  };
  return h('div', {}, h('h2', {}, 'Консоль RCON'),
    !serverUp() ? h('div', { class: 'banner' }, 'Сервер CS2 сейчас не отвечает: включите ВМ и дождитесь запуска.') : null,
    out, h('div', { class: 'row' }, wrap, h('button', { class: 'btn primary', onclick: () => { run(input.value); input.value = ''; upd(); } }, 'Отправить')), syntax,
    Object.entries(groups).map(([t, list]) => h('div', { class: 'row' }, h('span', { class: 'muted small', style: 'width:70px' }, t), h('div', { class: 'chips' }, list.map((q) => h('span', { class: 'chip', onclick: () => run(q) }, q))))),
    h('div', { class: 'hint' }, 'Команды вроде noclip и god работают только из игрового клиента, через RCON они ничего не сделают.'));
}

// ---------------------------------------------------------------- карты и режимы
const mapHue = (id) => { let x = 0; for (const c of id) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const mapMonogram = (id) => id.replace(/^(de|cs|ar|dz)_/, '').slice(0, 3).toUpperCase();
const workshopId = (text) => { const m = /(?:[?&]id=)?(\d{6,12})/.exec(String(text)); return m ? m[1] : null; };

function pageMaps() {
  const st = S.state.state;
  const favs = new Set(store.get('favmaps', []));
  let filter = 'all'; let query = '';
  const live = S.ov && S.ov.server && S.ov.server.live && S.ov.server.live.map;
  const userBox = h('div'); const presetBox = h('div', { class: 'grid' }); const gridBox = h('div', { class: 'mapgrid' });
  const restart = h('input', { type: 'checkbox', checked: true });
  const startMap = h('select', {}, S.catalog.maps.concat(st.maps).map((m) => h('option', { value: m.id, selected: m.id === st.server.map }, `${m.label} (${m.id})`)));
  let userPresets = {};

  // ---- режимы
  const applyPreset = async (key, preset, builtin) => {
    const rows = diffCvars(st.cvars, preset.cvars || {});
    const live2 = h('input', { type: 'checkbox', checked: !builtin }); const rs = h('input', { type: 'checkbox', checked: restart.checked });
    modal(`Предпросмотр режима «${preset.label}»`, h('div', {},
      h('p', { class: 'muted' }, `game_type ${preset.gameType} / game_mode ${preset.gameMode}. ${preset.note || ''}`),
      h('p', { class: 'muted small' }, 'Все текущие cvar заменяются набором режима. Вот что изменится:'), diffTable(rows),
      h('div', { class: 'row' }, h('label', { class: 'switch' }, rs, 'Перезапустить CS2 (чистое применение, ~1 минута)')),
      !builtin ? h('div', { class: 'row' }, h('label', { class: 'switch' }, live2, 'Применить сразу без перезапуска')) : null),
    [{ text: 'Применить режим', kind: 'primary', run: async () => {
      if (builtin) await api('POST', '/preset', { preset: key, map: startMap.value, restart: rs.checked });
      else {
        S.state = await api('PUT', '/state', { state: { server: { preset: 'custom', gameType: preset.gameType, gameMode: preset.gameMode, map: startMap.value }, cvars: preset.cvars } });
        if (rs.checked) await api('POST', '/service/restart'); else if (live2.checked) await api('POST', '/apply-live');
      }
      S.state = await api('GET', '/state'); toast('Режим применён', 's'); renderPage();
    } }, { text: 'Отмена', run: () => true }]);
  };
  const drawPresets = () => {
    const card = (k, p, builtin) => h('div', { class: `btn preset ${st.server.preset === k ? 'on' : ''}`, style: 'cursor:default' },
      h('b', {}, p.label), h('span', { class: 'muted small' }, p.note || `game_type ${p.gameType} / game_mode ${p.gameMode}`),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => applyPreset(k, p, builtin) }, 'Предпросмотр и применение'),
        !builtin ? h('button', { class: 'btn danger', title: 'Удалить свой пресет', onclick: act(async () => { if (!confirm(`Удалить пресет «${p.label}»?`)) return; const next = { ...userPresets }; delete next[k]; userPresets = (await api('PUT', '/user-presets', { presets: next })).presets; drawPresets(); }) }, 'Удалить') : null));
    presetBox.replaceChildren(...Object.entries(S.catalog.presets).map(([k, p]) => card(k, p, true)), ...Object.entries(userPresets).map(([k, p]) => card(k, p, false)));
  };
  const nameIn = h('input', { type: 'text', placeholder: 'Название своего пресета', maxlength: 40 });
  const saveCurrent = act(async () => {
    const label = nameIn.value.trim(); if (!label) throw new Error('Введите название пресета');
    const id = (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `p${Date.now() % 100000}`).slice(0, 24);
    userPresets = (await api('PUT', '/user-presets', { presets: { ...userPresets, [id]: { label, note: 'Свой пресет', gameType: st.server.gameType, gameMode: st.server.gameMode, cvars: st.cvars } } })).presets;
    nameIn.value = ''; drawPresets();
  }, 'Пресет сохранён');
  setTimeout(async () => { try { userPresets = (await api('GET', '/user-presets')).presets; } catch { /* нет доступа */ } drawPresets(); }, 0);

  // ---- карты
  const wsOf = (id) => (S.catalog.workshop || []).find((w) => w.id === id);
  const metaOf = (m) => (wsOf(m.id) ? ['workshop', wsOf(m.id).note] : null) || MAP_META[m.id] || [/^\d+$/.test(m.id) ? 'workshop' : 'other', /^\d+$/.test(m.id) ? 'Воркшоп-карта' : ''];
  const allMaps = () => S.catalog.maps.concat(st.maps.filter((m) => !S.catalog.maps.some((x) => x.id === m.id)));
  const drawMaps = () => {
    const list = allMaps().filter((m) => {
      const k = metaOf(m)[0];
      if (filter === 'fav' && !favs.has(m.id)) return false;
      if (filter !== 'all' && filter !== 'fav' && k !== filter) return false;
      return !query || `${m.label} ${m.id}`.toLowerCase().includes(query);
    });
    gridBox.replaceChildren(...(list.length ? list.map((m) => {
      const [kind, note] = metaOf(m); const hue = mapHue(m.id);
      return h('div', { class: `mapcard ${live === m.id ? 'live' : ''} ${st.server.map === m.id ? 'start' : ''}` },
        h('div', { class: `mapart ${m.img ? 'has-img' : ''}`, style: `background:linear-gradient(135deg,hsl(${hue} 55% 32%),hsl(${(hue + 50) % 360} 60% 18%))` }, m.img ? h('img', { class: 'mapimg', src: m.img, alt: m.label, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.remove(); } }) : h('span', {}, mapMonogram(m.id)), h('button', { class: `fav ${favs.has(m.id) ? 'on' : ''}`, title: 'В избранное', onclick: () => { favs.has(m.id) ? favs.delete(m.id) : favs.add(m.id); store.set('favmaps', [...favs]); drawMaps(); } }, favs.has(m.id) ? '★' : '☆')),
        h('div', { class: 'mapbody' }, h('b', {}, m.label), h('div', { class: 'muted small' }, note || m.id),
          h('div', { class: 'row' }, h('span', { class: 'tag' }, { bomb: 'бомба', hostage: 'заложники', workshop: 'воркшоп', other: 'прочее' }[kind]), live === m.id ? h('span', { class: 'tag okc' }, 'сейчас') : null, st.server.map === m.id ? h('span', { class: 'tag', style: 'color:var(--accent)' }, 'при старте') : null),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: act(() => api('POST', '/map', { map: m.id }), `Загружаю ${m.id}`) }, '▶ Играть'),
            h('button', { class: 'btn', title: 'Сделать картой при запуске сервера', onclick: act(async () => { S.state = await api('PUT', '/state', { state: { server: { map: m.id } } }); renderPage(); }, 'Карта при старте обновлена') }, 'Сделать стартовой'),
            st.maps.some((x) => x.id === m.id) ? h('button', { class: 'btn danger', title: 'Убрать из списка', onclick: act(async () => { S.state = await api('PUT', '/state', { state: { maps: st.maps.filter((x) => x.id !== m.id) } }); renderPage(); }) }, 'Убрать') : null)));
    }) : [h('div', { class: 'muted' }, 'Ничего не найдено.')]));
  };
  const search = h('input', { type: 'text', placeholder: 'Поиск карты (Dust, mirage, ID воркшопа…)', style: 'width:300px' });
  const searchW = autocomplete(search, (t) => rank(allMaps().map((m) => ({ value: m.id, label: `${m.label} — ${m.id}`, desc: (metaOf(m)[1] || '') })), t, (o) => `${o.value} ${o.label}`), { onPick: (o) => { query = o.value; drawMaps(); } });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); drawMaps(); });
  const tabs = h('div', { class: 'tabs' });
  const drawTabs = () => tabs.replaceChildren(...[['all', 'Все'], ['bomb', 'Бомба'], ['hostage', 'Заложники'], ['workshop', 'Воркшоп'], ['fav', 'Избранные']].map(([k, t]) => h('button', { class: filter === k ? 'on' : '', onclick: () => { filter = k; drawTabs(); drawMaps(); } }, t)));
  drawTabs(); drawMaps();

  // ---- каталог воркшоп-карт для тренировки
  let wsCat = 'all'; const wsBox = h('div', { class: 'mapgrid' }); const wsTabs = h('div', { class: 'tabs' });
  const wsCats = S.catalog.workshopCats || {};
  const drawWs = () => {
    wsTabs.replaceChildren(...[['all', 'Все'], ...Object.entries(wsCats)].map(([k, t]) => h('button', { class: wsCat === k ? 'on' : '', onclick: () => { wsCat = k; drawWs(); } }, t)));
    wsBox.replaceChildren(...(S.catalog.workshop || []).filter((w) => wsCat === 'all' || w.cat === wsCat).map((w) => {
      const hue = mapHue(w.id); const added = st.maps.some((x) => x.id === w.id);
      return h('div', { class: `mapcard ${live === w.id ? 'live' : ''}` },
        h('div', { class: 'mapart', style: `background:linear-gradient(135deg,hsl(${hue} 55% 32%),hsl(${(hue + 50) % 360} 60% 18%))` }, h('span', {}, w.label.replace(/[^A-Za-zА-Яа-я0-9]/g, '').slice(0, 3).toUpperCase())),
        h('div', { class: 'mapbody' }, h('b', {}, w.label), h('div', { class: 'muted small' }, w.note), h('div', { class: 'row' }, h('span', { class: 'tag' }, wsCats[w.cat] || w.cat), h('a', { class: 'small', href: `https://steamcommunity.com/sharedfiles/filedetails/?id=${w.id}`, target: '_blank', rel: 'noopener noreferrer' }, 'Воркшоп ↗')),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: act(() => api('POST', '/map', { map: w.id }), `Загружаю ${w.label}`) }, '▶ Играть'),
            h('button', { class: 'btn', disabled: added, onclick: act(async () => { S.state = await api('PUT', '/state', { state: { maps: st.maps.filter((m) => m.id !== w.id).concat([{ id: w.id, label: w.label }]) } }); renderPage(); }, 'Добавлено в список') }, added ? 'В списке' : '＋ В список'))));
    }));
  };
  drawWs();
  const addAllWs = act(async () => { const have = new Set(st.maps.map((m) => m.id)); const add = (S.catalog.workshop || []).filter((w) => !have.has(w.id)).map((w) => ({ id: w.id, label: w.label })); if (!add.length) return; S.state = await api('PUT', '/state', { state: { maps: st.maps.concat(add) } }); renderPage(); }, 'Все карты добавлены в список');

  // ---- воркшоп / своя карта
  const custom = h('input', { type: 'text', placeholder: 'de_xxx, ID или ссылка на воркшоп', style: 'width:300px' });
  const label = h('input', { type: 'text', placeholder: 'Название (необязательно)', style: 'width:220px' });
  const parseCustom = () => { const v = custom.value.trim(); const w = /steamcommunity|^\d{6,}$/.test(v) ? workshopId(v) : null; return w || v; };
  return h('div', {}, h('h2', {}, 'Карты и режимы'),
    h('div', { class: 'card' }, h('h3', {}, 'Режимы игры'),
      h('div', { class: 'row' }, 'Карта при старте:', startMap, h('label', { class: 'switch' }, restart, 'сразу перезапускать CS2 при смене режима')),
      presetBox,
      h('div', { class: 'row' }, nameIn, h('button', { class: 'btn', onclick: saveCurrent }, 'Сохранить текущие настройки как пресет')),
      h('div', { class: 'muted small' }, `Сейчас: пресет «${st.server.preset}», game_type ${st.server.gameType} / game_mode ${st.server.gameMode}, карта ${st.server.map}. Свои пресеты хранятся на панели и доступны всем админам.`)),
    h('div', { class: 'card' }, h('h3', {}, 'Воркшоп-карты для тренировки'), h('div', { class: 'row' }, wsTabs, h('button', { class: 'btn', onclick: addAllWs }, '＋ Добавить все в список')), wsBox,
      h('div', { class: 'muted small' }, 'Подборка карт для аима, раскидок, дуэлей и движения. Для скачивания воркшоп-карт нужен Steam Web API ключ на сервере (-authkey); первая загрузка карты занимает время.')),
    h('div', { class: 'card' }, h('h3', {}, 'Карты'), h('div', { class: 'row' }, searchW, tabs), gridBox,
      h('h3', { style: 'margin-top:16px' }, 'Добавить свою или воркшоп-карту'),
      h('div', { class: 'row' }, custom, label,
        h('button', { class: 'btn', onclick: act(() => api('POST', '/map', { map: parseCustom() }), 'Карта загружается') }, '▶ Загрузить'),
        h('button', { class: 'btn', onclick: act(async () => { const id = parseCustom(); if (!id) return; S.state = await api('PUT', '/state', { state: { maps: st.maps.filter((m) => m.id !== id).concat([{ id, label: label.value.trim() || id }]) } }); renderPage(); }, 'Добавлено в список') }, '＋ В список')),
      h('div', { class: 'muted small' }, 'Вставьте ссылку на страницу воркшопа — ID вытащится сам. Для воркшопа нужен Steam Web API ключ в секретах (-authkey), иначе скачивание не сработает.')));
}

// ---------------------------------------------------------------- настройки
function pageSettings() {
  const st = S.state.state;
  const idx = cvarIndex();
  const inputs = {}; let filterText = '';
  const sv = {
    hostname: h('input', { type: 'text', value: st.server.hostname, maxlength: 64 }),
    maxPlayers: h('input', { type: 'number', value: st.server.maxPlayers, min: 2, max: 64 }),
    password: h('input', { type: 'text', value: st.server.password, placeholder: 'пусто = без пароля' }),
    extraArgs: h('input', { type: 'text', value: st.server.extraArgs, placeholder: 'доп. аргументы запуска', style: 'width:100%' }),
  };
  const bar = h('div', { class: 'sticky-bar', hidden: true });
  const collect = () => { const cv = {}; for (const [k, el] of Object.entries(inputs)) if (el.value !== '') cv[k] = el.value; if (rawName.value.trim() && rawVal.value !== '') cv[rawName.value.trim()] = rawVal.value; return cv; };
  const serverDiff = () => ['hostname', 'maxPlayers', 'password', 'extraArgs'].filter((k) => String(sv[k].value) !== String(st.server[k])).map((k) => ({ k: `server.${k}`, from: st.server[k], to: sv[k].value, kind: 'chg' }));
  const allDiff = () => serverDiff().concat(diffCvars(st.cvars, collect()));
  const refresh = () => {
    const d = allDiff();
    bar.hidden = !d.length;
    if (!d.length) return;
    bar.replaceChildren(h('div', { class: 'row' }, h('b', {}, `Несохранённых изменений: ${d.length}`), h('button', { class: 'btn', onclick: () => modal('Что изменится', diffTable(d)) }, 'Показать'),
      h('button', { class: 'btn', onclick: () => modal('Предпросмотр overrides.cfg', h('pre', { class: 'console', style: 'height:auto;max-height:50vh' }, Object.entries(collect()).map(([k, v]) => `${k} "${v}"`).join('\n') || '(пусто)')) }, 'overrides.cfg'),
      h('button', { class: 'btn primary', onclick: act(() => save(true), 'Сохранено и применено') }, 'Сохранить и применить сейчас'),
      h('button', { class: 'btn', onclick: act(() => save(false), 'Сохранено (применится при следующем старте карты)') }, 'Только сохранить'),
      h('button', { class: 'btn danger', onclick: () => renderPage() }, 'Отменить')));
  };
  const field = (it) => {
    const cur = st.cvars[it.name];
    let el;
    if (it.type === 'bool') el = h('select', {}, ['', '0', '1'].map((v) => h('option', { value: v, selected: (cur ?? '') === v }, v === '' ? '— по умолчанию' : v === '1' ? 'вкл (1)' : 'выкл (0)')));
    else if (it.type.startsWith('enum:')) el = h('select', {}, [''].concat(it.type.slice(5).split('|')).map((v) => h('option', { value: v, selected: (cur ?? '') === v }, v === '' ? '— по умолчанию' : v)));
    else el = h('input', { type: 'text', value: cur ?? '', placeholder: 'по умолчанию' });
    el.addEventListener('input', refresh); el.addEventListener('change', refresh);
    inputs[it.name] = el;
    return h('div', { class: 'cvrow', 'data-name': it.name, style: 'display:contents' }, h('label', {}, it.name, h('small', {}, it.hint)), el);
  };
  const catalogNames = new Set(S.catalog.catalog.flatMap((g) => g.items.map((i) => i.name)));
  const extra = Object.entries(st.cvars).filter(([k]) => !catalogNames.has(k));
  const rawName = h('input', { type: 'text', placeholder: 'имя cvar' }); const rawVal = h('input', { type: 'text', placeholder: 'значение' });
  const rawNameW = autocomplete(rawName, (t) => rank(COMMANDS.filter((c) => !/ /.test(c[0])).map(([n, d]) => ({ value: n, desc: d })), t), { onPick: (o) => { const v = cvarValues(idx.get(o.value)); rawVal.placeholder = v.length ? `значение: ${v.join(' | ')}` : 'значение'; rawVal.focus(); } });
  rawName.addEventListener('input', refresh); rawVal.addEventListener('input', refresh);
  const extraBox = h('div', { class: 'cv' }, extra.map(([k, v]) => { const el = (inputs[k] = h('input', { type: 'text', value: v })); el.addEventListener('input', refresh); return [h('label', {}, k), el]; }));
  const save = async (live) => {
    S.state = await api('PUT', '/state', { state: { server: { hostname: sv.hostname.value, maxPlayers: Number(sv.maxPlayers.value), password: sv.password.value, extraArgs: sv.extraArgs.value, preset: 'custom' }, cvars: collect() } });
    if (live) { const r = await api('POST', '/apply-live'); const errs = r.results.filter((x) => /unknown|error/i.test(x.output)); if (errs.length) toast(`Не приняты: ${errs.map((e) => e.cmd.split(' ')[0]).join(', ')}`, 'e'); }
    renderPage();
  };
  Object.values(sv).forEach((el) => el.addEventListener('input', refresh));
  const groups = S.catalog.catalog.map((g) => h('div', { class: 'card', 'data-group': g.group }, h('h3', {}, g.group), h('div', { class: 'cv' }, g.items.map(field))));
  const find = h('input', { type: 'text', placeholder: 'Найти настройку: roundtime, bot, gravity…', style: 'width:320px' });
  find.addEventListener('input', () => {
    filterText = find.value.trim().toLowerCase();
    for (const g of groups) {
      let any = false;
      const kids = [...g.querySelectorAll('.cvrow')];
      kids.forEach((r) => { const it = idx.get(r.dataset.name); const ok = !filterText || `${it.name} ${it.hint}`.toLowerCase().includes(filterText); r.style.display = ok ? 'contents' : 'none'; const lab = r.querySelector('label'); const sel = r.lastChild; lab.style.display = ok ? '' : 'none'; sel.style.display = ok ? '' : 'none'; if (ok) any = true; });
      g.style.display = any ? '' : 'none';
    }
  });
  return h('div', {}, h('h2', {}, 'Настройки сервера'),
    h('div', { class: 'row' }, find, h('span', { class: 'muted small' }, 'Изменения подсвечиваются внизу — можно посмотреть разницу перед сохранением.')),
    h('div', { class: 'card' }, h('h3', {}, 'Сервер'),
      h('dl', { class: 'kv' }, h('dt', {}, 'Имя'), h('dd', {}, sv.hostname), h('dt', {}, 'Слотов'), h('dd', {}, sv.maxPlayers), h('dt', {}, 'Пароль входа'), h('dd', {}, sv.password), h('dt', {}, 'Доп. аргументы'), h('dd', {}, sv.extraArgs)),
      h('div', { class: 'muted small' }, 'Имя, слоты и аргументы применяются после перезапуска CS2.')),
    groups,
    extra.length ? h('div', { class: 'card' }, h('h3', {}, 'Свои cvar'), extraBox) : null,
    h('div', { class: 'card' }, h('h3', {}, 'Добавить cvar'), h('div', { class: 'row' }, rawNameW, rawVal), h('div', { class: 'hint' }, 'Начните вводить имя — подскажу cvar и допустимые значения.')),
    h('div', { class: 'muted small' }, 'Пустое поле = cvar не переопределяется. Настройки хранятся на диске данных и восстанавливаются при каждом запуске.'),
    bar);
}
