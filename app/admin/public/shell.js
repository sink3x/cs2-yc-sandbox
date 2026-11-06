'use strict';
// Каркас: навигация, быстрый поиск (Ctrl+K), загрузка данных и запуск панели.

const PAGES = {
  overview: ['🏠 Обзор', pageOverview], skins: ['🎨 Скины', pageSkins], practice: ['🎯 Тренировка и приколы', pagePractice], maps: ['🗺 Карты и режимы', pageMaps],
  console: ['⌨ Консоль', pageConsole], settings: ['⚙ Настройки', pageSettings], plugins: ['🧩 Плагины и флаги', pagePlugins], admins: ['🛡 Админы', pageAdmins],
  look: ['🌈 Оформление', pageLook], backups: ['💾 Бэкапы и логи', pageBackups], help: ['❓ Справка', pageHelp], panel: ['🔑 Панель', pagePanel],
};
const needsState = new Set(['maps', 'settings', 'plugins', 'admins']);
const mainEl = h('main');
const navEl = h('nav');

function go(page) { S.page = page; location.hash = page; renderPage(); }

async function renderPage() {
  navEl.replaceChildren(h('h1', { onclick: () => document.dispatchEvent(new Event('logo-click')), style: 'cursor:pointer', title: 'sandbox-cs-1' }, 'sandbox', h('span', {}, '-cs-1')),
    ...Object.entries(PAGES).map(([k, [t]]) => h('button', { class: S.page === k ? 'on' : '', onclick: () => go(k) }, t)),
    h('div', { class: 'sp' }), h('button', { onclick: openPalette, title: 'Ctrl+K' }, '🔍 Поиск (Ctrl+K)'), h('button', { onclick: async () => { await api('POST', '/logout'); showLogin(); } }, `Выйти (${S.user})`));
  if (needsState.has(S.page) && !S.state) {
    mainEl.replaceChildren(h('div', { class: 'muted' }, 'Загрузка настроек…'));
    try { S.state = await api('GET', '/state'); S.pluginsMeta = S.state.plugins; S.adminFlags = S.state.admin_flags; } catch (e) {
      mainEl.replaceChildren(h('h2', {}, PAGES[S.page][0]), h('div', { class: 'banner' }, `Настройки лежат на сервере CS2. Включите ВМ и дождитесь агента (${e.message}).`)); return;
    }
  }
  if (S.page === 'skins' && !S.state) { try { S.state = await api('GET', '/state'); S.pluginsMeta = S.state.plugins; S.adminFlags = S.state.admin_flags; } catch { /* без ВМ — только каталог */ } }
  if (S.page === 'plugins' && !S.settings) S.settings = await api('GET', '/settings').catch(() => ({ autoStopIdleMinutes: 30, startupGraceMinutes: 20 }));
  mainEl.replaceChildren(PAGES[S.page][1]());
}

// ---------------------------------------------------------------- быстрый поиск
function openPalette() {
  const input = h('input', { type: 'text', placeholder: 'Куда перейти или что выполнить? (скины, карта, bot_add_ct…)', style: 'width:100%', spellcheck: 'false' });
  const list = h('div', { class: 'ac', style: 'position:static;margin-top:6px;max-height:50vh;overflow:auto' });
  let items = []; let sel = 0;
  const all = () => [
    ...Object.entries(PAGES).map(([k, [t]]) => ({ key: `${t} ${k}`, label: `Перейти: ${t}`, run: () => go(k) })),
    ...(S.catalog ? S.catalog.fun : []).filter((f) => !f.secret || secretsOn()).map((f) => ({ key: `прикол ${f.title} ${f.id}`, label: `Прикол: ${f.icon} ${f.title}`, desc: f.note, run: async () => { await api('POST', '/practice', { action: 'fun', id: f.id }); toast(`${f.title} включён`, 's'); } })),
    ...Object.entries(THEMES).filter(([k]) => k !== 'rainbow' || secretsOn()).map(([k, t]) => ({ key: `тема ${t}`, label: `Тема: ${t}`, run: () => saveLook({ auto: false, theme: k }) })),
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
  try { S.user = (await api('GET', '/me')).user; } catch { return showLogin(); }
  S.catalog = await api('GET', '/catalog');
  S.state = null;
  const hash = location.hash.slice(1); if (PAGES[hash]) S.page = hash;
  $app.replaceChildren(h('div', { class: 'shell' }, navEl, h('div', {}, h('div', { style: 'padding:20px 26px 0' }, barEl), mainEl)));
  await loadOverview();
  await renderPage();
  clearInterval(S.pollTimer);
  S.pollTimer = setInterval(loadOverview, 4000);
}
boot();
