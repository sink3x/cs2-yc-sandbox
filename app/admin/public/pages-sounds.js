'use strict';
// Звуки: библиотека имён → путь звука, воспроизведение игрокам командой css_playsound (плагин CS2Panel).
// Играют только звуки, которые уже есть у клиента (встроенные в игру или из аддона). Свой аудиофайл на клиенты
// сервер доставить не может: для этого нужен Workshop-аддон, подключённый к серверу.

const SND_PATH_RE = /^[A-Za-z0-9_./-]{1,160}$/;
const sndSlug = (path, taken) => {
  const base = (path.split('/').pop() || 'sound').replace(/\.[A-Za-z0-9]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'sound';
  let id = base; let n = 2;
  while (taken.has(id)) id = `${base.slice(0, 28)}-${n++}`;
  return id;
};

// «Свои аудиофайлы» — остров на Preact + TypeScript (web/src/pages/SoundFiles.tsx), собирается в /ui/main.js.

// ---------------------------------------------------------------- прослушивание в браузере: свои файлы, музыка, звуки игры
const SB = { tab: store.get('sndTab', 'files'), files: null, kits: null, kit: null, kitQ: '', q: '', dir: '', res: null, busy: false, err: '' };
const gameSrc = (path, title) => ({ key: `game/${path}`, url: `/api/game-sound?path=${encodeURIComponent(path)}`, title: title || path.split('/').pop().replace(/\.vsnd_c$/, ''), sub: path.replace(/^sounds\//, '').split('/').slice(0, -1).join('/'), hint: 'Игровая ВМ выключена, или это имя события, а не путь к файлу' });
const fileSrc = (name) => ({ key: `file/${name}`, url: `/api/sound-files/${encodeURIComponent(name)}`, title: name, sub: tr('свой файл') });
const sbRow = (src, title, sub, extra) => {
  const el = h('div', { class: 'snd-row' }, AudioHub.buttons(src), h('div', { class: 'snd-name' }, h('b', {}, document.createTextNode(title)), sub ? h('span', { class: 'muted small' }, document.createTextNode(sub)) : null), extra || null);
  let seen = false;
  AudioHub.onChange(() => { if (el.isConnected) { seen = true; el.classList.toggle('on', AudioHub.isPlaying(src.key)); return true; } return !seen; });
  return el;
};

/** Карточка «Прослушать здесь». tabs — какие вкладки показать; toPlayers(sound) — кнопка «Игрокам» у звуков библиотеки. */
function soundBrowser({ tabs = ['files', 'music', 'game'], toPlayers = null } = {}) {
  const root = h('div', { class: 'card snd-browser' });
  const TABS = { library: 'Библиотека', files: 'Свои файлы', music: 'Музыка', game: 'Звуки игры' };
  if (!tabs.includes(SB.tab)) SB.tab = tabs[0];
  const draw = () => put(root, view());
  let searchTimer = 0;
  const search = (more) => {
    SB.busy = true; SB.err = ''; const q = SB.q; const dir = SB.dir; const offset = more && SB.res ? SB.res.items.length : 0;
    api('GET', `/game-sounds?q=${encodeURIComponent(q)}&dir=${encodeURIComponent(dir)}&offset=${offset}`).then((r) => {
      if (q !== SB.q || dir !== SB.dir) return;
      SB.res = more && SB.res ? { ...r, items: [...SB.res.items, ...r.items] } : r;
    }).catch((e) => { SB.err = e.message; }).finally(() => { SB.busy = false; if (root.isConnected) drawBody(); });
  };
  let body = h('div', {});
  const drawBody = () => { const next = bodyView(); body.replaceWith(next); body = next; };

  function bodyView() {
    if (SB.tab === 'library') {
      const list = (S.state && S.state.state && S.state.state.sounds) || [];
      return h('div', { class: 'snd-list' }, list.length ? list.map((x) => sbRow(gameSrc(x.play, x.title), x.title, `${x.id} · ${x.play}`, toPlayers ? h('button', { class: 'btn', disabled: !serverUp(), title: 'Проиграть всем игрокам на сервере', onclick: toPlayers(x.id) }, '📢 Игрокам') : null))
        : h('div', { class: 'muted' }, 'Библиотека пуста: добавьте звуки на странице «Звуки».'));
    }
    if (SB.tab === 'files') {
      if (!SB.files) { api('GET', '/sound-files').then((r) => { SB.files = r.files || []; }).catch(() => { SB.files = []; }).finally(() => { if (root.isConnected) drawBody(); }); return h('div', { class: 'muted' }, 'Загрузка…'); }
      if (!SB.files.length) return h('div', { class: 'muted' }, 'Своих файлов пока нет: загрузите их на странице «Звуки».');
      const srcs = SB.files.map((f) => fileSrc(f.name));
      return h('div', {}, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => AudioHub.enqueue(srcs, { replace: true }) }, '▶ Все подряд'),
        h('button', { class: 'btn', title: 'Обновить список', onclick: () => { SB.files = null; drawBody(); } }, '↻ Обновить')),
        h('div', { class: 'snd-list' }, SB.files.map((f, i) => sbRow(srcs[i], f.name, `${Math.max(1, Math.round(f.size / 1024))} KB`))));
    }
    if (SB.tab === 'music') {
      if (!SB.kits) { api('GET', '/skins/catalog').then((c) => { SB.kits = c.music || []; SB.imgBase = c.imgBase || ''; }).catch((e) => { SB.kits = []; SB.err = e.message; }).finally(() => { if (root.isConnected) drawBody(); }); return h('div', { class: 'muted' }, 'Загрузка…'); }
      if (!SB.kits.length) return h('div', { class: 'warn small' }, 'Каталог музыкальных наборов недоступен.');
      const q = h('input', { type: 'text', inputmode: 'search', placeholder: 'Поиск набора', 'aria-label': 'Поиск набора', value: SB.kitQ, style: 'min-width:220px' });
      const grid = h('div', { class: 'snd-kits' });
      const fill = () => {
        const w = SB.kitQ.trim().toLowerCase();
        const list = SB.kits.filter((m) => !w || m.name.toLowerCase().includes(w));
        put(grid, list.slice(0, 60).map((m) => h('button', { class: `btn snd-kit${SB.kit && SB.kit.id === m.id ? ' on' : ''}`, onclick: () => { SB.kit = m; drawBody(); } },
          m.img ? h('img', { src: /^https?:/.test(m.img) ? m.img : SB.imgBase + m.img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.display = 'none'; } }) : null, h('span', {}, document.createTextNode(m.name)))),
        list.length > 60 ? h('span', { class: 'muted small' }, `… ${tr('и ещё')} ${list.length - 60}`) : null, !list.length ? h('span', { class: 'muted' }, 'Ничего не найдено') : null);
      };
      q.addEventListener('input', () => { SB.kitQ = q.value; fill(); }); fill();
      return h('div', {}, h('div', { class: 'row' }, q, h('span', { class: 'muted small' }, `${tr('Наборов')}: ${SB.kits.length}`)), grid,
        SB.kit ? h('div', { class: 'snd-kitbox' }, h('h4', {}, document.createTextNode(SB.kit.name)), musicPlayer(SB.kit)) : h('div', { class: 'hint' }, 'Выберите набор, чтобы увидеть его треки.'));
    }
    // звуки игры
    const q = h('input', { type: 'text', inputmode: 'search', placeholder: 'Например: ak47, bomb, door, radio', 'aria-label': 'Поиск звука', value: SB.q, style: 'min-width:260px' });
    q.addEventListener('input', () => { SB.q = q.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => search(false), 350); });
    if (!SB.res && !SB.busy && !SB.err) search(false);
    const r = SB.res;
    const dirs = r && r.dirs ? r.dirs.slice(0, 14) : [];
    const node = h('div', {}, h('div', { class: 'row' }, q, r ? h('span', { class: 'muted small' }, `${tr('Найдено')}: ${r.total} ${tr('из')} ${r.all}`) : null),
      dirs.length ? h('div', { class: 'row snd-dirs' }, h('button', { class: `chip${SB.dir ? '' : ' on'}`, onclick: () => { SB.dir = ''; SB.res = null; drawBody(); } }, 'Все'),
        dirs.map((d) => h('button', { class: `chip${SB.dir === d.dir ? ' on' : ''}`, onclick: () => { SB.dir = d.dir; SB.res = null; drawBody(); } }, document.createTextNode(d.dir)))) : null,
      SB.err ? h('div', {}, h('div', { class: 'warn small' }, `${tr('Звуки игры недоступны')}: ${SB.err}`), h('div', { class: 'hint' }, 'Список звуков читается из файлов игры на игровой ВМ: включите её. Первый поиск после обновления игры занимает до минуты.'),
        h('button', { class: 'btn', onclick: () => { SB.err = ''; drawBody(); } }, 'Повторить')) : null,
      !r && SB.busy ? h('div', { class: 'muted' }, 'Читаю список звуков игры… В первый раз до минуты.') : null,
      r && !r.items.length ? h('div', { class: 'muted' }, 'Ничего не найдено') : null,
      r && r.items.length ? h('div', { class: 'snd-list' }, r.items.map((p) => { const src = gameSrc(p); return sbRow(src, src.title, p.replace(/^sounds\//, '').replace(/\.vsnd_c$/, ''),
        h('button', { class: 'btn', title: 'Скопировать путь для команды play и библиотеки', onclick: copy(p.replace(/\.vsnd_c$/, '.vsnd')) }, 'Путь')); })) : null,
      r && r.items.length < r.total ? h('div', { class: 'row' }, h('button', { class: 'btn', disabled: SB.busy, onclick: () => search(true) }, 'Показать ещё')) : null);
    if (document.activeElement && document.activeElement.getAttribute('aria-label') === tr('Поиск звука')) setTimeout(() => { q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
    return node;
  }
  function view() {
    body = bodyView();
    return [h('h3', {}, 'Прослушать здесь'),
      h('p', { class: 'muted small' }, 'Звук играет только в вашем браузере: игроки на сервере его не слышат. ▶ играет по выбранному режиму, ＋ добавляет в очередь. Плеер внизу экрана остаётся при переходе между страницами.'),
      h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Режим кнопки ▶:'), AudioHub.modeSwitch(), h('button', { class: 'btn', onclick: () => AudioHub.stopAll() }, '■ Стоп всё')),
      h('div', { class: 'tabs snd-tabs', role: 'tablist' }, tabs.map((t) => h('button', { class: SB.tab === t ? 'on' : '', role: 'tab', 'aria-selected': String(SB.tab === t), onclick: () => { SB.tab = t; store.set('sndTab', t); draw(); } }, TABS[t]))),
      body];
  }
  let seen = false;
  AudioHub.onChange(() => { if (root.isConnected) { seen = true; const sw = root.querySelector('.ad-mode'); if (sw) sw.replaceWith(AudioHub.modeSwitch()); return true; } return !seen; });
  draw();
  return root;
}

function pageSounds() {
  const st = S.state.state;
  const list = st.sounds || [];
  const target = h('input', { type: 'text', value: 'all', placeholder: 'all, #номер или часть ника', 'aria-label': 'Кому играть', style: 'width:190px' });
  const title = h('input', { type: 'text', placeholder: 'Название (необязательно)', maxlength: '48', 'aria-label': 'Название' });
  const path = h('input', { type: 'text', placeholder: 'Путь звука (как в команде play)', maxlength: '160', style: 'min-width:280px', 'aria-label': 'Путь звука' });

  const save = (next) => api('PUT', '/state', { state: { sounds: next } }).then((r) => { S.state = r; renderPage(); });
  const play = (sound) => act(async () => {
    const t = target.value.trim() || 'all';
    if (!/^(all|#\d{1,5}|[A-Za-z0-9_.-]{1,32})$/.test(t)) throw new Error(tr('Кому играть: all, #номер игрока или часть ника без пробелов'));
    await api('POST', '/sounds/play', { sound, target: t });
  }, 'Команда отправлена');
  const add = act(async () => {
    const p = path.value.trim();
    if (!SND_PATH_RE.test(p)) throw new Error(tr('Путь звука: латиница, цифры и символы _ . / - без пробелов'));
    const id = sndSlug(p, new Set(list.map((x) => x.id)));
    await save([...list, { id, title: (title.value.trim() || id).slice(0, 48), play: p }]);
    toast(tr('Звук добавлен'), 's');
  });

  return h('div', {},
    h('h2', {}, 'Звуки'),
    st.plugins && st.plugins.cs2panel === false ? h('div', { class: 'banner' }, 'Плагин CS2Panel выключен: включите его в «Плагины и флаги», иначе звуки играть не будут.') : null,
    h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'Звук проигрывается игрокам командой css_playsound (CounterStrikeSharp, плагин CS2Panel). Играют только звуки, которые уже есть у клиента: встроенные в игру или из аддона. Свой аудиофайл сервер на клиенты доставить не может: для этого нужен Workshop-аддон.'),
      h('p', { class: 'muted small' }, 'Проверить путь можно в консоли своего клиента командой play <путь>. В игре тоже работает: !playsound <имя> [all|ник] (нужны права админа).')),
    soundBrowser({ tabs: ['files', 'music', 'game'] }),
    island('sound-files'),
    h('div', { class: 'card' },
      h('h3', {}, 'Библиотека'),
      h('div', { class: 'row' }, h('label', { class: 'muted' }, 'Кому'), target),
      list.length ? h('div', { class: 'snd-list' }, list.map((x) => h('div', { class: 'snd-row' },
        h('div', { class: 'snd-name' }, h('b', {}, document.createTextNode(x.title)), h('span', { class: 'muted small' }, document.createTextNode(`${x.id} · ${x.play}`))),
        AudioHub.buttons(gameSrc(x.play, x.title)),
        h('button', { class: 'btn', title: 'Проиграть игрокам на сервере', onclick: play(x.id) }, '📢 Игрокам'),
        h('button', { class: 'btn danger', title: 'Убрать из библиотеки', onclick: act(async () => { await save(list.filter((y) => y.id !== x.id)); toast(tr('Звук убран'), 's'); }) }, 'Убрать'))))
        : h('div', { class: 'muted' }, 'Библиотека пуста. Добавьте первый звук ниже.')),
    h('div', { class: 'card' },
      h('h3', {}, 'Добавить звук'),
      h('div', { class: 'row' }, path, title, h('button', { class: 'btn primary', onclick: add }, 'Добавить')),
      h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Одноразово, без сохранения в библиотеку:'), h('button', { class: 'btn', onclick: act(async () => {
        const p = path.value.trim(); if (!SND_PATH_RE.test(p)) throw new Error(tr('Путь звука: латиница, цифры и символы _ . / - без пробелов'));
        await play(p)({ currentTarget: null });
      }) }, 'Проиграть по пути'))));
}
