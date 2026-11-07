'use strict';
// Admin panel UI. Vanilla JS, no build step.
const $app = document.getElementById('app');
const TR_ATTR = new Set(['placeholder', 'title', 'aria-label', 'data-tip', 'alt']);
const h = (tag, props, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : (TR_ATTR.has(k) ? tr(String(v)) : v));
  }
  for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(tr(String(c)))); }
  return e;
};
/** replaceChildren без null/false (иначе в DOM попадёт текст «null»). */
const put = (root, ...nodes) => root.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cs2panel' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401 && path !== '/me') { showLogin(); throw new Error(path === '/login' ? 'Неверный логин или пароль' : 'Нужен вход'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(ruErr(j.error || r.statusText));
  // PUT /state answers with {state, applied, ...} only: keep the registry/flags the page got from GET /state
  if (method === 'PUT' && path === '/state' && j && S.state) for (const k of ['plugins', 'admin_flags', 'protectedAdmins']) if (j[k] === undefined) j[k] = S.state[k];
  if (j && j.queued) toast('Сервер выключен: изменения сохранены в панели и применятся после его запуска', 's');
  return j;
}

// ---- профили Steam (ник + аватар) по SteamID64: общий кэш и пакетные запросы ----------------------------------------
const SP = { map: new Map(), queue: new Set(), timer: null, waiters: [] };
function steamProfile(id) { // → Promise<{name, avatar}|null>
  id = String(id || ''); if (!/^\d{17}$/.test(id)) return Promise.resolve(null);
  if (SP.map.has(id)) return Promise.resolve(SP.map.get(id));
  SP.queue.add(id);
  if (!SP.timer) SP.timer = setTimeout(async () => {
    const ids = [...SP.queue]; SP.queue.clear(); SP.timer = null;
    let got = {}; try { got = (await api('GET', `/steam-profiles?ids=${ids.join(',')}`)).profiles || {}; } catch { /* не критично: останется буква */ }
    for (const x of ids) SP.map.set(x, got[x] || null);
    const w = SP.waiters; SP.waiters = []; w.forEach((f) => f());
  }, 25);
  return new Promise((res) => SP.waiters.push(() => res(SP.map.get(id) || null)));
}
/** Аватар Steam для SteamID: сначала буква, затем подменяется картинкой; onName(name) получает ник Steam. */
function steamAv(id, size = 28, fallback = '?', onName) {
  const box = h('span', { class: 'avatar ph', style: `width:${size}px;height:${size}px;line-height:${size}px;font-size:${Math.round(size * 0.45)}px` }, String(fallback || '?').slice(0, 1).toUpperCase());
  steamProfile(id).then((p) => {
    if (!p) return;
    if (p.avatar) box.replaceWith(h('img', { class: 'avatar', src: p.avatar, alt: '', width: size, height: size, loading: 'lazy', referrerpolicy: 'no-referrer', style: `width:${size}px;height:${size}px` }));
    if (onName) onName(p.name);
  });
  return box;
}

/** Флаг-эмодзи страны по коду ISO alpha-2 ('' → ''). */
function flagOf(cc) { cc = String(cc || '').toUpperCase(); return /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65)) : ''; }
/** Название страны/языка на языке интерфейса (Intl.DisplayNames; без поддержки — сам код). */
function geoName(type, code) { try { return new Intl.DisplayNames([typeof LOCALE === 'string' ? LOCALE : 'ru'], { type }).of(type === 'region' ? String(code).toUpperCase() : String(code).toLowerCase()) || code; } catch { return code; } }
/** Метка «флаг + язык» игрока, которую он сам указал в профиле; пока профиль грузится или данных нет — пустой span. */
function geoTag(id) {
  const el = h('span', { class: 'geo' });
  steamProfile(id).then((p) => {
    if (!p || (!p.country && !p.lang)) return;
    const f = flagOf(p.country); // на Windows эмодзи-флаги рисуются буквами — поэтому код страны остаётся видимым
    el.title = [p.country ? geoName('region', p.country) : '', p.lang ? geoName('language', p.lang) : ''].filter(Boolean).join(' · ');
    el.replaceChildren(f ? h('span', { class: 'geo-f', 'aria-hidden': 'true' }, f) : null, h('span', { class: 'geo-c' }, [p.country, p.lang && p.lang.toUpperCase() !== p.country && p.lang.toUpperCase()].filter(Boolean).join(' · ')));
  });
  return el;
}

// ---- острова Preact + TypeScript: страница-обёртка подгружает /ui/main.js и монтирует компонент (см. web/) ----------
function island(name) {
  const el = h('div');
  import('/ui/main.js').then((m) => m.mount(name, el, { tr, ruErr, api, toast: (msg, kind) => toast(msg, kind), locale: typeof LOCALE === 'string' ? LOCALE : 'ru', lang: typeof LANG === 'string' ? LANG : 'ru', role: S.role, slug: (S.route && S.route.slug) || '', go: (page, slug) => go(page, slug) }))
    .catch((e) => el.replaceChildren(h('div', { class: 'banner' }, `${tr('Не удалось загрузить часть интерфейса')}: ${e.message}`)));
  return el;
}

// Перевод типовых ошибок сервера на русский.
const ERR_RU = [
  [/^wrong account or password/i, 'Неверный логин или пароль админ-аккаунта'], [/^only for a Steam player session/i, 'Только для игрока, вошедшего через Steam'], [/^this account is already linked to a Steam ID/i, 'Этот аккаунт уже привязан к другому Steam'],
  [/^only \.wav, \.mp3 and \.ogg files/i, 'Только файлы .wav, .mp3 и .ogg'], [/^content does not look like/i, 'Содержимое не похоже на звуковой файл этого типа'],
  [/^file too large/i, 'Файл больше 8 МБ'], [/^too many files/i, 'Слишком много файлов (максимум 100)'], [/^storage limit reached/i, 'Хранилище звуков заполнено (100 МБ)'],
  [/^file already exists/i, 'Файл с таким именем уже есть'], [/^no such file/i, 'Файла нет'], [/^extension cannot change/i, 'Расширение файла менять нельзя'], [/^bad file name/i, 'Недопустимое имя файла'], [/^empty file/i, 'Файл пустой'], [/^body too large/i, 'Файл слишком большой'],
  [/^too many attempts/i, 'Слишком много попыток, подождите немного'], [/^not logged in/i, 'Нужен вход'], [/^missing CSRF/i, 'Запрос отклонён (CSRF), обновите страницу'],
  [/^wrong current password/i, 'Неверный текущий пароль'], [/^new password: at least (\d+)/i, 'Новый пароль: минимум $1 символов'],
  [/^busy: (.+)/i, 'Занято: $1'], [/^VM is (\w+), cannot (\w+) now/i, 'ВМ сейчас в состоянии $1 — действие недоступно'],
  [/^not found/i, 'Не найдено'], [/^body too large/i, 'Слишком большой запрос'], [/^invalid JSON/i, 'Некорректный запрос'], [/^unauthorized/i, 'Нет доступа к агенту'],
  [/^server\.hostname/i, 'Имя сервера: 1–64 символа, без кавычек и «;»'], [/^server\.map/i, 'Карта: имя вида de_xxx или ID воркшопа'], [/^server\.maxPlayers/i, 'Слотов: от 2 до 64'],
  [/^server\.password/i, 'Пароль входа: до 32 символов [A-Za-z0-9_.!@#-]'], [/^server\.extraArgs/i, 'Доп. аргументы: только [A-Za-z0-9_+-.=] и пробелы'],
  [/^cvars\.(\S+): bad name/i, 'Недопустимое имя cvar: $1'], [/^cvars\.(\S+): bad value/i, 'Недопустимое значение cvar $1 (нельзя ; \" \\ и переводы строк)'],
  [/^admins: duplicate (\d+)/i, 'Админ $1 указан дважды'], [/^admins: bad SteamID64/i, 'Админы: неверный SteamID64'], [/^admins: (.*) needs at least one flag/i, 'Админы: у $1 нет ни одного права'],
  [/^maps: bad entry (.+)/i, 'Карты: недопустимая запись $1'], [/^Failed to fetch|NetworkError/i, 'Нет связи с панелью'], [/^agent HTTP (\d+)/i, 'Агент ответил ошибкой $1'],
  [/^skin catalog unavailable/i, 'Каталог скинов недоступен (нет доступа к GitHub). Повторите позже'],
  [/^mysql:/i, 'Ошибка базы скинов: '],
  [/^user not found/i, 'Пользователь не найден'], [/^setup not found/i, 'Сетап не найден или недоступен'], [/^forbidden for players: own card only/i, 'Игроку доступна только своя карточка'],
  [/^forbidden for players/i, 'Это действие недоступно игроку'], [/^forbidden: /i, 'Менять сетап может только владелец'], [/^forbidden/i, 'Недостаточно прав'], [/^users: bad slug/i, 'Некорректная ссылка пользователя'],
  [/^admins: protected (\d+) cannot be removed/i, 'Владельца сервера ($1) нельзя удалить из админов'], [/^admins: protected (\d+) must keep/i, 'У владельца сервера ($1) нельзя снять права root'],
  [/^state cache empty/i, 'В панели ещё нет копии настроек: запустите сервер один раз (кнопка на «Обзоре»), после этого они будут видны и при выключенной ВМ'],
  [/^(fetch failed|.*(ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|aborted due to timeout|operation was aborted).*)$/i, 'Сервер CS2 недоступен: выключен или ещё запускается'],
];
function ruErr(m) {
  const t = String(m || '');
  for (const [re, rep] of ERR_RU) if (re.test(t)) return rep.endsWith(': ') ? tr(rep) + t.slice(6) : t.replace(re, tr(rep));
  return t;
}

const toastBox = h('div', { class: 'toast' });
document.body.append(toastBox);
function toast(msg, kind = '') {
  const t = h('div', { class: kind }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'e' ? 8000 : 3500);
}
const act = (fn, okMsg) => async (ev) => {
  const btn = ev && ev.currentTarget; if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(okMsg, 's'); return r; } catch (e) { toast(e.message, 'e'); } finally { if (btn) btn.disabled = false; }
};

const BRAND = { name: 'sandbox-cs-1', tagline: '', logo: '' };
async function loadBrand() {
  try { Object.assign(BRAND, await (await fetch('/api/brand')).json()); } catch { /* по умолчанию */ }
  applyBrand();
}
function applyBrand() {
  document.title = `${BRAND.name} · ${tr('панель управления')}`;
  if (BRAND.logo) for (const l of document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon]')) { l.href = BRAND.logo; l.removeAttribute('sizes'); l.type = ''; }
}
const brandMark = (size = 20) => (BRAND.logo ? h('img', { class: 'brand-img', src: BRAND.logo, alt: '', width: size, height: size }) : null);
const S = { user: null, role: 'admin', steamid: '', ov: null, page: 'overview', catalog: null, state: null, pluginsMeta: [], adminFlags: [], settings: null, pollTimer: null };

// ---------------------------------------------------------------- login
const STEAM_MSG = { unlinked: 'Не удалось войти с этим Steam-аккаунтом: вход для новых игроков сейчас закрыт.', error: 'Не удалось проверить вход через Steam. Попробуйте ещё раз.', expired: 'Ссылка привязки устарела — повторите из профиля.', taken: 'Этот Steam уже привязан к другому пользователю.', linked: 'Steam привязан. Теперь можно входить через Steam.' };
function loginNote() {
  const k = new URLSearchParams(location.search).get('steam');
  if (!k || !STEAM_MSG[k]) return null;
  history.replaceState(null, '', location.pathname);
  return h('div', { class: k === 'linked' ? 'banner ok' : 'banner' }, STEAM_MSG[k]);
}
function showLogin() {
  clearInterval(S.pollTimer);
  const u = h('input', { type: 'text', placeholder: 'Логин', autocomplete: 'username' });
  const p = h('input', { type: 'password', placeholder: 'Пароль', autocomplete: 'current-password' });
  const go = async () => {
    try { await api('POST', '/login', { username: u.value, password: p.value }); await boot(); } catch (e) { toast(e.message, 'e'); }
  };
  p.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' },
    h('div', { class: 'login-brand' }, brandMark(44), h('h2', {}, BRAND.name), BRAND.tagline ? h('div', { class: 'muted small' }, BRAND.tagline) : null), loginNote(), u, p, h('button', { class: 'btn primary', onclick: go }, 'Войти'),
    h('div', { class: 'login-or' }, h('span', {}, 'или')),
    h('a', { class: 'btn steam', href: '/api/auth/steam' }, 'Войти через Steam'), langSwitch())));
  u.focus();
}

// ---------------------------------------------------------------- helpers
const fmtStatus = (s) => ({ RUNNING: ['Включена', 'ok'], STOPPED: ['Выключена', ''], STARTING: ['Запускается…', 'warn'], STOPPING: ['Выключается…', 'warn'], PROVISIONING: ['Создаётся…', 'warn'] }[s] || [s || '—', 'bad']);
const pill = (text, kind) => h('span', { class: `pill ${kind || ''}` }, h('i'), text);
const copy = (text) => async () => { try { await navigator.clipboard.writeText(text); toast('Скопировано', 's'); } catch { toast(text); } };
const phaseText = (p) => p && ({ init: 'подготовка', restore: 'восстановление из бэкапа', 'update-game': 'обновление CS2', plugins: 'установка плагинов', configure: 'настройка', starting: 'запуск', failed: 'ошибка' }[p.phase] || p.phase);

async function loadOverview() {
  if (S.role === 'player') {
    try {
      const r = await api('GET', '/public-info'); const ip = r.connect ? r.connect.replace(/^connect\s+/, '').split(':')[0] : null;
      S.ov = { vm: { status: r.status, publicIp: ip }, server: r.map ? { live: { map: r.map, humans: r.humans, maxPlayers: r.maxPlayers } } : null };
    } catch (e) { if (e.message !== 'Нужен вход') S.ov = { error: e.message }; }
    renderBar(); if (S.page === 'overview' || S.page === 'info') renderPage(); return;
  }
  try { S.ov = await api('GET', '/overview'); } catch (e) { if (e.message !== 'Нужен вход') S.ov = { error: e.message }; }
  if (serverUp() && !S.state && !S.stateTried) {
    S.stateTried = true;
    api('GET', '/state').then((r) => { S.state = r; S.pluginsMeta = r.plugins; S.adminFlags = r.admin_flags; renderBar(); }).catch(() => { S.stateTried = false; });
  }
  renderBar();
  if (S.page === 'overview' || S.page === 'info') renderPage();
}

/** steam://connect/ip:порт[/пароль] — открывает Steam и заходит на сервер. */
function connectUrl() {
  const ip = S.ov && S.ov.vm && S.ov.vm.publicIp;
  if (!ip) return null;
  const pw = S.state && S.state.state && S.state.state.server && S.state.state.server.password;
  return `steam://connect/${ip}:27015${pw ? '/' + encodeURIComponent(pw) : ''}`;
}
function connectButton(big) {
  const o = S.ov || {}; const st = o.vm && o.vm.status; const cls = `connect${big ? ' big' : ''}`;
  if (!o.vm) return h('span', { class: `${cls} off` }, 'Подключиться');
  if (st === 'STOPPED' && S.role === 'player') return h('span', { class: `${cls} off` }, 'Сервер выключен');
  if (st === 'STOPPED') return h('button', { class: cls, onclick: act(async () => { await api('POST', '/vm/start'); await loadOverview(); }, 'Запускаю сервер. Когда он будет готов, здесь появится «Подключиться»') }, 'Запустить сервер');
  if (!serverUp()) return h('span', { class: `${cls} off`, title: 'Дождитесь запуска CS2' }, st === 'STOPPING' || o.busy ? 'Выключается…' : 'Сервер запускается…');
  return h('a', { class: cls, href: connectUrl(), title: 'Откроет Steam и подключит к серверу', onclick: () => toast('Открываю Steam… Если ничего не произошло — скопируйте строку connect и вставьте в консоль CS2 (Steam должен быть запущен).') }, 'Подключиться');
}

function serverUp() { return S.ov && S.ov.vm && S.ov.vm.status === 'RUNNING' && S.ov.server && S.ov.server.live; }

// ---------------------------------------------------------------- status bar
const barEl = h('div', { class: 'bar' });
function renderBar() {
  const o = S.ov || {};
  const [vmText, vmKind] = o.busy ? ['Выключается…', 'warn'] : fmtStatus(o.vm && o.vm.status);
  const srv = o.server;
  const live = srv && srv.live;
  const kids = [pill(`ВМ: ${vmText}`, vmKind)];
  if (o.vm && o.vm.status === 'RUNNING') {
    if (live) kids.push(pill(`CS2: ${live.map || '…'} · ${live.humans}/${live.maxPlayers || '?'}`, 'ok'));
    else if (srv && srv.phase && srv.phase.phase !== 'starting') kids.push(pill(`CS2: ${phaseText(srv.phase)}`, srv.phase.phase === 'failed' ? 'bad' : 'warn'));
    else kids.push(pill('CS2: запускается…', 'warn'));
  }
  kids.push(connectButton(false));
  if (o.vm && o.vm.publicIp) kids.push(h('button', { class: 'chip', title: 'Скопировать для консоли CS2', onclick: copy(`connect ${o.vm.publicIp}:27015`) }, `connect ${o.vm.publicIp}:27015`));
  if (o.error || o.vmError) kids.push(h('span', { class: 'bad small' }, o.error || o.vmError));
  barEl.replaceChildren(...kids);
}


// ---------------------------------------------------------------- общие виджеты
const fmtNum = (n) => new Intl.NumberFormat(LOCALE).format(n);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Модальное окно. content — узел или массив; возвращает {close}. */
function modal(title, content, buttons = []) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
    h('div', { class: 'modal-h' }, h('b', {}, title), h('button', { class: 'btn', onclick: close, 'aria-label': 'Закрыть' }, '×')),
    h('div', { class: 'modal-b' }, content),
    buttons.length ? h('div', { class: 'row modal-f' }, buttons.map((b) => h('button', { class: `btn ${b.kind || ''}`, onclick: async (ev) => { ev.currentTarget.disabled = true; try { const keep = await b.run(); if (keep !== false) close(); } catch (e) { toast(e.message, 'e'); ev.currentTarget.disabled = false; } } }, b.text))) : null));
  document.body.append(back);
  return { close };
}

/**
 * Автодополнение для input. getOptions(text, input) -> [{value, label?, desc?}].
 * ↑/↓ — выбор, Tab/Enter — подставить, Esc — закрыть. onPick(opt) вызывается после подстановки.
 */
function autocomplete(input, getOptions, { onPick, limit = 8, replace = (opt) => opt.value } = {}) {
  const box = h('div', { class: 'ac', hidden: true });
  const wrap = h('div', { class: 'ac-wrap', style: input.style.width ? `width:${input.style.width}` : (input.style.flex ? 'flex:1' : '') });
  input.replaceWith(wrap); wrap.append(input, box);
  input.style.width = '100%';
  let items = []; let sel = 0;
  const hide = () => { box.hidden = true; items = []; };
  const draw = () => {
    box.replaceChildren(...items.map((o, i) => h('div', { class: `ac-i ${i === sel ? 'on' : ''}`, onmousedown: (e) => { e.preventDefault(); pick(i); } },
      h('span', { class: 'ac-v' }, o.label || o.value), o.desc ? h('span', { class: 'ac-d' }, o.desc) : null)));
    box.hidden = !items.length;
  };
  const pick = (i) => { const o = items[i]; if (!o) return; input.value = replace(o, input.value); hide(); if (onPick) onPick(o); input.focus(); };
  const refresh = () => { items = (getOptions(input.value, input) || []).slice(0, limit); sel = 0; draw(); };
  input.addEventListener('input', refresh);
  input.addEventListener('focus', refresh);
  input.addEventListener('blur', () => setTimeout(hide, 120));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'Tab' || (e.key === 'Enter' && items[sel] && input.value.trim() !== (items[sel].value))) { if (e.key === 'Enter' && !items.length) return; pick(sel); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key === 'Escape') hide();
  }, true);
  return wrap;
}

/** Ранжированный поиск по подстроке: префикс выше, затем вхождение. */
function rank(list, text, key = (x) => x.value) {
  const q = text.toLowerCase().trim();
  if (!q) return list;
  const scored = [];
  for (const x of list) {
    const k = String(key(x)).toLowerCase(); const i = k.indexOf(q);
    if (i >= 0) scored.push([i === 0 ? 0 : 1 + i / 100, x]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map((p) => p[1]);
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('cs2ui.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cs2ui.' + k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};

/** Парсер SteamID: 17 цифр, STEAM_0:x:y, [U:1:n], ссылка /profiles/N. */
function parseSteamId(text) {
  const t = String(text || '').trim();
  let m;
  if ((m = /(7656119\d{10})/.exec(t))) return m[1];
  if ((m = /^STEAM_[0-5]:([01]):(\d+)$/i.exec(t))) return String(76561197960265728n + BigInt(m[2]) * 2n + BigInt(m[1]));
  if ((m = /^\[U:1:(\d+)\]$/i.exec(t))) return String(76561197960265728n + BigInt(m[1]));
  return null;
}

// confirm()/alert() тоже переводим
{ const _c = window.confirm.bind(window); window.confirm = (m) => _c(tr(String(m))); const _a = window.alert.bind(window); window.alert = (m) => _a(tr(String(m))); }

// ---------------------------------------------------------------- паутинка (radar / spider chart)
/** axes: [{ label, value (0..1), text }], ref: необязательный контур для сравнения [0..1,...]. Рисует SVG без зависимостей. */
function radar({ axes, ref, title = '', size = 300 }) {
  const NS = 'http://www.w3.org/2000/svg'; const n = axes.length;
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const W = size + 120; const H = size + 50; const cx = W / 2; const cy = H / 2 + 4; const R = size / 2 - 18;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'radar', role: 'img', 'aria-label': `${tr(title || 'Паутинка')}: ${axes.map((a) => `${tr(a.label)} ${a.text}`).join(', ')}` });
  const pt = (i, v) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  for (const k of [0.25, 0.5, 0.75, 1]) el('polygon', { points: axes.map((_a, i) => pt(i, k).join(',')).join(' '), class: 'rd-ring' }, svg);
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 1); el('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'rd-spoke' }, svg);
    const [lx, ly] = pt(i, 1.2); const c = Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / n);
    const t = el('text', { x: lx, y: ly, class: 'rd-label', 'text-anchor': Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end', 'dominant-baseline': 'middle' }, svg);
    const l1 = el('tspan', { x: lx, dy: '-0.35em' }, t); l1.textContent = tr(a.label);
    const l2 = el('tspan', { x: lx, dy: '1.2em', class: 'rd-val' }, t); l2.textContent = a.text;
  });
  const clamp = (v) => Math.min(1, Math.max(0.03, v));
  if (ref) el('polygon', { points: ref.map((v, i) => pt(i, clamp(v)).join(',')).join(' '), class: 'rd-ref' }, svg);
  el('polygon', { points: axes.map((a, i) => pt(i, clamp(a.value)).join(',')).join(' '), class: 'rd-main' }, svg);
  axes.forEach((a, i) => { const [x, y] = pt(i, clamp(a.value)); const d = el('circle', { cx: x, cy: y, r: 3.5, class: 'rd-dot' }, svg); el('title', {}, d).textContent = `${tr(a.label)}: ${a.text}`; });
  return h('div', { class: 'radar-box' }, svg, ref ? h('div', { class: 'muted small radar-legend' }, h('i', { class: 'lg-main' }), tr('Игрок'), h('i', { class: 'lg-ref' }), tr('Средний уровень')) : null);
}
const norm = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, (Number(v) - lo) / (hi - lo))) : 0);
