'use strict';
// Тренировка, боты, приколы и зомби-режимы; оформление; справка.

const PR = { values: {}, loaded: false };
const prSend = async (action, args = {}) => {
  const r = await api('POST', '/practice', { action, ...args });
  const bad = (r.outputs || []).filter((o) => /unknown command|unknown cvar|can't find/i.test(o));
  if (bad.length) toast(`Часть команд не принята сервером: ${bad.length}. Возможно, cvar нет в этой версии CS2.`, 'e');
  return r;
};
const prRead = async () => { try { PR.values = (await api('POST', '/practice/read')).values; PR.loaded = true; } catch { PR.loaded = false; } };

function pagePractice() {
  const root = h('div', {});
  const draw = () => root.replaceChildren(practiceView(draw));
  draw();
  if (serverUp()) prRead().then(draw);
  return root;
}

function practiceView(redraw) {
  const live = serverUp(); const up = S.ov && S.ov.server && S.ov.server.live;
  const set = (pairs) => act(async () => { await prSend('cvars', { pairs }); await prRead(); redraw(); });
  const val = (c) => PR.values[c];

  // ---- переключатели
  const control = (t) => {
    const v = val(t.cvar);
    if (t.type === 'bool') { const cb = h('input', { type: 'checkbox', checked: v === '1', disabled: !live }); cb.addEventListener('change', () => set({ [t.cvar]: cb.checked ? '1' : '0' })()); return h('label', { class: 'switch' }, cb, v === undefined ? '…' : v === '1' ? 'вкл' : 'выкл'); }
    if (t.type === 'enum') return h('div', { class: 'seg' }, t.options.map((o) => h('button', { class: v === o ? 'on' : '', disabled: !live, onclick: set({ [t.cvar]: o }) }, o)));
    const num = h('span', { class: 'small muted', style: 'width:46px;display:inline-block' }, v ?? '…');
    const r = h('input', { type: 'range', min: t.min, max: t.max, step: t.step, value: v ?? t.min, disabled: !live });
    r.addEventListener('input', () => { num.textContent = r.value; }); r.addEventListener('change', () => set({ [t.cvar]: r.value })());
    return h('div', { class: 'row', style: 'margin:0' }, r, num);
  };
  const byGroup = {}; for (const t of S.catalog.toggles) (byGroup[t.group] ||= []).push(t);

  // ---- боты
  let cnt = 1;
  const cntSel = h('div', { class: 'seg' }, [1, 3, 5, 10].map((n) => h('button', { class: n === cnt ? 'on' : '', onclick: (e) => { cnt = n; [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, `×${n}`)));
  const botBtn = (text, action, args, kind = '') => h('button', { class: `btn ${kind}`, disabled: !live, onclick: act(async () => { await prSend(action, args()); await prRead(); redraw(); }) }, text);

  // ---- зомби
  let zCount = 10; let zDiff = 2;
  const zNum = h('span', { class: 'small' }, String(zCount));
  const zRange = h('input', { type: 'range', min: 4, max: 24, step: 1, value: zCount, disabled: !live }); zRange.addEventListener('input', () => { zCount = Number(zRange.value); zNum.textContent = zCount; });
  const zSeg = h('div', { class: 'seg' }, [['0', 'Слабые'], ['1', 'Обычные'], ['2', 'Быстрые'], ['3', 'Орда']].map(([v, t]) => h('button', { class: String(zDiff) === v ? 'on' : '', onclick: (e) => { zDiff = Number(v); [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, t)));
  const zStart = act(async () => {
    await prSend('cvars', { pairs: { mp_humanteam: 'CT', mp_autoteambalance: '0', mp_limitteams: '0', bot_quota_mode: 'fill', bot_quota: String(zCount), bot_knives_only: '1', bot_difficulty: String(zDiff), mp_respawn_on_death_t: '1', mp_respawn_on_death_ct: '0', mp_startmoney: '16000', mp_roundtime: '5', mp_ignore_round_win_conditions: '0', mp_free_armor: '2' } });
    await prSend('restart', { delay: 3 }); await prSend('say', { text: 'ЗОМБИ-ОСАДА: люди за CT держатся, зомби (T) бегут с ножами!' }); toast('Зомби-осада запущена', 's'); await prRead(); redraw();
  });
  const zStop = act(async () => { await prSend('cvars', { pairs: { mp_humanteam: 'any', bot_quota: '0', bot_knives_only: '0', bot_difficulty: '2', mp_respawn_on_death_t: '0', mp_respawn_on_death_ct: '0' } }); await prSend('bot-kick', {}); await prSend('restart', { delay: 1 }); toast('Зомби-режим выключен', 's'); await prRead(); redraw(); });

  // ---- приколы
  const funs = S.catalog.fun.filter((f) => !f.secret || secretsOn());
  const funCard = (f) => h('button', { class: 'btn preset', disabled: !live, onclick: act(async () => { await prSend('fun', { id: f.id }); toast(`${f.title}: включено (до смены карты или сброса)`, 's'); await prRead(); redraw(); }) }, h('b', {}, `${f.title}${f.secret ? ' (секрет)' : ''}`), h('span', { class: 'muted small' }, f.note + (f.cheats ? ' Включает sv_cheats.' : '')));

  const sayIn = h('input', { type: 'text', placeholder: 'Сообщение всем игрокам в чат', style: 'width:340px', maxlength: 120 });
  return h('div', {}, h('h2', {}, 'Тренировка, боты и приколы'),
    !live ? h('div', { class: 'banner' }, 'Сервер CS2 не запущен: управление ботами и cvar заработает после старта. Режим тренировки можно включить и без него (он применится при запуске).') : null,
    h('div', { class: 'card' }, h('h3', {}, 'Режим'), h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: act(async () => { if (!confirm('Включить тренировочный режим? Текущие cvar будут заменены пресетом.')) return; await api('POST', '/preset', { preset: 'practice', restart: false }); if (live) await api('POST', '/apply-live'); S.state = null; toast('Тренировка включена. В игре: .prac, .bot, .nade…', 's'); await prRead(); redraw(); }) }, 'Включить тренировку'),
      h('button', { class: 'btn', onclick: act(async () => { if (!confirm('Вернуть соревновательный режим?')) return; await api('POST', '/preset', { preset: 'competitive', restart: false }); if (live) await api('POST', '/apply-live'); S.state = null; toast('Соревновательный режим', 's'); await prRead(); redraw(); }) }, 'Соревновательный'),
      up ? h('span', { class: 'muted small' }, `Сейчас: ${up.map}, людей ${up.humans}, ботов ${up.bots}`) : null),
      h('div', { class: 'hint' }, 'Тренировка включает бесконечные деньги и патроны, траектории гранат и респавн. Чат-команды .prac, .bot, .spawn, .nade — на странице «Справка».')),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('h3', {}, 'Боты'), h('div', { class: 'row' }, 'Сколько:', cntSel),
        h('div', { class: 'row' }, botBtn('＋ CT', 'bot-add', () => ({ team: 'ct', count: cnt })), botBtn('＋ T', 'bot-add', () => ({ team: 't', count: cnt })), botBtn('＋ любой', 'bot-add', () => ({ team: 'any', count: cnt }))),
        h('div', { class: 'row' }, botBtn('Убрать всех', 'bot-kick', () => ({}), 'danger'), botBtn('Убрать CT', 'bot-kick', () => ({ team: 'ct' })), botBtn('Убрать T', 'bot-kick', () => ({ team: 't' })), botBtn('Убить всех', 'bot-kill', () => ({}))),
        h('div', { class: 'hint' }, 'Сложность, «замерли», «только ножи» — в блоке настроек ниже.')),
      h('div', { class: 'card' }, h('h3', {}, 'Раунд и чат'),
        h('div', { class: 'row' }, botBtn('Рестарт раунда', 'restart', () => ({ delay: 1 })), botBtn('Закончить разминку', 'warmup-end', () => ({}))),
        h('div', { class: 'row' }, sayIn, h('button', { class: 'btn', disabled: !live, onclick: act(async () => { await prSend('say', { text: sayIn.value }); sayIn.value = ''; }, 'Отправлено') }, 'Сказать в чат')))),
    h('div', { class: 'card' }, h('h3', {}, 'Зомби-осада (на ботах)'),
      h('div', { class: 'muted small' }, 'Люди за CT, зомби — боты T с ножами, быстрый респавн. Это имитация на штатных cvar без плагина; настоящий зомби-мод (заражение, классы) требует отдельного плагина — пока не ставлю, чтобы не ломать совместимость.'),
      h('div', { class: 'row' }, 'Зомби:', zRange, zNum), h('div', { class: 'row' }, zSeg),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !live, onclick: zStart }, '▶ Начать осаду'), h('button', { class: 'btn', disabled: !live, onclick: zStop }, '■ Закончить'))),
    h('div', { class: 'card' }, h('h3', {}, 'Приколы'), h('div', { class: 'grid' }, funs.map(funCard)),
      h('div', { class: 'row' }, h('button', { class: 'btn danger', disabled: !live, onclick: act(async () => { await prSend('fun', { id: 'reset' }); toast('Всё вернул к стандарту (для 100% сброса смените карту)', 's'); await prRead(); redraw(); }) }, 'Сбросить все приколы')),
      h('div', { class: 'hint' }, 'Приколы действуют, пока вы не сбросите их или не смените карту; в постоянные настройки они не пишутся.' + (secretsOn() ? '' : ' Говорят, есть и секретные режимы…'))),
    Object.entries(byGroup).map(([g, list]) => h('div', { class: 'card' }, h('h3', {}, g),
      h('div', { class: 'cv', style: 'grid-template-columns:1fr auto' }, list.map((t) => [h('label', { style: 'font-family:inherit;font-size:14px' }, t.title, h('small', {}, `${t.cvar}${t.hint ? ' — ' + t.hint : ''}`)), control(t)]))))
      .concat([]), h('div', { class: 'hint' }, 'Изменения применяются сразу. Чтобы они пережили перезапуск, сохраните их на странице «Настройки» или в своём пресете.'));
}

// ---------------------------------------------------------------- оформление
const THEME_SWATCH = { auto: 'linear-gradient(90deg,#0b0b0c 50%,#f5f5f6 50%)', dark: '#0b0b0c', light: '#f5f5f6' };

function pageLook() {
  const root = h('div', {});
  const draw = () => root.replaceChildren(lookView(draw));
  draw();
  return root;
}
function lookView(redraw) {
  const eff = effectiveLook(); const season = SEASONS[seasonNow()];
  const themes = Object.entries(THEMES);
  const dens = h('input', { type: 'range', min: 0.3, max: 2, step: 0.1, value: look.density }); dens.addEventListener('change', () => saveLook({ density: Number(dens.value) }));
  return h('div', {}, h('h2', {}, 'Оформление'),
    h('div', { class: 'card' }, h('h3', {}, 'Сезон'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: look.auto, onchange: (e) => { saveLook({ auto: e.target.checked }); redraw(); } }), `Погода по времени года (сейчас: ${season.name} → «${WEATHERS[season.weather]}»)`),
      h('div', { class: 'hint' }, 'Погода и сезон — это эффекты панели. Погоду внутри самой CS2 сервер изменить не может: она часть клиентской графики и карты.')),
    h('div', { class: 'card' }, h('h3', {}, 'Тема'), h('div', { class: 'grid' }, themes.map(([k, t]) => h('button', { class: `btn preset ${look.theme === k ? 'on' : ''}`, onclick: () => { saveLook({ theme: k }); redraw(); } },
      h('span', { class: 'swatch', style: `background:${THEME_SWATCH[k]}` }), h('b', { style: 'margin-top:6px' }, t))))),
    S.role === 'admin' ? brandCard(redraw) : null,
    h('div', { class: 'card' }, h('h3', {}, 'Язык'), langSwitch(), h('div', { class: 'hint' }, 'Русский · English · Deutsch · Français. Длинные справочные тексты пока на русском.')),
    h('div', { class: 'card' }, h('h3', {}, 'Акцентный цвет'),
      h('div', { class: 'swatches' }, ACCENTS.map(([c, name]) => h('button', { class: `dot ${(look.accent || '') === c ? 'on' : ''}`, title: name, 'aria-label': name, style: `--c:${c || 'var(--text)'}`, onclick: () => { saveLook({ accent: c }); redraw(); } }))),
      h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Свой цвет:'), h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(look.accent || '') ? look.accent : '#0a84ff', onchange: (e) => { saveLook({ accent: e.target.value }); redraw(); } })),
      h('div', { class: 'hint' }, 'Цвет применяется к кнопкам, выбранным пунктам и переключателям. «Моно» — чёрно-белый стиль.')),
    h('div', { class: 'card' }, h('h3', {}, 'Погода интерфейса'),
      h('div', { class: 'seg', style: 'flex-wrap:wrap' }, Object.entries(WEATHERS).map(([k, t]) => h('button', { class: eff.weather === k ? 'on' : '', disabled: look.auto, onclick: () => { saveLook({ weather: k }); redraw(); } }, t))),
      h('div', { class: 'row' }, 'Густота:', dens),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!look.forceMotion, onchange: (e) => { saveLook({ forceMotion: e.target.checked }); } }), 'Показывать анимацию, даже если в системе включено «уменьшить движение»'),
      h('div', { class: 'hint' }, 'Настройки хранятся в браузере и не влияют на сервер. Эффекты не мешают кликам и ставятся на паузу, когда вкладка скрыта.')));
}

// ---------------------------------------------------------------- справка
function pageHelp() {
  const copyChip = (t) => h('span', { class: 'chip', title: 'Скопировать', onclick: copy(t) }, t);
  const o = S.ov || {}; const ip = o.vm && o.vm.publicIp;
  const faq = [
    ['Как зайти на сервер?', ip ? `Включите ВМ на «Обзоре», дождитесь статуса CS2 «Работает», в консоли CS2 введите: connect ${ip}:27015` : 'Включите ВМ на «Обзоре», затем в консоли CS2: connect <IP>:27015 (IP виден в верхней панели).'],
    ['Скин не появился в игре', 'Игроку нужно написать !wp в чате или перезайти на сервер. Проверьте, что включён плагин WeaponPaints (страница «Плагины») и что игрок выбран именно по своему SteamID64.'],
    ['Сколько это стоит?', 'ВМ с CS2 тарифицируется, пока включена. Лишнее экономит автовыключение (страница «Плагины и флаги»). Диск и статический IP стоят копейки даже при выключенной ВМ. Точные цены смотрите в консоли Yandex Cloud.'],
    ['Что будет при выключении ВМ?', 'Перед остановкой делается бэкап настроек, конфигов и базы скинов; при следующем старте всё восстанавливается.'],
    ['Что такое GSLT?', 'Токен игрового сервера Steam. Без него сервер доступен только в закрытом режиме. Скинченджер нарушает правила Valve для серверов, поэтому токен может быть заблокирован — это ваш осознанный риск.'],
    ['Команда не сработала', 'Команды чата зависят от версий плагинов: введите .help (MatchZy) или !help в чате. Через RCON команды вроде noclip не работают — они только для игрового клиента.'],
  ];
  return h('div', {}, h('h2', {}, 'Справка'),
    h('div', { class: 'card' }, h('h3', {}, 'С чего начать'), h('ol', { class: 'muted' },
      h('li', {}, 'На «Обзоре» включите сервер и дождитесь, пока CS2 запустится (1–3 минуты).'), h('li', {}, 'Скопируйте строку connect из верхней панели и вставьте в консоль CS2.'),
      h('li', {}, '«Скины» — выберите игрока и предметы, затем в игре напишите !wp.'), h('li', {}, '«Тренировка» — боты, траектории гранат, приколы и зомби-осада.'),
      h('li', {}, '«Карты и режимы» — смена карты, пресеты с предпросмотром, свои пресеты.'), h('li', {}, '«Оформление» — цвета, сезон и погода интерфейса.')),
      h('div', { class: 'hint' }, 'Горячие клавиши: Ctrl+K (или ⌘K) — быстрый поиск по страницам и командам; в консоли и в полях cvar работает автодополнение (Tab).')),
    CHAT_HELP.map((g) => h('div', { class: 'card' }, h('h3', {}, g.title), h('table', {}, h('tbody', {}, g.items.map(([c, d]) => h('tr', {}, h('td', {}, copyChip(c)), h('td', { class: 'muted' }, d))))))),
    h('div', { class: 'muted small' }, CHAT_NOTE),
    h('div', { class: 'card' }, h('h3', {}, 'Вопросы и ответы'), faq.map(([q, a]) => h('details', { style: 'margin:6px 0' }, h('summary', { style: 'cursor:pointer' }, q), h('div', { class: 'muted', style: 'padding:6px 0 6px 14px' }, a)))),
    h('div', { class: 'card' }, h('h3', {}, 'Пасхалки'), h('div', { class: 'muted' }, 'Они есть. Подсказки: старый добрый код с аркадных автоматов, любимое имя из Valve, если набрать его не в поле ввода, и логотип, по которому можно кликать упорнее обычного.')));
}

/** Название и логотип панели (вместо стандартного значка). */
function brandCard(redraw) {
  const name = h('input', { type: 'text', value: BRAND.name, maxlength: 40, style: 'width:220px' }); const tag = h('input', { type: 'text', value: BRAND.tagline, maxlength: 80, placeholder: 'Подпись (необязательно)', style: 'width:260px' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', hidden: true });
  const apply = (r) => { Object.assign(BRAND, r); applyBrand(); redraw(); };
  const toDataUrl = (f) => new Promise((ok, no) => {
    const fr = new FileReader(); fr.onerror = () => no(new Error('Не удалось прочитать файл'));
    fr.onload = () => {
      if (f.type === 'image/svg+xml') return ok(fr.result);
      const img = new Image(); img.onerror = () => no(new Error('Не удалось открыть изображение'));
      img.onload = () => { const k = Math.min(1, 256 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/png')); };
      img.src = fr.result;
    };
    fr.readAsDataURL(f);
  });
  file.addEventListener('change', act(async () => { if (!file.files[0]) return; apply(await api('POST', '/brand/logo', { dataUrl: await toDataUrl(file.files[0]) })); }, 'Логотип обновлён'));
  return h('div', { class: 'card' }, h('h3', {}, 'Логотип и название'),
    h('div', { class: 'row' }, brandMark(40) || svgIcon('logo', 36), name, tag, h('button', { class: 'btn', onclick: act(async () => apply(await api('PUT', '/brand', { name: name.value, tagline: tag.value })), 'Сохранено') }, 'Сохранить')),
    h('div', { class: 'row' }, file, h('button', { class: 'btn', onclick: () => file.click() }, 'Загрузить логотип'), BRAND.logo ? h('button', { class: 'btn', onclick: act(async () => apply(await api('PUT', '/brand', { removeLogo: true })), 'Логотип убран') }, 'Убрать логотип') : null),
    h('div', { class: 'hint' }, 'PNG, JPEG, WebP или SVG до 300 КБ (растровые сжимаются до 256 px). Логотип и название видны на входе, в меню, во вкладке браузера и на иконке приложения. Внутри самой CS2 клиентам файлы не передаются — там логотип игры заменить нельзя.'));
}
