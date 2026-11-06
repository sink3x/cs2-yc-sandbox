'use strict';
// Admin panel UI. Vanilla JS, no build step.
const $app = document.getElementById('app');
const h = (tag, props, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cs2panel' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401 && path !== '/me') { showLogin(); throw new Error(path === '/login' ? 'Неверный логин или пароль' : 'Нужен вход'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(ruErr(j.error || r.statusText));
  return j;
}

// Перевод типовых ошибок сервера на русский.
const ERR_RU = [
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
];
function ruErr(m) {
  const t = String(m || '');
  for (const [re, rep] of ERR_RU) if (re.test(t)) return rep.endsWith(': ') ? rep + t.slice(6) : t.replace(re, rep);
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

const S = { user: null, ov: null, page: 'overview', catalog: null, state: null, pluginsMeta: [], adminFlags: [], settings: null, pollTimer: null };

// ---------------------------------------------------------------- login
function showLogin() {
  clearInterval(S.pollTimer);
  const u = h('input', { type: 'text', placeholder: 'Логин', autocomplete: 'username' });
  const p = h('input', { type: 'password', placeholder: 'Пароль', autocomplete: 'current-password' });
  const go = async () => {
    try { await api('POST', '/login', { username: u.value, password: p.value }); await boot(); } catch (e) { toast(e.message, 'e'); }
  };
  p.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' },
    h('h2', {}, 'sandbox-cs-1'), u, p, h('button', { class: 'btn primary', onclick: go }, 'Войти'))));
  u.focus();
}

// ---------------------------------------------------------------- helpers
const fmtStatus = (s) => ({ RUNNING: ['Включена', 'ok'], STOPPED: ['Выключена', ''], STARTING: ['Запускается…', 'warn'], STOPPING: ['Выключается…', 'warn'], PROVISIONING: ['Создаётся…', 'warn'] }[s] || [s || '—', 'bad']);
const pill = (text, kind) => h('span', { class: `pill ${kind || ''}` }, h('i'), text);
const copy = (text) => async () => { try { await navigator.clipboard.writeText(text); toast('Скопировано', 's'); } catch { toast(text); } };
const phaseText = (p) => p && ({ init: 'подготовка', restore: 'восстановление из бэкапа', 'update-game': 'обновление CS2', plugins: 'установка плагинов', configure: 'настройка', starting: 'запуск', failed: 'ошибка' }[p.phase] || p.phase);

async function loadOverview() {
  try { S.ov = await api('GET', '/overview'); } catch (e) { if (e.message !== 'Нужен вход') S.ov = { error: e.message }; }
  if (serverUp() && !S.state && !S.stateTried) {
    S.stateTried = true;
    api('GET', '/state').then((r) => { S.state = r; S.pluginsMeta = r.plugins; S.adminFlags = r.admin_flags; renderBar(); }).catch(() => { S.stateTried = false; });
  }
  renderBar();
  if (S.page === 'overview') renderPage();
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
const fmtNum = (n) => new Intl.NumberFormat('ru-RU').format(n);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Модальное окно. content — узел или массив; возвращает {close}. */
function modal(title, content, buttons = []) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
    h('div', { class: 'modal-h' }, h('b', {}, title), h('button', { class: 'btn', onclick: close, 'aria-label': 'Закрыть' }, '')),
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
