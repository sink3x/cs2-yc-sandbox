'use strict';
// «Пользователи» (список и карточка: аватар Steam, FACEIT, статистика сервера) и «Сетапы» (cfg, запуск, мышь/DPI, видео).
// Адреса: #users?q=&role=&sort=&page= · #users/<slug> · #setups?scope=&q=&kind=&owner= · #setups/<id>[-название] · #setups/new

const ppDate = (iso) => (iso ? new Date(iso).toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const ppAvatar = (u, size = 40) => (u && u.avatar ? h('img', { class: 'avatar', src: u.avatar, alt: '', width: size, height: size, loading: 'lazy', referrerpolicy: 'no-referrer', style: `width:${size}px;height:${size}px` })
  : h('span', { class: 'avatar ph', style: `width:${size}px;height:${size}px;line-height:${size}px` }, (u && u.displayName ? u.displayName : '?').slice(0, 1).toUpperCase()));
const ppExt = (href, text) => h('a', { class: 'linkchip', href, target: '_blank', rel: 'noopener noreferrer' }, text);
/** Копия в буфер обмена с запасным вариантом для http. */
async function ppCopy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); } catch { const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast(okMsg || tr('Скопировано'), 's');
}
function ppDownload(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/** Параметры адреса без пустых значений: ?a=1&b=2 */
const ppQs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null && !(k === 'page' && Number(v) <= 1)) p.set(k, v); return p; };
const ppApiQs = (p) => { const s = p.toString(); return s ? `?${s}` : ''; };
function ppPager(total, page, limit, onPage) {
  const pages = Math.max(1, Math.ceil(total / limit)); if (pages <= 1) return null;
  return h('div', { class: 'row pager' }, h('button', { class: 'btn', disabled: page <= 1, onclick: () => onPage(page - 1) }, '←'), h('span', { class: 'muted' }, `${page} / ${pages}`), h('button', { class: 'btn', disabled: page >= pages, onclick: () => onPage(page + 1) }, '→'));
}
const ppErr = (title, e) => h('div', {}, h('h2', {}, title), h('div', { class: 'banner' }, tr(e.message)));

// ================================================================== ПОЛЬЗОВАТЕЛИ
function pageUsers() {
  const slug = S.route.slug;
  if (slug) return ppUserCard(slug);
  if (S.role === 'player') { if (S.slug) setTimeout(() => go('users', S.slug), 0); return h('div', { class: 'muted' }, 'Загрузка…'); }
  const q = S.route.qs;
  const f = { q: q.get('q') || '', role: q.get('role') || '', sort: q.get('sort') || 'login', page: Number(q.get('page')) || 1 };
  const list = h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Загрузка…'));
  const qIn = h('input', { type: 'text', value: f.q, placeholder: 'Поиск: имя, SteamID, slug', style: 'width:240px', maxlength: '40' });
  const roleSel = h('select', { onchange: () => { f.role = roleSel.value; f.page = 1; load(); } }, [['', 'Все'], ['admin', 'Админы'], ['player', 'Игроки']].map(([v, t]) => h('option', { value: v, selected: v === f.role }, t)));
  const sortSel = h('select', { onchange: () => { f.sort = sortSel.value; f.page = 1; load(); } }, [['login', 'Последний вход'], ['name', 'Имя'], ['created', 'Регистрация']].map(([v, t]) => h('option', { value: v, selected: v === f.sort }, t)));
  let timer = null; qIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { f.q = qIn.value.trim(); f.page = 1; load(); }, 300); });
  async function load() {
    const qs = ppQs({ q: f.q, role: f.role, sort: f.sort === 'login' ? '' : f.sort, page: f.page });
    routeQuiet('users', '', qs);
    let r; try { r = await api('GET', `/users?${ppQs({ q: f.q, role: f.role, sort: f.sort, page: f.page })}`); } catch (e) { put(list, h('div', { class: 'banner' }, tr(e.message))); return; }
    put(list, h('div', { class: 'muted small' }, `${tr('Найдено')}: ${r.total}`), r.users.length ? h('div', { class: 'ulist' }, r.users.map((u) => h('a', { class: 'urow', href: `#users/${u.slug}`, onclick: (e) => { e.preventDefault(); go('users', u.slug); } },
      ppAvatar(u, 40), h('div', { class: 'grow' }, h('b', {}, u.displayName), h('div', { class: 'muted small' }, u.steamid || tr('Steam не привязан'))),
      h('div', { class: 'row', style: 'gap:6px' }, u.inGameAdmin ? pill('админ в игре', 'ok') : null, pill(u.role === 'admin' ? 'админ панели' : 'игрок', u.role === 'admin' ? 'ok' : ''), h('span', { class: 'muted small' }, ppDate(u.lastLogin)))))) : h('div', { class: 'muted' }, 'Никого не найдено'),
    ppPager(r.total, r.page, r.limit, (p) => { f.page = p; load(); }));
  }
  load();
  return h('div', {}, h('h2', {}, 'Пользователи'), h('div', { class: 'muted small' }, 'Все, кто входил в панель: админы и игроки со Steam. Карточка — по клику; ссылка на неё доступна только тем, у кого есть права.'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, qIn, roleSel, sortSel)), list);
}

function ppUserCard(slug) {
  const root = h('div', {}, h('div', { class: 'muted' }, 'Загрузка…'));
  const back = S.role === 'player' ? null : h('a', { href: '#users', class: 'small', onclick: (e) => { e.preventDefault(); go('users'); } }, '← Все пользователи');
  (async () => {
    let u; try { u = await api('GET', `/users/${encodeURIComponent(slug)}`); } catch (e) { put(root, back, ppErr('Пользователь', e)); return; }
    const me = u.slug === S.slug;
    const faceitBox = h('div', { class: 'card' }, h('h3', {}, 'FACEIT'));
    if (u.faceit) faceitBox.append(...faceitView(u.faceit));
    else faceitBox.append(h('div', { class: 'muted' }, !u.steamid ? 'Steam не привязан — FACEIT показать нельзя.' : u.faceitError ? tr(u.faceitError) : 'Нет данных FACEIT.'));
    const links = [['Профиль Steam', u.steamUrl], ...(u.steamid ? builtinLinks(u.steamid, u.faceit && u.faceit.url).filter(([t]) => !/Steam$|^Профиль Steam$|Мастерская|статус|FACEIT$|рейтинг|Мой профиль/.test(t)) : []), ...((u.links || []).map((l) => [l.title, l.url]))].filter(([, href]) => href);
    put(root, back,
      h('div', { class: 'card ucard' }, h('div', { class: 'row' }, ppAvatar(u, 72), h('div', { class: 'grow' }, h('h2', { style: 'margin:0' }, u.displayName), h('div', { class: 'muted' }, u.name),
        h('div', { class: 'row', style: 'gap:6px;margin-top:6px' }, pill(u.role === 'admin' ? 'админ панели' : 'игрок', u.role === 'admin' ? 'ok' : ''), u.inGameAdmin ? pill('админ в игре', 'ok') : null, me ? pill('это вы', '') : null)),
        h('button', { class: 'btn', onclick: () => ppCopy(`${location.origin}/#users/${u.slug}`, tr('Ссылка скопирована')) }, 'Скопировать ссылку')),
      h('div', { class: 'statgrid' }, [['SteamID64', u.steamid || '—'], ['Регистрация', ppDate(u.created)], ['Последний вход', ppDate(u.lastLogin)], ...(u.email ? [['Почта', u.email]] : [])].map(([k, v]) => h('div', { class: 'stat' }, h('b', { style: 'font-size:14px;word-break:break-all' }, v), h('small', {}, k)))),
      links.length ? h('div', { class: 'links' }, links.map(([t, href]) => ppExt(href, t))) : null),
      faceitBox,
      h('div', { class: 'card' }, h('h3', {}, 'Статистика на сервере'), u.stats ? statCard(u.stats) : h('div', { class: 'muted' }, 'На нашем сервере пока нет данных или сервер выключен.')),
      h('div', { class: 'card' }, h('h3', {}, 'Сетапы'), u.setups.length ? h('div', { class: 'ulist' }, u.setups.map((s) => ppSetupRow(s))) : h('div', { class: 'muted' }, 'Нет доступных сетапов.')));
  })();
  return root;
}

// ================================================================== СЕТАПЫ
const PP_KINDS = [['full', 'Полный'], ['cfg', 'Только cfg'], ['launch', 'Параметры запуска'], ['mouse', 'Мышь и DPI'], ['video', 'Видео']];
const PP_VIS = [['private', 'Только я'], ['users', 'Выбранные пользователи'], ['all', 'Все авторизованные']];
const PP_FILE_HINTS = [['autoexec.cfg', 'Автозапуск: .../Counter-Strike Global Offensive/game/csgo/cfg/autoexec.cfg'], ['cs2_video.txt', 'Видео: Steam/userdata/<ID>/730/local/cfg/cs2_video.txt'], ['cs2_user_convars_0_slot0.vcfg', 'Все настройки игры: Steam/userdata/<ID>/730/local/cfg/']];

function ppSetupRow(s) {
  return h('a', { class: 'urow', href: `#setups/${s.ref}`, onclick: (e) => { e.preventDefault(); go('setups', s.ref); } },
    h('div', { class: 'grow' }, h('b', {}, s.title), h('div', { class: 'muted small' }, [s.owner ? s.owner.displayName : null, s.edpi ? `eDPI ${s.edpi}` : null, s.dpi ? `${s.dpi} DPI` : null, s.resolution, s.files ? `${s.files} ${tr('файл.')}` : null].filter(Boolean).join(' · '))),
    pill(PP_VIS.find(([v]) => v === s.visibility)[1], s.visibility === 'private' ? '' : 'ok'), h('span', { class: 'muted small' }, ppDate(s.updated)));
}

function pageSetups() {
  const slug = S.route.slug;
  if (slug === 'new' || (slug && S.route.qs.get('edit'))) return ppSetupEditor(null);
  if (slug) return ppSetupView(slug);
  const q = S.route.qs;
  const f = { scope: q.get('scope') || 'all', q: q.get('q') || '', kind: q.get('kind') || '', owner: q.get('owner') || '', page: Number(q.get('page')) || 1 };
  const list = h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Загрузка…'));
  const qIn = h('input', { type: 'text', value: f.q, placeholder: 'Поиск по названию', style: 'width:220px', maxlength: '40' });
  const kindSel = h('select', { onchange: () => { f.kind = kindSel.value; f.page = 1; load(); } }, [['', 'Все виды'], ...PP_KINDS].map(([v, t]) => h('option', { value: v, selected: v === f.kind }, t)));
  const tabs = h('div', { class: 'tabs' });
  const drawTabs = () => tabs.replaceChildren(...[['all', 'Все доступные'], ['mine', 'Мои'], ['shared', 'От других']].map(([v, t]) => h('button', { class: f.scope === v ? 'on' : '', onclick: () => { f.scope = v; f.page = 1; load(); } }, t)));
  let timer = null; qIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { f.q = qIn.value.trim(); f.page = 1; load(); }, 300); });
  async function load() {
    drawTabs();
    const qs = ppQs({ scope: f.scope === 'all' ? '' : f.scope, q: f.q, kind: f.kind, owner: f.owner, page: f.page });
    routeQuiet('setups', '', qs);
    let r; try { r = await api('GET', `/setups${ppApiQs(ppQs({ scope: f.scope, q: f.q, kind: f.kind, owner: f.owner, page: f.page }))}`); } catch (e) { put(list, h('div', { class: 'banner' }, tr(e.message))); return; }
    put(list, f.owner ? h('div', { class: 'row' }, pill(tr('Автор:') + ' ' + f.owner, 'ok'), h('button', { class: 'btn', onclick: () => { f.owner = ''; load(); } }, 'Сбросить')) : null,
      r.items.length ? h('div', { class: 'ulist' }, r.items.map((s) => ppSetupRow(s))) : h('div', { class: 'muted' }, 'Сетапов пока нет. Создайте первый — например, со своим autoexec.cfg.'),
      ppPager(r.total, r.page, r.limit, (p) => { f.page = p; load(); }));
  }
  load();
  return h('div', {}, h('h2', {}, 'Сетапы'), h('div', { class: 'muted small' }, 'Свой cfg, параметры запуска, DPI и мышь, видео-настройки. Можно хранить для себя, отправить выбранным людям или открыть всем авторизованным; чужой сетап копируется себе одной кнопкой.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => go('setups', 'new') }, 'Новый сетап')), tabs,
    h('div', { class: 'card' }, h('div', { class: 'row' }, qIn, kindSel)), list);
}

function ppSetupView(ref) {
  const root = h('div', {}, h('div', { class: 'muted' }, 'Загрузка…'));
  const back = h('a', { href: '#setups', class: 'small', onclick: (e) => { e.preventDefault(); go('setups'); } }, '← Все сетапы');
  (async () => {
    let s; try { s = await api('GET', `/setups/${encodeURIComponent(ref)}`); } catch (e) { put(root, back, ppErr('Сетап', e)); return; }
    if (ref !== s.ref) routeQuiet('setups', s.ref, new URLSearchParams());
    const d = s.derived || { found: {}, crosshair: {}, video: {} }; const m = s.mouse || {}; const v = s.video || {};
    const kv = (rows) => h('div', { class: 'statgrid' }, rows.filter(([, x]) => x != null && x !== '' && x !== false).map(([k, x]) => h('div', { class: 'stat' }, h('b', { style: 'font-size:15px;word-break:break-all' }, String(x === true ? '✓' : x)), h('small', {}, k))));
    const copyBox = (title, text) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, title), h('button', { class: 'btn', onclick: () => ppCopy(text) }, 'Копировать')), h('pre', { class: 'cfgview' }, text));
    put(root, back,
      h('div', { class: 'card' }, h('div', { class: 'row' }, s.owner ? ppAvatar(s.owner, 40) : null, h('div', { class: 'grow' }, h('h2', { style: 'margin:0' }, s.title), h('div', { class: 'muted small' }, `${s.owner ? s.owner.displayName : '—'} · ${ppDate(s.updated)}`)),
        pill(PP_VIS.find(([x]) => x === s.visibility)[1], s.visibility === 'private' ? '' : 'ok')),
        h('div', { class: 'row', style: 'margin-top:10px' },
          s.mine ? h('button', { class: 'btn primary', onclick: () => go('setups', s.ref, 'edit=1') }, 'Изменить') : h('button', { class: 'btn primary', onclick: act(async () => { const c = await api('POST', `/setups/${s.ref}/copy`, {}); go('setups', c.ref); }, tr('Скопировано в ваши сетапы')) }, 'Скопировать себе'),
          h('button', { class: 'btn', onclick: () => ppCopy(`${location.origin}/#setups/${s.ref}`, tr('Ссылка скопирована')) }, 'Скопировать ссылку'),
          s.owner ? h('a', { class: 'btn', href: `#users/${s.owner.slug}`, onclick: (e) => { e.preventDefault(); go('users', s.owner.slug); } }, 'Профиль автора') : null,
          s.mine ? h('button', { class: 'btn danger', onclick: act(async () => { if (!confirm(tr('Удалить сетап?'))) return; await api('DELETE', `/setups/${s.ref}`); go('setups'); }) }, 'Удалить') : null)),
      h('div', { class: 'card' }, h('h3', {}, 'Мышь и видео'), kv([['Мышь', m.model], ['DPI', m.dpi], ['Чувствительность', m.sens != null ? m.sens : d.found.sensitivity], ['eDPI', d.edpi], ['Zoom-чувств.', m.zoomSens != null ? m.zoomSens : d.found.zoom_sensitivity_ratio],
        ['Polling, Гц', m.pollingHz], ['Raw input', m.rawInput === true ? true : (d.found.m_rawinput === '1' ? true : null)], ['Windows, 1–11', m.windowsSens], ['Разрешение', v.resolution], ['Формат', v.aspect], ['Режим', v.mode ? { fullscreen: 'Полный экран', windowed: 'Окно', borderless: 'Без рамки' }[v.mode] : ''], ['Частота, Гц', v.refreshHz], ['fps_max', d.found.fps_max]]),
        v.notes ? h('div', { class: 'muted pre-wrap' }, v.notes) : null),
      s.launch ? copyBox(tr('Параметры запуска'), s.launch) : null,
      s.crosshair ? copyBox(tr('Код прицела'), s.crosshair) : null,
      Object.keys(d.video || {}).length ? h('div', { class: 'card' }, h('h3', {}, 'Из cs2_video.txt'), kv(Object.entries(d.video).slice(0, 24).map(([k, x]) => [k, x]))) : null,
      s.notes ? h('div', { class: 'card' }, h('h3', {}, 'Заметки'), h('div', { class: 'pre-wrap' }, s.notes)) : null,
      ...(s.files || []).map((fl) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, fl.name), h('span', { class: 'muted small' }, `${fl.text.length} ${tr('симв.')}`),
        h('button', { class: 'btn', onclick: () => ppCopy(fl.text) }, 'Копировать'), h('button', { class: 'btn', onclick: () => ppDownload(fl.name, fl.text) }, 'Скачать')), h('pre', { class: 'cfgview' }, fl.text))),
      (s.files || []).length > 1 ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => s.files.forEach((fl) => ppDownload(fl.name, fl.text)) }, 'Скачать все файлы')) : null);
  })();
  return root;
}

function ppSetupEditor(existingRef) {
  const root = h('div', {}, h('div', { class: 'muted' }, 'Загрузка…'));
  (async () => {
    const ref = existingRef || (S.route.qs.get('edit') ? S.route.slug : null);
    let s = { title: '', kind: 'full', visibility: 'private', sharedWith: [], mouse: {}, video: {}, launch: '', crosshair: '', notes: '', files: [] };
    let people = [];
    try { if (ref) s = await api('GET', `/setups/${encodeURIComponent(ref)}`); people = (await api('GET', '/people')).users; } catch (e) { put(root, ppErr('Сетап', e)); return; }
    if (ref && !s.mine) { put(root, ppErr('Сетап', new Error('Менять сетап может только владелец'))); return; }
    const inp = (val, ph, w = 130, type = 'text') => h('input', { type, value: val == null ? '' : val, placeholder: ph, style: `width:${w}px` });
    const title = inp(s.title, 'Название', 280); title.maxLength = 60;
    const kind = h('select', {}, PP_KINDS.map(([x, t]) => h('option', { value: x, selected: x === s.kind }, t)));
    const vis = h('select', { onchange: () => { shareBox.hidden = vis.value !== 'users'; } }, PP_VIS.map(([x, t]) => h('option', { value: x, selected: x === s.visibility }, t)));
    const shared = new Set(s.sharedWith || []);
    const shareBox = h('div', { class: 'chips', hidden: s.visibility !== 'users' }, people.filter((p) => p.slug !== S.slug).map((p) => { const c = h('button', { class: `chip ${shared.has(p.slug) ? 'on' : ''}`, onclick: () => { if (shared.has(p.slug)) shared.delete(p.slug); else shared.add(p.slug); c.classList.toggle('on'); } }, p.displayName); return c; }));
    const m = s.mouse || {}; const v = s.video || {};
    const mouse = { model: inp(m.model, 'Мышь (модель)', 180), dpi: inp(m.dpi, 'DPI', 90, 'number'), sens: inp(m.sens, 'sens', 80, 'number'), zoomSens: inp(m.zoomSens, 'zoom', 80, 'number'), pollingHz: inp(m.pollingHz, 'Гц', 80, 'number'), windowsSens: inp(m.windowsSens, 'Win 1–11', 90, 'number') };
    const raw = h('input', { type: 'checkbox', checked: m.rawInput === true });
    const res = inp(v.resolution, '1920x1080', 110); const aspect = h('select', {}, [['', 'Формат'], '16:9', '16:10', '4:3', '5:4'].map((x) => (Array.isArray(x) ? h('option', { value: x[0] }, x[1]) : h('option', { value: x, selected: x === v.aspect }, x))));
    const mode = h('select', {}, [['', 'Режим'], ['fullscreen', 'Полный экран'], ['windowed', 'Окно'], ['borderless', 'Без рамки']].map(([x, t]) => h('option', { value: x, selected: x === v.mode }, t)));
    const hz = inp(v.refreshHz, 'Гц', 80, 'number'); const vnotes = h('textarea', { rows: '2', placeholder: 'Видео: яркость, шейдеры, MSAA, заметки', style: 'width:100%' }); vnotes.value = v.notes || '';
    const launch = h('textarea', { rows: '2', placeholder: '-novid -high +fps_max 0 -threads 8', style: 'width:100%', maxlength: '400' }); launch.value = s.launch || '';
    const cross = inp(s.crosshair, 'Код прицела CSGO-xxxxx-…', 300);
    const notes = h('textarea', { rows: '3', placeholder: 'Заметки: откуда настройки, что менялось', style: 'width:100%' }); notes.value = s.notes || '';
    const files = (s.files || []).map((x) => ({ ...x })); const filesBox = h('div');
    const drawFiles = () => filesBox.replaceChildren(...files.map((fl, i) => {
      const ta = h('textarea', { rows: '8', class: 'mono', style: 'width:100%', spellcheck: 'false', oninput: () => { fl.text = ta.value; } }); ta.value = fl.text;
      return h('div', { class: 'card sub' }, h('div', { class: 'row' }, h('input', { type: 'text', value: fl.name, style: 'width:260px', oninput: (e) => { fl.name = e.target.value; } }), h('span', { class: 'muted small' }, PP_FILE_HINTS.find(([n]) => n === fl.name) ? PP_FILE_HINTS.find(([n]) => n === fl.name)[1] : ''),
        h('button', { class: 'btn danger', onclick: () => { files.splice(i, 1); drawFiles(); } }, 'Убрать')), ta);
    }));
    drawFiles();
    const addFile = (name, text = '') => { if (files.length >= 5) { toast(tr('Не больше 5 файлов'), 'e'); return; } files.push({ name, text }); drawFiles(); };
    const picker = h('input', { type: 'file', accept: '.cfg,.txt,.vcfg,.json', multiple: true, hidden: true, onchange: async () => { for (const fl of picker.files) { if (fl.size > 64 * 1024) { toast(`${fl.name}: ${tr('больше 64 КБ')}`, 'e'); continue; } addFile(fl.name.replace(/[^\w.-]/g, '_'), await fl.text()); } picker.value = ''; } });
    const body = () => ({
      title: title.value, kind: kind.value, visibility: vis.value, sharedWith: [...shared], launch: launch.value, crosshair: cross.value, notes: notes.value, files,
      mouse: { model: mouse.model.value, dpi: mouse.dpi.value, sens: mouse.sens.value, zoomSens: mouse.zoomSens.value, pollingHz: mouse.pollingHz.value, windowsSens: mouse.windowsSens.value, rawInput: raw.checked ? true : null },
      video: { resolution: res.value.trim(), aspect: aspect.value, mode: mode.value, refreshHz: hz.value, notes: vnotes.value },
    });
    const save = act(async () => { const r = ref ? await api('PUT', `/setups/${s.ref}`, body()) : await api('POST', '/setups', body()); go('setups', r.ref); }, tr('Сохранено'));
    put(root, h('a', { href: '#setups', class: 'small', onclick: (e) => { e.preventDefault(); go('setups'); } }, '← Все сетапы'), h('h2', {}, ref ? 'Изменить сетап' : 'Новый сетап'),
      h('div', { class: 'card' }, h('div', { class: 'row' }, title, kind), h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'muted' }, 'Кому виден:'), vis), shareBox,
        h('div', { class: 'muted small' }, 'Владелец и админы панели видят любые сетапы; «Только я» скрывает от остальных игроков.')),
      h('div', { class: 'card' }, h('h3', {}, 'Мышь'), h('div', { class: 'row' }, mouse.model, mouse.dpi, mouse.sens, mouse.zoomSens, mouse.pollingHz, mouse.windowsSens, h('label', { class: 'row' }, raw, 'Raw input')),
        h('div', { class: 'muted small' }, 'eDPI = DPI × sens считается автоматически; если sens не указан, берём sensitivity из cfg.')),
      h('div', { class: 'card' }, h('h3', {}, 'Видео'), h('div', { class: 'row' }, res, aspect, mode, hz), vnotes),
      h('div', { class: 'card' }, h('h3', {}, 'Параметры запуска Steam'), launch, h('div', { class: 'muted small' }, 'Steam → Counter-Strike 2 → Свойства → Параметры запуска.'), h('h3', {}, 'Прицел'), cross),
      h('div', { class: 'card' }, h('h3', {}, 'Файлы и слепок настроек'), h('div', { class: 'muted small' }, 'Вставьте содержимое или загрузите файл (до 5 файлов по 64 КБ): autoexec.cfg, cs2_video.txt, cs2_user_convars_0_slot0.vcfg. Файлы только хранятся и показываются — панель их не запускает.'),
        filesBox, h('div', { class: 'row', style: 'margin-top:8px' }, PP_FILE_HINTS.map(([n]) => h('button', { class: 'btn', onclick: () => addFile(n) }, `+ ${n}`)), h('button', { class: 'btn', onclick: () => picker.click() }, 'Загрузить файл…'), picker)),
      h('div', { class: 'card' }, h('h3', {}, 'Заметки'), notes),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Сохранить'), h('button', { class: 'btn', onclick: () => go('setups', ref ? s.ref : '') }, 'Отмена')));
  })();
  return root;
}
