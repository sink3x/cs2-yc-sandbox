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

// ---- свои аудиофайлы: загрузка в панель, доставка на игровую ВМ, управление ---------------------------------------
const SF_OK = /\.(wav|mp3|ogg)$/i;
const sfSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const SF_SYNC = {
  synced: ['ok', 'На игровой ВМ: всё доставлено'],
  pending: ['warn', 'Ждёт доставки на игровую ВМ (она выключена или идёт сверка)'],
  outdated: ['bad', 'Агент на игровой ВМ старый и не принимает файлы: перезапустите ВМ, когда на ней никого нет'],
  error: ['bad', 'Не удалось доставить файлы на игровую ВМ'],
};
async function sfUpload(file, overwrite) {
  const r = await fetch(`/api/sound-files?name=${encodeURIComponent(file.name)}${overwrite ? '&overwrite=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'cs2panel' }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(ruErr(j.error || r.statusText)), { status: r.status, raw: j.error || '' });
  return j;
}

function soundFilesCard() {
  const box = h('div', { class: 'card snd-files' });
  let data = null; let timer = null; let playing = null;
  const stopTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const load = async () => {
    stopTimer();
    try { data = await api('GET', '/sound-files'); } catch (e) { box.replaceChildren(h('h3', {}, 'Свои аудиофайлы'), h('div', { class: 'banner' }, tr(e.message))); return; }
    draw();
    if (document.body.contains(box) && (data.sync.busy || data.sync.state === 'pending')) timer = setTimeout(load, 4000);
  };
  const upload = (files) => act(async () => {
    const list = [...files];
    if (!list.length) return;
    for (const f of list) {
      if (!SF_OK.test(f.name)) throw new Error(tr('Только файлы .wav, .mp3 и .ogg'));
      if (f.size > data.limits.maxFile) throw new Error(`${f.name}: ${tr('файл больше 8 МБ')}`);
    }
    let done = 0;
    for (const f of list) {
      try { await sfUpload(f, false); } catch (e) {
        if (e.status === 409 && /already exists/.test(e.raw || '')) {
          if (!confirm(`${f.name}: ${tr('файл с таким именем уже есть. Заменить?')}`)) continue;
          await sfUpload(f, true);
        } else throw e;
      }
      done++;
    }
    await load();
    if (done) toast(`${tr('Загружено файлов')}: ${done}`, 's');
  })(null);
  const picker = h('input', { type: 'file', accept: '.wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg', multiple: true, hidden: true, onchange: (e) => { const fl = [...e.target.files]; e.target.value = ''; upload(fl); } });
  const preview = (name, btn) => {
    if (playing) { playing.pause(); playing = null; document.querySelectorAll('.snd-files .snd-pv').forEach((b) => { b.textContent = '▶'; }); if (btn.dataset.on === '1') { btn.dataset.on = '0'; return; } }
    const a = new Audio(`/api/sound-files/${encodeURIComponent(name)}`); playing = a; btn.textContent = '■'; btn.dataset.on = '1';
    a.onended = () => { btn.textContent = '▶'; btn.dataset.on = '0'; playing = null; };
    a.onerror = () => { btn.textContent = '▶'; btn.dataset.on = '0'; playing = null; toast(tr('Не удалось воспроизвести файл'), 'e'); };
    a.play().catch(() => a.onerror());
  };
  const row = (f) => {
    const nameEl = h('div', { class: 'snd-name' }, h('b', {}, document.createTextNode(f.name)), h('span', { class: 'muted small' }, document.createTextNode(`${sfSize(f.size)} · ${new Date(f.mtime).toLocaleString()}`)));
    const startRename = () => {
      const base = f.name.replace(/\.[a-z0-9]+$/, ''); const ext = f.name.slice(base.length);
      const inp = h('input', { type: 'text', value: base, maxlength: '48', style: 'width:200px', 'aria-label': 'Новое имя' });
      const save = act(async () => { const to = inp.value.trim(); if (to && `${to}${ext}` !== f.name) await api('POST', `/sound-files/${encodeURIComponent(f.name)}/rename`, { to: `${to}${ext}` }); await load(); }, 'Переименовано');
      inp.onkeydown = (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') draw(); };
      nameEl.replaceChildren(h('div', { class: 'row' }, inp, h('span', { class: 'muted' }, ext), h('button', { class: 'btn primary', onclick: save }, 'Сохранить'), h('button', { class: 'btn', onclick: () => draw() }, 'Отмена')));
      inp.focus(); inp.select();
    };
    return h('div', { class: 'snd-row' }, nameEl,
      h('button', { class: 'btn snd-pv', title: 'Прослушать', 'aria-label': 'Прослушать', onclick: (e) => preview(f.name, e.currentTarget) }, '▶'),
      h('button', { class: 'btn', onclick: startRename }, 'Переименовать'),
      h('a', { class: 'btn', href: `/api/sound-files/${encodeURIComponent(f.name)}?dl=1`, download: f.name }, 'Скачать'),
      h('button', { class: 'btn danger', onclick: act(async () => { if (!confirm(`${tr('Удалить файл')} ${f.name}? ${tr('Он пропадёт и с игровой ВМ.')}`)) return; await api('DELETE', `/sound-files/${encodeURIComponent(f.name)}`); await load(); }, 'Файл удалён') }, 'Удалить'));
  };
  function draw() {
    const sy = data.sync; const meta = SF_SYNC[sy.state] || SF_SYNC.error;
    const total = data.files.reduce((a, x) => a + x.size, 0);
    const drop = h('div', { class: 'snd-drop', tabindex: '0', role: 'button', onclick: () => picker.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } },
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); } },
      h('b', {}, 'Загрузить звук'), h('span', { class: 'muted small' }, 'Перетащите файлы сюда или нажмите. WAV, MP3 или OGG, до 8 МБ каждый.'));
    box.replaceChildren(
      h('h3', {}, 'Свои аудиофайлы'),
      h('p', { class: 'muted small' }, 'Файлы хранятся в панели и сами доставляются на игровую ВМ (папка data/custom-sounds), в том числе когда ВМ включится позже. Игрокам они сами не попадают: клиент получает звуки только из Workshop-аддона. Здесь удобно держать исходники для такого аддона.'),
      h('div', { class: 'row' }, h('span', { class: `pill ${meta[0]}` }, h('i'), meta[1]), sy.error && sy.state === 'error' ? h('span', { class: 'muted small' }, document.createTextNode(sy.error)) : null,
        h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/sound-files-sync'); await load(); }, 'Сверка выполнена') }, 'Сверить сейчас')),
      drop, picker,
      data.files.length ? h('div', { class: 'snd-list' }, data.files.map(row)) : h('div', { class: 'muted' }, 'Файлов пока нет.'),
      data.files.length ? h('div', { class: 'muted small' }, `${data.files.length} / ${data.limits.maxFiles} · ${sfSize(total)} / ${Math.round(data.limits.maxTotal / 1048576)} MB`) : null);
  }
  box.replaceChildren(h('h3', {}, 'Свои аудиофайлы'), h('div', { class: 'muted' }, 'Загрузка…'));
  load();
  return box;
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
    soundFilesCard(),
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
