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
    h('div', { class: 'card' },
      h('h3', {}, 'Библиотека'),
      h('div', { class: 'row' }, h('label', { class: 'muted' }, 'Кому'), target),
      list.length ? h('div', { class: 'snd-list' }, list.map((x) => h('div', { class: 'snd-row' },
        h('div', { class: 'snd-name' }, h('b', {}, document.createTextNode(x.title)), h('span', { class: 'muted small' }, document.createTextNode(`${x.id} · ${x.play}`))),
        h('button', { class: 'btn', onclick: play(x.id) }, 'Играть'),
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
