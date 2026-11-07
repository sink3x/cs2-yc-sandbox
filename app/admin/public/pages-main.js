'use strict';
// Основные страницы панели: обзор, консоль, карты, настройки, плагины, админы, бэкапы.
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
        h('div', { class: 'row' }, connectButton(true)),
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
                h('button', { class: 'btn', onclick: act(() => api('POST', '/service/restart'), 'CS2 перезапускается') }, 'Перезапустить CS2'),
                h('button', { class: 'btn', onclick: act(() => api('POST', '/service/stop'), 'CS2 остановлен') }, 'Стоп'),
                h('button', { class: 'btn', onclick: act(() => api('POST', '/service/start'), 'CS2 запускается') }, 'Старт')),
              live ? h('div', { class: 'row' }, mapSel, h('button', { class: 'btn', onclick: act(() => api('POST', '/map', { map: mapSel.value }), 'Смена карты') }, 'Сменить карту')) : null))));
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
      h('td', { class: 'muted' }, p.desc, p.risky ? h('div', { class: 'warn small' }, 'может привести к блокировке GSLT-токена (правила Valve для серверов)') : null),
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
  const locked = new Set(S.state.protectedAdmins || S.protectedAdmins || []);
  S.protectedAdmins = [...locked];
  let list = st.admins.map((a) => ({ ...a, flags: [...a.flags] }));
  const box = h('div');
  const draw = () => {
    const head = h('tr', {}, h('th', {}, 'Имя'), h('th', {}, 'SteamID64'), h('th', {}, 'Права'), h('th', {}));
    const rows = list.map((a, idx) => {
      const own = locked.has(a.steamid); // владелец: нельзя удалить, нельзя снять root, нельзя сменить SteamID
      const flagSel = h('div', { class: 'chips' }, S.adminFlags.map((f) => {
        const on = a.flags.includes(f); const fixed = own && f === '@css/root';
        return h('span', { class: 'chip', title: fixed ? 'Права владельца менять нельзя' : '', style: `${on ? 'border-color:var(--accent);color:var(--accent);' : ''}${fixed ? 'opacity:.6;cursor:not-allowed;' : ''}`, onclick: () => { if (fixed) return; a.flags = on ? a.flags.filter((x) => x !== f) : a.flags.concat([f]); draw(); } }, f.replace('@css/', ''));
      }));
      return h('tr', {}, h('td', {}, h('input', { type: 'text', value: a.name, style: 'width:140px', oninput: (e) => { a.name = e.target.value; } })),
        h('td', {}, h('input', { type: 'text', value: a.steamid, style: 'width:180px', readonly: own, oninput: (e) => { a.steamid = e.target.value.trim(); } })), h('td', {}, flagSel),
        h('td', {}, own ? h('span', { class: 'tag', title: 'Это владелец сервера: удалить его из админов нельзя' }, 'владелец')
          : h('button', { class: 'btn danger', onclick: () => { list.splice(idx, 1); draw(); } }, 'Удалить')));
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
    cleanupCard(),
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

/** Очистка кэшей и мусора на игровой ВМ (против лагов). */
function cleanupCard() {
  const opts = [['files', 'Старые логи, демо, крэш-дампы, временные файлы', true], ['journal', 'Журнал systemd (оставить ≤100 МБ / 7 дней)', true], ['ram', 'Страничный кэш ОС (освободить RAM; лучше на пустом сервере)', false], ['world', 'Мир на карте: рестарт раунда (убирает выпавшее оружие, декали, лишние сущности)', false]];
  const boxes = opts.map(([k, , on]) => h('input', { type: 'checkbox', checked: on, 'data-k': k }));
  const out = h('div', { class: 'muted small' });
  const run = act(async () => {
    const actions = boxes.filter((b) => b.checked).map((b) => b.dataset.k); if (!actions.length) throw new Error('Отметьте, что чистить');
    if (actions.includes('world') && !confirm('Рестарт раунда выбросит текущий раунд. Продолжить?')) return;
    const r = await api('POST', '/cleanup', { actions });
    out.replaceChildren(h('div', {}, `Готово: ${r.done.map((d) => ({ files: `файлы (${d.files} шт., ${d.mb} МБ)`, journal: 'журнал', ram: 'кэш ОС', world: 'мир' }[d.action] || d.action)).join(', ')}.`),
      h('div', {}, `Свободная RAM: ${r.mem.before.freeMb} → ${r.mem.after.freeMb} МБ.`), ...(r.skipped || []).map((x) => h('div', { class: 'warn small' }, `${x.action}: ${x.reason}`)));
  }, 'Очистка выполнена');
  return h('div', { class: 'card' }, h('h3', {}, 'Очистка кэшей и мусора'),
    h('div', { class: 'muted small' }, 'Нужна включённая игровая ВМ. Файлы игры, скины и настройки не затрагиваются.'),
    ...opts.map(([k, t], i) => h('label', { class: 'row' }, boxes[i], t)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: run }, 'Очистить')), out);
}
