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
  for (const c of children.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cs2panel' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401 && path !== '/me') { showLogin(); throw new Error('Нужен вход'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
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
  renderBar();
  if (S.page === 'overview') renderPage();
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
  if (o.vm && o.vm.publicIp) kids.push(h('button', { class: 'chip', onclick: copy(`connect ${o.vm.publicIp}:27015`) }, `connect ${o.vm.publicIp}:27015`));
  if (o.error || o.vmError) kids.push(h('span', { class: 'bad small' }, o.error || o.vmError));
  barEl.replaceChildren(...kids);
}

// ---------------------------------------------------------------- pages
function pageOverview() {
  const o = S.ov;
  if (!o) return h('div', { class: 'muted' }, 'Загрузка…');
  const vm = o.vm || {};
  const srv = o.server;
  const live = srv && srv.live;
  const running = vm.status === 'RUNNING';
  const mapSel = h('select', {}, (S.catalog ? S.catalog.maps : []).concat((S.state && S.state.state.maps) || []).map((m) => h('option', { value: m.id, selected: live && live.map === m.id }, `${m.label} (${m.id})`)));
  const idle = o.idleSince ? Math.max(0, Math.round((Date.now() - Date.parse(o.idleSince)) / 60000)) : null;
  return h('div', {},
    h('h2', {}, 'Обзор'),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('h3', {}, 'Виртуальная машина'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Имя'), h('dd', {}, vm.name || '—'),
          h('dt', {}, 'Статус'), h('dd', {}, fmtStatus(vm.status)[0]),
          h('dt', {}, 'Публичный IP'), h('dd', {}, vm.publicIp || '—'),
          h('dt', {}, 'Конфигурация'), h('dd', {}, vm.cores ? `${vm.cores} vCPU · ${vm.memoryGb} ГБ · ${vm.platform}` : '—')),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', disabled: vm.status !== 'STOPPED' || !!o.busy, onclick: act(async () => { await api('POST', '/vm/start'); await loadOverview(); }, 'Запуск ВМ начат') }, '▶ Включить сервер'),
          h('button', { class: 'btn danger', disabled: vm.status !== 'RUNNING' || !!o.busy, onclick: act(async () => { if (!confirm('Выключить сервер? Игроки будут отключены, данные сохранятся.')) return; await api('POST', '/vm/stop'); await loadOverview(); }, 'Останавливаю: бэкап и выключение ВМ') }, '■ Выключить сервер')),
        o.settings && o.settings.autoStopIdleMinutes ? h('div', { class: 'muted small' }, `Автовыключение: через ${o.settings.autoStopIdleMinutes} мин без игроков${idle !== null ? ` (пусто уже ${idle} мин)` : ''}`) : h('div', { class: 'muted small' }, 'Автовыключение отключено'),
        o.lastError ? h('div', { class: 'bad small' }, o.lastError) : null,
        h('div', { class: 'muted small' }, 'Выключенная ВМ не тарифицируется по CPU/RAM; диск и статический IP продолжают стоить копейки.')),
      h('div', { class: 'card' }, h('h3', {}, 'Сервер CS2'),
        !running ? h('div', { class: 'muted' }, 'ВМ выключена.')
          : !srv ? h('div', { class: 'warn' }, o.agentError ? `Агент недоступен: ${o.agentError}` : 'Агент загружается…')
            : h('div', {},
              h('dl', { class: 'kv' },
                h('dt', {}, 'Сервис'), h('dd', {}, `${srv.service.active}/${srv.service.sub}${srv.phase && srv.service.active !== 'active' ? ` · ${phaseText(srv.phase)}` : ''}`),
                h('dt', {}, 'Карта'), h('dd', {}, live ? live.map : '—'),
                h('dt', {}, 'Игроки'), h('dd', {}, live ? `${live.humans} + ${live.bots} ботов из ${live.maxPlayers || '?'}` : '—'),
                h('dt', {}, 'Версия игры'), h('dd', {}, srv.gameVersion || '—'),
                h('dt', {}, 'Нагрузка'), h('dd', {}, `${srv.load.join(' / ')} · своб. RAM ${srv.memory.freeMb} МБ`),
                h('dt', {}, 'Диск данных'), h('dd', {}, srv.disk ? `свободно ${srv.disk.freeGb} из ${srv.disk.totalGb} ГБ` : '—')),
              h('div', { class: 'row' },
                h('button', { class: 'btn', onclick: act(() => api('POST', '/service/restart'), 'CS2 перезапускается') }, '↻ Перезапустить CS2'),
                h('button', { class: 'btn', onclick: act(() => api('POST', '/service/stop'), 'CS2 остановлен') }, 'Стоп'),
                h('button', { class: 'btn', onclick: act(() => api('POST', '/service/start'), 'CS2 запускается') }, 'Старт')),
              live ? h('div', { class: 'row' }, mapSel, h('button', { class: 'btn', onclick: act(() => api('POST', '/map', { map: mapSel.value }), 'Смена карты') }, 'Сменить карту')) : null))));
}

function pageConsole() {
  const out = h('div', { class: 'console' });
  const hist = JSON.parse(sessionStorage.getItem('rconHist') || '[]'); let hi = hist.length;
  const input = h('input', { type: 'text', placeholder: 'rcon команда, например: status', style: 'flex:1' });
  const print = (t, cls) => { out.append(h('div', { class: cls || '' }, t)); out.scrollTop = out.scrollHeight; };
  const run = async (cmd) => {
    if (!cmd.trim()) return;
    hist.push(cmd); sessionStorage.setItem('rconHist', JSON.stringify(hist.slice(-50))); hi = hist.length;
    print(`> ${cmd}`, 'cmd');
    try { const r = await api('POST', '/rcon', { command: cmd }); print((r.output || '').trim() || '(пусто)'); } catch (e) { print(e.message, 'bad'); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { run(input.value); input.value = ''; }
    if (e.key === 'ArrowUp' && hi > 0) { hi -= 1; input.value = hist[hi]; }
    if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; }
  });
  const quick = ['status', 'css_plugins list', 'meta list', 'css_plugins reload WeaponPaints', 'mp_restartgame 1', 'bot_kick', 'bot_add_ct', 'bot_add_t', 'sv_cheats 1', 'noclip', 'mp_warmup_end', 'exec sandbox/overrides.cfg'];
  return h('div', {}, h('h2', {}, 'Консоль RCON'),
    !serverUp() ? h('div', { class: 'banner' }, 'Сервер CS2 сейчас не отвечает: включите ВМ и дождитесь запуска.') : null,
    out, h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: () => { run(input.value); input.value = ''; } }, 'Отправить')),
    h('div', { class: 'chips' }, quick.map((q) => h('span', { class: 'chip', onclick: () => run(q) }, q))));
}

function pageMaps() {
  const st = S.state.state;
  const custom = h('input', { type: 'text', placeholder: 'de_xxx или ID воркшоп-карты', style: 'width:260px' });
  const label = h('input', { type: 'text', placeholder: 'Название (необязательно)', style: 'width:220px' });
  const restart = h('input', { type: 'checkbox', checked: true });
  const mapSel = h('select', {}, S.catalog.maps.concat(st.maps).map((m) => h('option', { value: m.id, selected: m.id === st.server.map }, `${m.label} (${m.id})`)));
  const presets = Object.entries(S.catalog.presets).map(([k, p]) => h('button', { class: `btn preset ${st.server.preset === k ? 'on' : ''}`, onclick: act(async () => {
    if (!confirm(`Применить режим «${p.label}»? Настройки cvar будут заменены пресетом.`)) return;
    await api('POST', '/preset', { preset: k, map: mapSel.value, restart: restart.checked });
    S.state = await api('GET', '/state'); renderPage();
  }, 'Режим применён') }, h('b', {}, p.label), h('span', { class: 'muted small' }, p.note || `game_type ${p.gameType} / game_mode ${p.gameMode}`)));
  const maps = S.catalog.maps.concat(st.maps).map((m) => h('button', { class: 'btn', title: m.id, onclick: act(() => api('POST', '/map', { map: m.id }), `Загружаю ${m.id}`) }, m.label));
  return h('div', {}, h('h2', {}, 'Карты и режимы'),
    h('div', { class: 'card' }, h('h3', {}, 'Режим игры'),
      h('div', { class: 'row' }, 'Карта при старте:', mapSel, h('label', { class: 'switch' }, restart, 'сразу перезапустить CS2 (чистое применение)')),
      h('div', { class: 'grid' }, presets),
      h('div', { class: 'muted small' }, `Сейчас: пресет «${st.server.preset}», game_type ${st.server.gameType} / game_mode ${st.server.gameMode}, карта ${st.server.map}`)),
    h('div', { class: 'card' }, h('h3', {}, 'Сменить карту сейчас'), h('div', { class: 'maps' }, maps),
      h('div', { class: 'row' }, custom, label,
        h('button', { class: 'btn', onclick: act(() => api('POST', '/map', { map: custom.value.trim() }), 'Карта загружается') }, 'Загрузить'),
        h('button', { class: 'btn', onclick: act(async () => {
          const id = custom.value.trim(); if (!id) return;
          const maps2 = st.maps.filter((m) => m.id !== id).concat([{ id, label: label.value.trim() || id }]);
          S.state = await api('PUT', '/state', { state: { maps: maps2 } }); renderPage();
        }, 'Добавлено в список') }, '＋ В список')),
      h('div', { class: 'muted small' }, 'Воркшоп-карты: нужен Steam Web API ключ в секретах (-authkey), иначе скачивание не сработает.'),
      st.maps.length ? h('div', { class: 'chips' }, st.maps.map((m) => h('span', { class: 'chip', title: 'Удалить из списка', onclick: act(async () => { S.state = await api('PUT', '/state', { state: { maps: st.maps.filter((x) => x.id !== m.id) } }); renderPage(); }) }, `${m.label} ✕`))) : null));
}

function pageSettings() {
  const st = S.state.state;
  const inputs = {};
  const sv = {
    hostname: h('input', { type: 'text', value: st.server.hostname, maxlength: 64 }),
    maxPlayers: h('input', { type: 'number', value: st.server.maxPlayers, min: 2, max: 64 }),
    password: h('input', { type: 'text', value: st.server.password, placeholder: 'пусто = без пароля' }),
    extraArgs: h('input', { type: 'text', value: st.server.extraArgs, placeholder: 'доп. аргументы запуска', style: 'width:100%' }),
  };
  const field = (it) => {
    const cur = st.cvars[it.name];
    let el;
    if (it.type === 'bool') el = h('select', {}, ['', '0', '1'].map((v) => h('option', { value: v, selected: (cur ?? '') === v }, v === '' ? '— по умолчанию' : v === '1' ? 'вкл (1)' : 'выкл (0)')));
    else if (it.type.startsWith('enum:')) el = h('select', {}, [''].concat(it.type.slice(5).split('|')).map((v) => h('option', { value: v, selected: (cur ?? '') === v }, v === '' ? '— по умолчанию' : v)));
    else el = h('input', { type: 'text', value: cur ?? '', placeholder: 'по умолчанию' });
    inputs[it.name] = el;
    return [h('label', {}, it.name, h('small', {}, it.hint)), el];
  };
  const catalogNames = new Set(S.catalog.catalog.flatMap((g) => g.items.map((i) => i.name)));
  const extra = Object.entries(st.cvars).filter(([k]) => !catalogNames.has(k));
  const rawName = h('input', { type: 'text', placeholder: 'имя cvar' }); const rawVal = h('input', { type: 'text', placeholder: 'значение' });
  const extraBox = h('div', { class: 'cv' }, extra.map(([k, v]) => [h('label', {}, k), (inputs[k] = h('input', { type: 'text', value: v }))]));
  const collect = () => {
    const cvars = {};
    for (const [k, el] of Object.entries(inputs)) if (el.value !== '') cvars[k] = el.value;
    if (rawName.value.trim() && rawVal.value !== '') cvars[rawName.value.trim()] = rawVal.value;
    return cvars;
  };
  const save = async (live) => {
    S.state = await api('PUT', '/state', { state: { server: { hostname: sv.hostname.value, maxPlayers: Number(sv.maxPlayers.value), password: sv.password.value, extraArgs: sv.extraArgs.value, preset: 'custom' }, cvars: collect() } });
    if (live) { const r = await api('POST', '/apply-live'); const errs = r.results.filter((x) => /unknown|error/i.test(x.output)); if (errs.length) toast(`Не приняты: ${errs.map((e) => e.cmd.split(' ')[0]).join(', ')}`, 'e'); }
    renderPage();
  };
  return h('div', {}, h('h2', {}, 'Настройки сервера'),
    h('div', { class: 'card' }, h('h3', {}, 'Сервер'),
      h('dl', { class: 'kv' }, h('dt', {}, 'Имя'), h('dd', {}, sv.hostname), h('dt', {}, 'Слотов'), h('dd', {}, sv.maxPlayers), h('dt', {}, 'Пароль входа'), h('dd', {}, sv.password), h('dt', {}, 'Доп. аргументы'), h('dd', {}, sv.extraArgs)),
      h('div', { class: 'muted small' }, 'Имя, слоты и аргументы применяются после перезапуска CS2.')),
    S.catalog.catalog.map((g) => h('div', { class: 'card' }, h('h3', {}, g.group), h('div', { class: 'cv' }, g.items.map(field)))),
    extra.length ? h('div', { class: 'card' }, h('h3', {}, 'Свои cvar'), extraBox) : null,
    h('div', { class: 'card' }, h('h3', {}, 'Добавить cvar'), h('div', { class: 'row' }, rawName, rawVal)),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: act(() => save(true), 'Сохранено и применено') }, 'Сохранить и применить сейчас'),
      h('button', { class: 'btn', onclick: act(() => save(false), 'Сохранено (применится при следующем старте карты)') }, 'Только сохранить')),
    h('div', { class: 'muted small' }, 'Пустое поле = cvar не переопределяется. Настройки хранятся на диске данных и восстанавливаются при каждом запуске.'));
}

function pagePlugins() {
  const st = S.state.state;
  const inst = (S.ov && S.ov.server && S.ov.server.installed) || {};
  const sets = S.settings || {};
  const idleMin = h('input', { type: 'number', min: 0, max: 1440, value: sets.autoStopIdleMinutes, style: 'width:90px' });
  const graceMin = h('input', { type: 'number', min: 0, max: 1440, value: sets.startupGraceMinutes, style: 'width:90px' });
  const boxes = {};
  const rows = S.pluginsMeta.filter((p) => !p.dependency).map((p) => {
    const cb = h('input', { type: 'checkbox', checked: st.plugins[p.id] }); boxes[p.id] = cb;
    const i = inst[p.id];
    return h('tr', {}, h('td', {}, h('label', { class: 'switch' }, cb, h('b', {}, p.title))),
      h('td', { class: 'muted' }, p.desc, p.risky ? h('div', { class: 'warn small' }, '⚠ может привести к блокировке GSLT-токена (правила Valve для серверов)') : null),
      h('td', { class: 'small' }, i ? i.tag : h('span', { class: 'muted' }, 'не установлен')));
  });
  const flags = {};
  const flagDefs = [['autoUpdateGame', 'Обновлять CS2 при каждом запуске ВМ'], ['autoUpdatePlugins', 'Обновлять Metamod/CounterStrikeSharp/плагины при запуске'], ['insecure', 'Запуск с -insecure (отключает VAC на сервере)']];
  const flagRows = flagDefs.map(([k, t]) => { flags[k] = h('input', { type: 'checkbox', checked: st.flags[k] }); return h('div', { class: 'row' }, h('label', { class: 'switch' }, flags[k], t)); });
  return h('div', {}, h('h2', {}, 'Плагины и фича-флаги'),
    h('div', { class: 'card' }, h('h3', {}, 'Плагины'), h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Плагин'), h('th', {}, 'Описание'), h('th', {}, 'Версия'))), h('tbody', {}, rows)),
      h('div', { class: 'muted small' }, 'Включение и выключение применяется после перезапуска CS2. Зависимости (MenuManager и др.) ставятся автоматически.')),
    h('div', { class: 'card' }, h('h3', {}, 'Флаги'), flagRows),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: act(async () => {
        const plugins = {}; for (const [k, el] of Object.entries(boxes)) plugins[k] = el.checked;
        const f = {}; for (const [k, el] of Object.entries(flags)) f[k] = el.checked;
        const r = await api('PUT', '/state', { state: { plugins, flags: f } }); S.state = r;
        if (r.needsRestart && confirm('Изменения вступят в силу после перезапуска CS2. Перезапустить сейчас?')) await api('POST', '/service/restart');
        renderPage();
      }, 'Сохранено') }, 'Сохранить'),
      h('button', { class: 'btn', onclick: act(async () => { if (confirm('Обновить игру и плагины сейчас? CS2 перезапустится (несколько минут).')) await api('POST', '/update'); }, 'Обновление запущено') }, '⟳ Обновить игру и плагины сейчас')),
    h('div', { class: 'card' }, h('h3', {}, 'Экономия: автовыключение ВМ'),
      h('div', { class: 'row' }, 'Выключать ВМ, если игроков нет', idleMin, 'мин (0 = никогда)'),
      h('div', { class: 'row' }, 'Не выключать первые', graceMin, 'мин после запуска ВМ'),
      h('button', { class: 'btn', onclick: act(async () => { S.settings = await api('PUT', '/settings', { autoStopIdleMinutes: Number(idleMin.value), startupGraceMinutes: Number(graceMin.value) }); }, 'Сохранено') }, 'Сохранить')));
}

function pageAdmins() {
  const st = S.state.state;
  let list = st.admins.map((a) => ({ ...a, flags: [...a.flags] }));
  const box = h('div');
  const draw = () => {
    const head = h('tr', {}, h('th', {}, 'Имя'), h('th', {}, 'SteamID64'), h('th', {}, 'Права'), h('th', {}));
    const rows = list.map((a, idx) => {
      const flagSel = h('div', { class: 'chips' }, S.adminFlags.map((f) => { const on = a.flags.includes(f); return h('span', { class: 'chip', style: on ? 'border-color:var(--accent);color:var(--accent)' : '', onclick: () => { a.flags = on ? a.flags.filter((x) => x !== f) : a.flags.concat([f]); draw(); } }, f.replace('@css/', '')); }));
      return h('tr', {}, h('td', {}, h('input', { type: 'text', value: a.name, style: 'width:140px', oninput: (e) => { a.name = e.target.value; } })),
        h('td', {}, h('input', { type: 'text', value: a.steamid, style: 'width:180px', oninput: (e) => { a.steamid = e.target.value.trim(); } })), h('td', {}, flagSel),
        h('td', {}, h('button', { class: 'btn danger', onclick: () => { list.splice(idx, 1); draw(); } }, '✕')));
    });
    box.replaceChildren(h('table', {}, h('thead', {}, head), h('tbody', {}, rows)));
  };
  draw();
  return h('div', {}, h('h2', {}, 'Админы сервера'),
    h('div', { class: 'card' }, box, h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { list.push({ name: 'new', steamid: '', flags: ['@css/root'] }); draw(); } }, '＋ Добавить'),
      h('button', { class: 'btn primary', onclick: act(async () => { S.state = await api('PUT', '/state', { state: { admins: list } }); try { await api('POST', '/rcon', { command: 'css_plugins reload MatchZy' }); } catch { /* server offline */ } renderPage(); }, 'Админы сохранены') }, 'Сохранить')),
      h('div', { class: 'muted small' }, 'root даёт все права: !map, !rcon, !kick, !ban, !cvar и т.д. (CounterStrikeSharp) и все админ-команды MatchZy. Изменения читаются при смене карты или перезапуске.')));
}

function pageBackups() {
  const listBox = h('div'); const logBox = h('div', { class: 'console logbox' }); const unit = h('select', {}, ['cs2', 'cs2-agent', 'mariadb'].map((u) => h('option', { value: u }, u)));
  const loadList = async () => {
    try {
      const r = await api('GET', '/backups');
      listBox.replaceChildren(r.backups.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Бэкап'), h('th', {}, 'Размер'), h('th', {}))), h('tbody', {}, r.backups.map((b) => h('tr', {}, h('td', {}, b.key.replace('cs2/', '')), h('td', {}, `${Math.round(b.size / 1024)} КБ`),
        h('td', {}, h('button', { class: 'btn danger', onclick: act(async () => { if (confirm(`Восстановить ${b.key}? CS2 остановится, конфиги и БД скинов будут заменены.`)) await api('POST', '/restore', { key: b.key }); }, 'Восстановление запущено') }, 'Восстановить')))))) : h('div', { class: 'muted' }, 'Бэкапов пока нет.'));
    } catch (e) { listBox.replaceChildren(h('div', { class: 'warn' }, `Нет связи с агентом: ${e.message}`)); }
  };
  const loadLogs = async () => { try { const r = await api('GET', `/logs?unit=${unit.value}&n=300`); logBox.textContent = r.text || '(пусто)'; logBox.scrollTop = logBox.scrollHeight; } catch (e) { logBox.textContent = e.message; } };
  setTimeout(() => { loadList(); loadLogs(); }, 0);
  return h('div', {}, h('h2', {}, 'Бэкапы и логи'),
    h('div', { class: 'card' }, h('h3', {}, 'Бэкапы (Object Storage)'), listBox,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: act(async () => { await api('POST', '/backup'); await sleep(4000); await loadList(); }, 'Бэкап создаётся') }, 'Сделать бэкап сейчас')),
      h('div', { class: 'muted small' }, 'В бэкап входят: настройки панели, конфиги CS2/плагинов, база скинов. Сам CS2 (≈60 ГБ) лежит на постоянном диске. Бэкап делается автоматически при выключении и каждую ночь.')),
    h('div', { class: 'card' }, h('h3', {}, 'Логи'), h('div', { class: 'row' }, unit, h('button', { class: 'btn', onclick: loadLogs }, 'Обновить')), logBox));
}

function pagePanel() {
  const o = h('input', { type: 'password', placeholder: 'Текущий пароль', autocomplete: 'current-password' }); const n = h('input', { type: 'password', placeholder: 'Новый пароль (≥10 символов)', autocomplete: 'new-password' });
  const auditBox = h('div');
  setTimeout(async () => { try { const r = await api('GET', '/audit?n=80'); auditBox.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ['Время', 'Кто', 'Действие', 'Детали'].map((x) => h('th', {}, x)))), h('tbody', {}, r.entries.map((e) => h('tr', {}, h('td', { class: 'small' }, e.ts.replace('T', ' ').slice(0, 19)), h('td', {}, e.user), h('td', {}, e.action), h('td', { class: 'small muted' }, e.detail == null ? '' : JSON.stringify(e.detail).slice(0, 80))))))); } catch (e) { auditBox.textContent = e.message; } }, 0);
  return h('div', {}, h('h2', {}, 'Панель'),
    h('div', { class: 'card' }, h('h3', {}, `Пользователь: ${S.user}`), h('div', { class: 'row' }, o, n, h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/password', { oldPassword: o.value, newPassword: n.value }); o.value = ''; n.value = ''; }, 'Пароль изменён') }, 'Сменить пароль'))),
    h('div', { class: 'card' }, h('h3', {}, 'Журнал действий'), auditBox));
}

// ---------------------------------------------------------------- shell
const PAGES = { overview: ['Обзор', pageOverview], console: ['Консоль', pageConsole], maps: ['Карты и режимы', pageMaps], settings: ['Настройки', pageSettings], plugins: ['Плагины и флаги', pagePlugins], admins: ['Админы', pageAdmins], backups: ['Бэкапы и логи', pageBackups], panel: ['Панель', pagePanel] };
const needsState = new Set(['maps', 'settings', 'plugins', 'admins']);
const mainEl = h('main');
const navEl = h('nav');

async function renderPage() {
  navEl.replaceChildren(h('h1', {}, 'sandbox', h('span', {}, '-cs-1')), ...Object.entries(PAGES).map(([k, [t]]) => h('button', { class: S.page === k ? 'on' : '', onclick: () => { S.page = k; location.hash = k; renderPage(); } }, t)),
    h('div', { class: 'sp' }), h('button', { onclick: async () => { await api('POST', '/logout'); showLogin(); } }, `Выйти (${S.user})`));
  if (needsState.has(S.page) && !S.state) {
    mainEl.replaceChildren(h('div', { class: 'muted' }, 'Загрузка настроек…'));
    try { S.state = await api('GET', '/state'); S.pluginsMeta = S.state.plugins; S.adminFlags = S.state.admin_flags; } catch (e) {
      mainEl.replaceChildren(h('h2', {}, PAGES[S.page][0]), h('div', { class: 'banner' }, `Настройки лежат на сервере CS2. Включите ВМ и дождитесь агента (${e.message}).`)); return;
    }
  }
  if (S.page === 'plugins' && !S.settings) S.settings = await api('GET', '/settings').catch(() => ({ autoStopIdleMinutes: 30, startupGraceMinutes: 20 }));
  mainEl.replaceChildren(PAGES[S.page][1]());
}

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
