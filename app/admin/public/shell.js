'use strict';
// Каркас: навигация, быстрый поиск (Ctrl+K), загрузка данных и запуск панели.

const PAGES = {
  overview: ['Обзор', pageOverview], skins: ['Скины', pageSkins], practice: ['Тренировка', pagePractice], maps: ['Карты и режимы', pageMaps],
  console: ['Консоль', pageConsole], settings: ['Настройки', pageSettings], plugins: ['Плагины и флаги', pagePlugins], admins: ['Админы', pageAdmins],
  look: ['Оформление', pageLook], stats: ['Статистика', pageStats], profile: ['Профиль', pageProfile], info: ['Сервер', pageInfo], backups: ['Бэкапы и логи', pageBackups], help: ['Справка', pageHelp], panel: ['Панель', pagePanel],
};
const PLAYER_PAGES = new Set(['skins', 'stats', 'info', 'profile', 'look']);
const visiblePages = () => Object.entries(PAGES).filter(([k]) => (S.role === 'player' ? PLAYER_PAGES.has(k) : k !== 'info'));
// Разделы боковой панели: заголовок → страницы (порядок важен).
const NAV_GROUPS = [
  ['Сервер', ['overview', 'info', 'maps', 'settings', 'console']],
  ['Игра', ['practice', 'skins', 'plugins']],
  ['Игроки', ['stats', 'admins']],
  ['Панель и аккаунт', ['profile', 'look', 'panel', 'backups', 'help']],
];
function navSections(vis) {
  const by = new Map(vis); const used = new Set(); const out = [];
  for (const [cap, keys] of NAV_GROUPS) {
    const items = keys.filter((k) => by.has(k)); if (!items.length) continue;
    items.forEach((k) => used.add(k));
    out.push(h('div', { class: 'nav-cap', role: 'presentation' }, h('span', { class: 'lbl' }, cap)));
    items.forEach((k) => out.push(navBtn(k, by.get(k)[0], { class: S.page === k ? 'on' : '', onclick: () => go(k) })));
  }
  for (const [k, v] of vis) if (!used.has(k)) out.push(navBtn(k, v[0], { class: S.page === k ? 'on' : '', onclick: () => go(k) }));
  return out;
}
const needsState = new Set(['maps', 'settings', 'plugins', 'admins']);
const mainEl = h('main');
const navEl = h('nav');
// ---------------------------------------------------------------- иконки (SVG, 24x24, штрих)
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  skins: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.3-9-7.3z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15.5" cy="7.5" r="1"/>',
  practice: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  maps: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
  console: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  settings: '<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>',
  plugins: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  admins: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  look: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  backups: '<rect x="3" y="3" width="18" height="5" rx="1.5"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9.2a3 3 0 0 1 5.8 1c0 2-2.9 2.6-2.9 4.3"/><line x1="12" y1="17.5" x2="12.01" y2="17.5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  stats: '<line x1="5" y1="20" x2="5" y2="11"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="19" y1="20" x2="19" y2="14"/>',
  info: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><line x1="7" y1="7.5" x2="7.01" y2="7.5"/><line x1="7" y1="16.5" x2="7.01" y2="16.5"/>',
  panel: '<circle cx="8" cy="15" r="4.5"/><line x1="11.2" y1="11.8" x2="20" y2="3"/><line x1="16" y1="7" x2="19" y2="10"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><line x1="9" y1="4" x2="9" y2="20"/>',
  logo: '<circle cx="12" cy="12" r="6"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
};
function svgIcon(name, size = 18) {
  const s = h('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return s;
}
const navBtn = (icon, label, props = {}) => h('button', { ...props, 'data-tip': label, 'aria-label': label }, svgIcon(icon), h('span', { class: 'lbl' }, label));

const navCollapsed = () => !!store.get('navCollapsed', false);
function applyNav() { const el = document.querySelector('.shell'); if (el) el.classList.toggle('collapsed', navCollapsed()); }
function toggleNav() { store.set('navCollapsed', !navCollapsed()); applyNav(); hideTip(); renderNavLabels(); }
function renderNavLabels() { const b = document.querySelector('nav .collapse-btn'); if (b) { b.dataset.tip = tr(navCollapsed() ? 'Развернуть меню' : 'Свернуть меню'); b.querySelector('.lbl').textContent = tr('Свернуть меню'); } }

// подсказка у иконки, когда меню свёрнуто (fixed, чтобы не обрезалась прокруткой nav)
const tipEl = h('div', { class: 'tip', role: 'tooltip' });
document.body.append(tipEl);
function showTip(btn) {
  if (!navCollapsed() || window.innerWidth <= 780) return;
  const r = btn.getBoundingClientRect();
  tipEl.textContent = btn.dataset.tip; tipEl.style.top = `${r.top + r.height / 2}px`; tipEl.style.left = `${r.right + 10}px`; tipEl.classList.add('on');
}
function hideTip() { tipEl.classList.remove('on'); }
navEl.addEventListener('mouseover', (e) => { const b = e.target.closest('button[data-tip]'); if (b) showTip(b); });
navEl.addEventListener('mouseout', (e) => { if (e.target.closest('button[data-tip]')) hideTip(); });
navEl.addEventListener('focusin', (e) => { const b = e.target.closest('button[data-tip]'); if (b) showTip(b); });
navEl.addEventListener('focusout', hideTip);
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && S.user) { e.preventDefault(); toggleNav(); } });

function offlineBanner() {
  const st = S.state; if (!st || !st.offline) return null;
  const when = st.savedAt ? ` (копия от ${new Date(st.savedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : '';
  return h('div', { class: 'banner' }, `Сервер CS2 выключен: показаны настройки, сохранённые в панели${when}. Менять их можно уже сейчас — изменения применятся автоматически после запуска сервера.${st.pending ? ` В очереди: ${st.pending}.` : ''}`);
}


function go(page) { S.page = page; location.hash = page; renderPage(); }

async function fetchState() {
  S.state = await api('GET', '/state'); S.pluginsMeta = S.state.plugins; S.adminFlags = S.state.admin_flags;
}
async function renderPage() {
  navEl.replaceChildren(
    h('h1', { onclick: () => { document.dispatchEvent(new Event('logo-click')); const home = S.role === 'player' ? 'skins' : 'overview'; if (S.page !== home) go(home); }, role: 'link', tabindex: '0', style: 'cursor:pointer', 'data-tip': BRAND.name }, brandMark(22) || svgIcon('logo', 20), h('span', { class: 'lbl' }, BRAND.name)),
    ...navSections(visiblePages()),
    h('div', { class: 'sp' }),
    navBtn('search', 'Поиск (Ctrl+K)', { onclick: openPalette }),
    navBtn('logout', `Выйти (${S.display || S.user})`, { onclick: async () => { await api('POST', '/logout'); showLogin(); } }),
    navBtn('sidebar', 'Свернуть меню', { class: 'collapse-btn', onclick: toggleNav }));
  applyNav(); renderNavLabels();
  const wantsState = S.role !== 'player' && (needsState.has(S.page) || S.page === 'skins');
  if (wantsState && (!S.state || S.state.offline)) {
    if (!S.state) mainEl.replaceChildren(h('div', { class: 'muted' }, 'Загрузка настроек…'));
    try { await fetchState(); } catch (e) {
      if (S.page === 'skins') { /* без ВМ — только каталог */ } else {
        mainEl.replaceChildren(h('h2', {}, PAGES[S.page][0]), h('div', { class: 'banner' }, e.message));
        return;
      }
    }
  }
  if (S.page === 'plugins' && !S.settings) S.settings = await api('GET', '/settings').catch(() => ({ autoStopIdleMinutes: 30, startupGraceMinutes: 20 }));
  const page = PAGES[S.page][1]();
  const banner = wantsState ? offlineBanner() : null;
  mainEl.replaceChildren(...(banner ? [banner, page] : [page]));
}

// ---------------------------------------------------------------- быстрый поиск
function openPalette() {
  const input = h('input', { type: 'text', placeholder: 'Куда перейти или что выполнить? (скины, карта, bot_add_ct…)', style: 'width:100%', spellcheck: 'false' });
  const list = h('div', { class: 'ac', style: 'position:static;margin-top:6px;max-height:50vh;overflow:auto' });
  let items = []; let sel = 0;
  const all = () => [
    ...visiblePages().map(([k, [t]]) => ({ key: `${t} ${k}`, label: `Перейти: ${t}`, run: () => go(k) })),
    ...(S.catalog ? S.catalog.fun : []).filter((f) => !f.secret || secretsOn()).map((f) => ({ key: `прикол ${f.title} ${f.id}`, label: `Прикол: ${f.title}`, desc: f.note, run: async () => { await api('POST', '/practice', { action: 'fun', id: f.id }); toast(`${f.title} включён`, 's'); } })),
    ...Object.entries(THEMES).map(([k, t]) => ({ key: `тема ${t}`, label: `Тема: ${t}`, run: () => saveLook({ theme: k }) })),
    ...Object.entries(LANGS).map(([k, t]) => ({ key: `язык language ${t} ${k}`, label: `Язык: ${t}`, run: () => setLang(k) })),
    ...COMMANDS.map(([c, d, a]) => ({ key: `${c} ${d}`, label: `Консоль: ${c}${a ? ' ' + a : ''}`, desc: d, run: async () => { if (a) { sessionStorage.setItem('rconPrefill', `${c} `); go('console'); } else { const r = await api('POST', '/rcon', { command: c }); toast((r.output || '(пусто)').trim().slice(0, 200), 's'); } } })),
  ];
  const draw = () => list.replaceChildren(...items.map((it, i) => h('div', { class: `ac-i ${i === sel ? 'on' : ''}`, onmousedown: (e) => { e.preventDefault(); choose(i); } }, h('span', {}, it.label), it.desc ? h('span', { class: 'ac-d' }, it.desc) : null)));
  const refresh = () => { items = rank(all(), input.value, (x) => x.key).slice(0, 12); sel = 0; draw(); };
  const m = modal('Быстрый поиск', h('div', {}, input, list));
  const choose = async (i) => { const it = items[i]; if (!it) return; m.close(); try { await it.run(); } catch (e) { toast(e.message, 'e'); } };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') choose(sel);
  });
  refresh(); setTimeout(() => input.focus(), 0);
}
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.user) { e.preventDefault(); openPalette(); } });

async function boot() {
  await loadBrand();
  try { const me = await api('GET', '/me'); S.user = me.user; S.display = me.displayName || me.user; S.avatar = me.avatar || ''; S.role = me.role || 'admin'; S.steamid = me.steamid || ''; } catch { return showLogin(); }
  { const sp = new URLSearchParams(location.search).get('steam'); if (sp && STEAM_MSG[sp]) { toast(STEAM_MSG[sp], sp === 'linked' ? 's' : 'e'); history.replaceState(null, '', location.pathname); } }
  if (S.role === 'player') { S.page = 'skins'; S.catalog = { presets: [], maps: [], catalog: [], toggles: [], fun: [] }; } else S.catalog = await api('GET', '/catalog');
  S.state = null;
  const hash = location.hash.slice(1); if (PAGES[hash] && visiblePages().some(([k]) => k === hash)) S.page = hash;
  $app.replaceChildren(h('div', { class: 'shell' }, navEl, h('div', {}, h('div', { style: 'padding:20px 26px 0' }, barEl), mainEl)));
  applyNav();
  await loadOverview();
  await renderPage();
  clearInterval(S.pollTimer);
  S.pollTimer = setInterval(async () => {
    await loadOverview();
    // сервер включился, пока показывалась кэшированная копия настроек: перечитываем (очередь изменений уйдёт на сервер)
    if (S.state && S.state.offline && serverUp()) { S.state = null; S.stateTried = false; if (needsState.has(S.page) || S.page === 'skins') renderPage(); }
  }, 4000);
}
boot();

// PWA: оболочка работает без сети (API не кэшируется)
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
