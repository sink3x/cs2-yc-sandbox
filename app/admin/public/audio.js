'use strict';
// Общий плеер панели: играет звук прямо в браузере админа (игроки на сервере его не слышат).
// Три режима кнопки ▶: «Один» (новый звук заменяет прежние), «Наложение» (звуки играют одновременно), «Очередь» (по порядку).
// Панель плеера закреплена внизу и не пропадает при переходе между страницами.

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
  ['startofmatch', 'Начало матча', 'перед первым раундом матча', 'all', 'match start'],
  ['endofmatch', 'Конец матча', 'на итоговом экране матча', 'all', 'match end'],
];
/** Событие по имени файла: startround_02 → «Начало раунда 2». */
function musicTrackLabel(file) {
  const base = String(file).replace(/\.(mp3|wav)$/i, '');
  const m = /^(.*?)(?:_(\d+))?$/.exec(base); const ev = MUSIC_EVENTS.find((e) => e[0] === m[1]);
  return ev ? `${tr(ev[1])}${m[2] ? ` ${Number(m[2])}` : ''}` : base;
}

const AUDIO_MODES = [['single', 'Один', 'Новый звук останавливает прежние'], ['layer', 'Наложение', 'Звуки играют одновременно, друг поверх друга'], ['queue', 'Очередь', 'Звуки встают в очередь и играют по порядку']];
const AUDIO_MAX_VOICES = 8;
const AUDIO_MAX_QUEUE = 200;

const AudioHub = (() => {
  const saved = store.get('audioHub', {}) || {};
  const st = {
    mode: AUDIO_MODES.some((m) => m[0] === saved.mode) ? saved.mode : 'single',
    vol: Number.isFinite(saved.vol) ? Math.min(1, Math.max(0, saved.vol)) : 0.8,
    loop: !!saved.loop, open: saved.open !== false,
    voices: [], // играют сейчас: { id, src, audio, lane }
    queue: [], // ждут своей очереди: src
  };
  const subs = new Set();
  let seq = 0; let dock = null; let raf = 0;
  const save = () => store.set('audioHub', { mode: st.mode, vol: st.vol, loop: st.loop, open: st.open });
  const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');
  const lane = () => st.voices.find((v) => v.lane);

  function emit() { for (const fn of [...subs]) { try { if (fn() === false) subs.delete(fn); } catch { subs.delete(fn); } } render(); }
  function drop(v, silent) {
    const i = st.voices.indexOf(v); if (i < 0) return;
    st.voices.splice(i, 1);
    v.audio.pause(); v.audio.removeAttribute('src'); try { v.audio.load(); } catch { /* ok */ }
    if (!silent) emit();
  }
  function start(src, isLane) {
    const a = new Audio(src.url); a.preload = 'auto'; a.volume = st.vol;
    const v = { id: ++seq, src, audio: a, lane: isLane };
    a.loop = st.loop && !isLane;
    a.addEventListener('ended', () => {
      if (!st.voices.includes(v)) return;
      if (v.lane && st.loop) st.queue.push(v.src); // повтор очереди: сыгранное уходит в конец
      drop(v, true); if (v.lane) next(); emit();
    });
    a.addEventListener('error', () => {
      if (!st.voices.includes(v)) return;
      drop(v, true); toast(`${tr('Не удалось воспроизвести')}: ${src.title}. ${tr(src.hint || 'Файл недоступен')}`, 'e');
      if (v.lane) next(); emit();
    });
    a.addEventListener('loadedmetadata', render); a.addEventListener('playing', render); a.addEventListener('pause', render);
    st.voices.push(v);
    a.play().catch(() => { /* ошибку покажет событие error; запрет автозапуска снимается первым нажатием */ });
    return v;
  }
  function next() { if (lane()) return; const src = st.queue.shift(); if (src) start(src, true); }

  /** Кнопка ▶: поведение зависит от выбранного режима. */
  function play(src) {
    if (st.mode === 'queue') return enqueue(src);
    if (st.mode === 'single') { for (const v of [...st.voices]) drop(v, true); st.queue = []; } else {
      const free = st.voices.filter((v) => !v.lane);
      if (free.length >= AUDIO_MAX_VOICES) drop(free[0], true);
    }
    start(src, false); emit();
  }
  /** В очередь (в любом режиме). list — сразу несколько; replace — сначала очистить очередь и остановить текущий трек очереди. */
  function enqueue(src, { replace = false } = {}) {
    const list = (Array.isArray(src) ? src : [src]).filter(Boolean);
    if (replace) { st.queue = []; const l = lane(); if (l) drop(l, true); if (st.mode === 'single') for (const v of [...st.voices]) drop(v, true); }
    const room = AUDIO_MAX_QUEUE - st.queue.length;
    if (list.length > room) toast(tr('Очередь заполнена: лишнее не добавлено'), 'e');
    st.queue.push(...list.slice(0, Math.max(0, room)));
    next(); emit();
  }
  const stopKey = (key) => { for (const v of st.voices.filter((x) => x.src.key === key)) drop(v, true); next(); emit(); };
  const stopAll = () => { st.queue = []; for (const v of [...st.voices]) drop(v, true); emit(); };
  const skip = () => { const l = lane(); if (l) drop(l, true); next(); emit(); };
  const isPlaying = (key) => st.voices.some((v) => v.src.key === key);
  const inQueue = (key) => st.queue.some((s) => s.key === key);
  const setMode = (m) => { st.mode = m; save(); emit(); };
  const setVol = (x) => { st.vol = x; for (const v of st.voices) v.audio.volume = x; save(); };
  const setLoop = (on) => { st.loop = on; for (const v of st.voices) if (!v.lane) v.audio.loop = on; save(); emit(); };
  /** Подписка на изменения; обработчик, вернувший false, отписывается (так делают списки, которых уже нет на странице). */
  const onChange = (fn) => { subs.add(fn); };

  // ---- панель плеера ----
  function tick() {
    raf = 0; if (!dock || !st.voices.length) return;
    for (const v of st.voices) {
      const row = dock.querySelector(`[data-voice="${v.id}"]`); if (!row) continue;
      const d = v.audio.duration; const t = v.audio.currentTime;
      row.querySelector('.ad-fill').style.width = Number.isFinite(d) && d > 0 ? `${Math.min(100, (t / d) * 100)}%` : '0%';
      row.querySelector('.ad-time').textContent = `${fmt(t)} / ${fmt(d)}`;
    }
    raf = requestAnimationFrame(tick);
  }
  function voiceRow(v) {
    const bar = h('div', { class: 'ad-bar', role: 'slider', tabindex: '0', 'aria-label': tr('Перемотка'), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'ad-fill' }));
    const seek = (k) => { const d = v.audio.duration; if (Number.isFinite(d) && d > 0) { try { v.audio.currentTime = Math.min(d - 0.05, Math.max(0, k * d)); } catch { /* поток ещё не перематывается */ } } };
    bar.addEventListener('click', (e) => { const r = bar.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); });
    bar.addEventListener('keydown', (e) => { const d = v.audio.duration; if (!Number.isFinite(d)) return; if (e.key === 'ArrowRight') seek((v.audio.currentTime + 5) / d); if (e.key === 'ArrowLeft') seek((v.audio.currentTime - 5) / d); });
    const paused = v.audio.paused && v.audio.readyState > 0 && !v.audio.ended;
    return h('div', { class: `ad-voice${v.lane ? ' lane' : ''}`, 'data-voice': String(v.id) },
      h('button', { class: 'btn ad-btn', 'aria-label': tr(paused ? 'Продолжить' : 'Пауза'), onclick: () => { if (v.audio.paused) v.audio.play().catch(() => {}); else v.audio.pause(); } }, paused ? '▶' : '⏸'),
      h('div', { class: 'ad-meta' }, h('div', { class: 'ad-title' }, document.createTextNode(v.src.title), v.src.sub ? h('span', { class: 'muted small' }, document.createTextNode(` · ${v.src.sub}`)) : null), bar),
      h('span', { class: 'ad-time muted small' }, '0:00'),
      v.lane ? h('span', { class: 'badge' }, 'очередь') : null,
      h('button', { class: 'btn ad-btn', 'aria-label': tr('Остановить'), title: tr('Остановить'), onclick: () => { const wasLane = v.lane; drop(v, true); if (wasLane) next(); emit(); } }, '■'));
  }
  function queueRow(src, i) {
    const move = (d) => { const j = i + d; if (j < 0 || j >= st.queue.length) return; [st.queue[i], st.queue[j]] = [st.queue[j], st.queue[i]]; emit(); };
    return h('div', { class: 'ad-q' }, h('span', { class: 'muted small ad-n' }, String(i + 1)),
      h('div', { class: 'ad-title' }, document.createTextNode(src.title), src.sub ? h('span', { class: 'muted small' }, document.createTextNode(` · ${src.sub}`)) : null),
      h('button', { class: 'btn ad-btn', disabled: i === 0, 'aria-label': tr('Выше'), title: tr('Выше'), onclick: () => move(-1) }, '↑'),
      h('button', { class: 'btn ad-btn', disabled: i === st.queue.length - 1, 'aria-label': tr('Ниже'), title: tr('Ниже'), onclick: () => move(1) }, '↓'),
      h('button', { class: 'btn ad-btn', 'aria-label': tr('Убрать из очереди'), title: tr('Убрать из очереди'), onclick: () => { st.queue.splice(i, 1); emit(); } }, '✕'));
  }
  function render() {
    const busy = st.voices.length || st.queue.length;
    if (!busy) { if (dock) { dock.remove(); dock = null; document.body.classList.remove('has-audio-dock'); } return; }
    if (!dock) { dock = h('div', { class: 'audio-dock', role: 'region', 'aria-label': tr('Плеер') }); document.body.append(dock); document.body.classList.add('has-audio-dock'); }
    const vol = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(st.vol * 100)), class: 'ad-vol', 'aria-label': tr('Громкость') });
    vol.addEventListener('input', () => setVol(Number(vol.value) / 100));
    const head = h('div', { class: 'ad-head' },
      h('b', {}, 'Плеер'), h('span', { class: 'muted small ad-count' }, `${tr('играет')}: ${st.voices.length}${st.queue.length ? ` · ${tr('в очереди')}: ${st.queue.length}` : ''}`),
      modeSwitch(),
      h('label', { class: 'ad-volbox', title: tr('Громкость') }, '🔊', vol),
      h('button', { class: `btn ad-btn${st.loop ? ' on' : ''}`, 'aria-pressed': String(st.loop), title: tr('Повтор: звук или вся очередь играют по кругу'), 'aria-label': tr('Повтор'), onclick: () => setLoop(!st.loop) }, '🔁'),
      st.queue.length || lane() ? h('button', { class: 'btn ad-btn', title: tr('Следующий в очереди'), 'aria-label': tr('Следующий в очереди'), onclick: skip }, '⏭') : null,
      h('button', { class: 'btn danger', onclick: stopAll }, '■ Стоп всё'),
      h('button', { class: 'btn ad-btn', 'aria-expanded': String(st.open), 'aria-label': tr(st.open ? 'Свернуть' : 'Развернуть'), title: tr(st.open ? 'Свернуть' : 'Развернуть'), onclick: () => { st.open = !st.open; save(); render(); } }, st.open ? '▾' : '▴'));
    const body = st.open ? h('div', { class: 'ad-body' }, ...st.voices.map(voiceRow),
      st.queue.length ? h('div', { class: 'ad-qbox' }, h('div', { class: 'muted small' }, 'Очередь'), ...st.queue.slice(0, 30).map(queueRow),
        st.queue.length > 30 ? h('div', { class: 'muted small' }, `… ${tr('и ещё')} ${st.queue.length - 30}`) : null) : null) : null;
    put(dock, head, body);
    if (!raf) raf = requestAnimationFrame(tick);
  }
  /** Переключатель режима кнопки ▶ (один и тот же в панели плеера и на страницах). */
  function modeSwitch() {
    return h('div', { class: 'seg ad-mode', role: 'group', 'aria-label': tr('Режим воспроизведения') }, AUDIO_MODES.map(([id, title, tip]) => h('button', { class: st.mode === id ? 'on' : '', title: tr(tip), 'aria-pressed': String(st.mode === id), onclick: () => setMode(id) }, title)));
  }
  /** Пара кнопок для строки списка: ▶ (по режиму) и ＋ (в очередь). Сами перерисовываются, пока строка на странице. */
  function buttons(src) {
    const playBtn = h('button', { class: 'btn snd-pv', onclick: () => { if (isPlaying(src.key) && st.mode === 'single') stopKey(src.key); else play(src); } }, '▶');
    const addBtn = h('button', { class: 'btn snd-pv', title: tr('Добавить в очередь'), 'aria-label': tr('Добавить в очередь'), onclick: () => enqueue(src) }, '＋');
    const box = h('span', { class: 'ad-pair' }, playBtn, addBtn);
    const paint = () => {
      const on = isPlaying(src.key); const stop = on && st.mode === 'single';
      playBtn.textContent = stop ? '■' : '▶'; playBtn.classList.toggle('on', on);
      const label = tr(stop ? 'Остановить' : st.mode === 'queue' ? 'В очередь' : 'Слушать'); playBtn.setAttribute('aria-label', label); playBtn.title = label;
      addBtn.classList.toggle('on', inQueue(src.key));
    };
    paint();
    let seen = false; // отписываемся, когда строка побывала на странице и исчезла с неё
    onChange(() => { if (box.isConnected) { seen = true; paint(); return true; } return !seen; });
    return box;
  }
  return { play, enqueue, stopAll, stopKey, skip, isPlaying, inQueue, onChange, setMode, modeSwitch, buttons, get mode() { return st.mode; } };
})();

/** Источник для плеера: трек музыкального набора. */
const musicSrc = (m, file) => ({ key: `kit/${m.id}/${file}`, url: `/api/music-kit/${m.id}/${encodeURIComponent(file)}`, title: musicTrackLabel(file), sub: m.name || `№${m.id}`, hint: 'Игровая ВМ выключена или файл не извлёкся' });

/** Список треков музыкального набора (звук из файлов игры, через игровую ВМ; прослушанное остаётся в кэше панели). */
function musicPlayer(m) {
  const box = h('div', { class: 'mk-player' }, h('div', { class: 'muted small' }, 'Загрузка списка треков… В первый раз звук извлекается из файлов игры — до минуты.'));
  api('GET', `/music-kit?id=${m.id}`).then((r) => {
    if (!box.isConnected) return;
    const order = (f) => { const i = MUSIC_EVENTS.findIndex((e) => f.startsWith(e[0])); return i < 0 ? 99 : i; };
    const tracks = [...(r.tracks || [])].sort((x, y) => order(x.file) - order(y.file) || x.file.localeCompare(y.file));
    if (!tracks.length) { box.replaceChildren(h('div', { class: 'warn small' }, 'В файлах игры не нашлось треков этого набора.')); return; }
    const srcs = tracks.map((t) => musicSrc(m, t.file));
    const rows = tracks.map((t, i) => {
      const ev = MUSIC_EVENTS.find((e) => t.file.startsWith(e[0]));
      const el = h('div', { class: 'mk-row' }, AudioHub.buttons(srcs[i]), h('div', {}, h('b', {}, musicTrackLabel(t.file)), ev ? h('div', { class: 'muted small' }, ev[2], ' · ', ev[3] === 'all' ? 'слышат все игроки' : 'слышите только вы') : null));
      let seen = false;
      AudioHub.onChange(() => { if (el.isConnected) { seen = true; el.classList.toggle('on', AudioHub.isPlaying(srcs[i].key)); return true; } return !seen; });
      return el;
    });
    box.replaceChildren(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => AudioHub.enqueue(srcs, { replace: true }) }, '▶ Весь набор подряд'), h('button', { class: 'btn', onclick: () => AudioHub.stopAll() }, '■ Стоп'),
      r.cached ? null : h('span', { class: 'muted small' }, 'Треки загружаются с игровой ВМ и остаются в кэше панели.')), ...rows);
  }).catch((e) => {
    if (!box.isConnected) return;
    box.replaceChildren(h('div', { class: 'warn small' }, `${tr('Прослушивание недоступно')}: ${e.message}`), h('div', { class: 'hint' }, 'Звук берётся из файлов игры на игровой ВМ: включите её и откройте набор ещё раз. Уже прослушанные наборы играют из кэша панели и при выключенной ВМ.'));
  });
  return box;
}
