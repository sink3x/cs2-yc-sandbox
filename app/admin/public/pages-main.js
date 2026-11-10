'use strict';
// Основные страницы панели: обзор, консоль, карты, настройки, плагины, админы, бэкапы.
// ---------------------------------------------------------------- pages

/** Цвет пинга: до 50 мс — хорошо, до 100 — терпимо, дальше — плохо. */
const pingKind = (ms) => (ms == null ? '' : ms <= 50 ? 'ok' : ms <= 100 ? 'warn' : 'bad');
const fmtUptime = (sec) => { sec = Math.max(0, Math.round(sec || 0)); const d = Math.floor(sec / 86400); const hh = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60); return d ? `${d} д ${hh} ч` : hh ? `${hh} ч ${m} мин` : `${m} мин`; };

/** Сводка «Сервер»: картинка текущей карты, пинги, игроки и краткая статистика. Общая для админа и игрока. */
function serverGlance(g) {
  if (!g) return null;
  const m = g.map || {};
  const up = g.status === 'RUNNING';
  const art = h('div', { class: `glance-map ${m.img ? 'has-img' : ''}` },
    m.img ? h('img', { src: m.img, alt: m.label || '', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.remove(); } }) : null,
    h('span', { class: 'mono' }, (m.label || (up ? '?' : '—')).replace(/^de_|^cs_/, '').slice(0, 2).toUpperCase()));
  const stat = (label, value, sub, kind) => h('div', { class: `stat ${kind || ''}` }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
  const stats = [];
  stats.push(stat('Игроки', g.humans != null ? `${g.humans}/${g.maxPlayers || '?'}` : '—', g.bots ? `+ ${g.bots} ботов` : null));
  stats.push(stat('Средний пинг', g.pingAvg != null ? `${g.pingAvg} мс` : '—', g.pingMax != null && g.humans > 1 ? `макс. ${g.pingMax} мс` : (g.humans ? null : 'нет игроков'), pingKind(g.pingAvg)));
  stats.push(stat('Отклик сервера', g.rttMs != null ? `${g.rttMs} мс` : '—', g.agentMs != null ? `канал панели ${g.agentMs} мс` : null, g.rttMs == null ? '' : g.rttMs <= 150 ? 'ok' : g.rttMs <= 500 ? 'warn' : 'bad'));
  if (g.uptimeSec != null) stats.push(stat('Аптайм ВМ', fmtUptime(g.uptimeSec)));
  const st = g.stats;
  const plist = (g.players || []).length ? h('div', { class: 'glance-players' }, g.players.map((p) => h('div', { class: 'gp' }, h('span', { class: 'gp-n' }, p.name || '—'), h('span', { class: `gp-ping ${pingKind(p.ping)}` }, `${p.ping != null ? p.ping : '—'} мс`)))) : null;
  return h('div', { class: 'card glance' },
    h('div', { class: 'glance-head' }, art,
      h('div', { class: 'glance-title' },
        h('div', { class: 'muted small' }, 'Сейчас на сервере'),
        h('h3', {}, m.label || (up ? 'Загрузка карты…' : 'Сервер выключен')),
        m.id && m.id !== m.label ? h('div', { class: 'muted small' }, m.id) : null,
        h('div', { class: 'row' }, pill(fmtStatus(g.status || '')[0], fmtStatus(g.status || '')[1]), g.connect ? h('code', {}, g.connect) : null, g.connect ? h('button', { class: 'btn', onclick: copy(g.connect) }, 'Скопировать') : null))),
    up ? h('div', { class: 'stats' }, stats) : null,
    plist,
    st ? h('div', { class: 'glance-foot muted small' },
      `За всё время: ${st.players} игроков · ${st.kills} убийств · ${st.hours} ч игры`,
      st.top && st.top.length ? ` · топ: ${st.top.map((x) => `${x.name} (${x.kills})`).join(', ')}` : '') : null);
}

/** Голосование за карту: игроки голосуют, админ запускает и останавливает. Выбор карт админа живёт вне карточки (она перерисовывается вместе с обзором). */
const VOTE_SEL = { maps: new Set(), minutes: '3', auto: true }; let VOTE_LAST = null; // последний ответ: обзор перерисовывается раз в 4 с, карточка не должна мигать
function voteCard() {
  const box = h('div', { class: 'card vote', hidden: true });
  let d = VOTE_LAST; let busy = false; let timer = null;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const draw = () => {
    const isAdmin = S.role !== 'player';
    if (!d || (!d.active && !d.finished && !isAdmin)) { box.hidden = true; return; }
    box.hidden = false;
    const kids = [h('h3', {}, 'Голосование за карту')];
    if (d.active || d.finished) {
      const max = Math.max(1, ...d.options.map((o) => o.votes));
      kids.push(h('div', { class: 'muted small' }, d.active ? `${tr('Осталось')} ${mmss(d.remainingSec)} · ${tr('проголосовали')}: ${d.total}` : `${tr('Голосование завершено')} · ${tr('проголосовали')}: ${d.total}`),
        h('div', { class: 'vote-list' }, d.options.map((o) => h('button', { class: `vote-opt${d.myVote === o.id ? ' sel' : ''}${d.finished && d.winner === o.id ? ' win' : ''}`, disabled: !d.active || busy, onclick: async () => {
          busy = true; try { d = await api('POST', '/vote/cast', { option: o.id }); } catch (e) { toast(e.message, 'e'); } busy = false; draw();
        } }, h('span', { class: 'vote-bar', style: `width:${Math.round(100 * o.votes / max)}%` }), h('span', { class: 'vote-t' }, o.label), h('span', { class: 'vote-n' }, String(o.votes))))));
      if (d.finished) kids.push(h('div', { class: 'small' }, d.winner ? `${tr('Победила карта')}: ${(d.options.find((o) => o.id === d.winner) || {}).label || d.winner}${d.auto ? ` · ${tr('карта меняется автоматически')}` : ''}` : tr('Голосов не было — карта не меняется.')));
    }
    if (isAdmin) {
      if (d.active) kids.push(h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: act(async () => { d = await api('POST', '/vote/stop', {}); draw(); }, 'Голосование остановлено') }, 'Остановить сейчас')));
      else {
        const maps = ((S.catalog && S.catalog.maps) || []).concat((S.state && S.state.state && S.state.state.maps) || []);
        const sel = h('select', { 'aria-label': tr('Срок голосования'), onchange: (e) => { VOTE_SEL.minutes = e.target.value; } }, ['1', '2', '3', '5', '10'].map((m) => h('option', { value: m, selected: m === VOTE_SEL.minutes }, `${m} ${tr('мин')}`)));
        const auto = h('input', { type: 'checkbox', checked: VOTE_SEL.auto, onchange: (e) => { VOTE_SEL.auto = e.target.checked; } });
        kids.push(h('div', { class: 'muted small', style: d.finished ? 'margin-top:12px' : '' }, `${tr('Новое голосование: выберите от 2 до 6 карт')} (${VOTE_SEL.maps.size})`),
          h('div', { class: 'chips' }, maps.map((m) => h('button', { class: `chip${VOTE_SEL.maps.has(m.id) ? ' sel' : ''}`, onclick: (e) => { const on = VOTE_SEL.maps.has(m.id); if (!on && VOTE_SEL.maps.size >= 6) return toast(tr('Не больше 6 карт'), 'e'); on ? VOTE_SEL.maps.delete(m.id) : VOTE_SEL.maps.add(m.id); e.currentTarget.classList.toggle('sel', !on); draw(); } }, m.label || m.id))),
          h('div', { class: 'row', style: 'margin-top:8px' }, sel, h('label', { class: 'row' }, auto, tr('Сразу сменить карту по итогам')),
            h('button', { class: 'btn primary', disabled: VOTE_SEL.maps.size < 2, onclick: act(async () => { d = await api('POST', '/vote/start', { options: [...VOTE_SEL.maps], minutes: Number(VOTE_SEL.minutes), auto: VOTE_SEL.auto }); draw(); }, 'Голосование запущено') }, 'Начать голосование')));
      }
    }
    box.replaceChildren(...kids);
  };
  const load = async () => { if (busy) return; try { d = await api('GET', '/vote'); VOTE_LAST = d; draw(); } catch { /* не критично */ } };
  draw(); load(); timer = setInterval(() => { if (!box.isConnected && timer) { clearInterval(timer); timer = null; return; } load(); }, 3000);
  return box;
}

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
    h('h2', {}, 'Сервер'),
    serverGlance(o.glance),
    voteCard(),
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
          h('button', { class: 'btn danger', disabled: vm.status !== 'RUNNING' || !!o.busy, onclick: act(async () => { if (!await askConfirm('Выключить сервер? Игроки будут отключены, данные сохранятся.', { ok: 'Выключить', danger: true })) return; await api('POST', '/vm/stop'); await loadOverview(); }, 'Останавливаю: бэкап и выключение ВМ') }, '■ Выключить сервер')),
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
  const list = S.pluginsMeta.filter((p) => !p.dependency);
  const CATS = [['match', 'Матчи'], ['practice', 'Практика'], ['mode', 'Режимы игры'], ['fun', 'Фан'], ['utility', 'Утилиты'], ['skins', 'Скины']];
  const catOf = (p) => (CATS.find((c) => c[0] === p.category) || [p.category || '', p.category || ''])[1];
  const pdesc = (p) => (p.i18n && p.i18n[LANG] && p.i18n[LANG].desc) || p.desc;
  const catRank = (p) => { const i = CATS.findIndex((c) => c[0] === p.category); return i < 0 ? 99 : i; };
  const sorted = [...list].sort((x, y) => (st.plugins[y.id] ? 1 : 0) - (st.plugins[x.id] ? 1 : 0) || catRank(x) - catRank(y) || x.title.localeCompare(y.title));
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const liveBadges = {};
  const cardEls = {};
  const cards = sorted.map((p) => {
    const cb = h('input', { type: 'checkbox', checked: st.plugins[p.id] }); boxes[p.id] = cb;
    cb.addEventListener('change', () => {
      if (!cb.checked || !p.group) return;
      const off = list.filter((o) => o.id !== p.id && o.group === p.group && boxes[o.id] && boxes[o.id].checked);
      for (const o of off) boxes[o.id].checked = false;
      if (off.length) toast(`${tr('Режимы игры взаимоисключающие')}: ${off.map((o) => o.title).join(', ')} ${tr('выключен')}`);
    });
    const i = inst[p.id];
    const live = h('span', { class: 'badge', hidden: true }); liveBadges[p.id] = live;
    const others = p.group ? list.filter((o) => o.id !== p.id && o.group === p.group).map((o) => o.title) : [];
    const card = h('div', { class: `plg${p.broken ? ' broken' : ''}`, 'data-id': p.id },
      h('label', { class: 'switch plg-h' }, cb, h('b', {}, p.title)),
      h('div', { class: 'plg-b' },
        p.category ? h('span', { class: 'badge' }, catOf(p)) : null,
        p.risky ? h('span', { class: 'badge warn' }, 'риск блокировки') : null,
        p.broken ? h('span', { class: 'badge bad' }, 'не совместим') : null,
        p.unverified ? h('span', { class: 'badge warn', title: tr('Новый в каталоге: совместимость с вашей версией CounterStrikeSharp не проверена') }, 'новый') : null,
        p.default && !p.broken ? h('span', { class: 'badge' }, 'по умолчанию') : null,
        h('span', { class: `badge${i ? ' ok' : ''}` }, i ? i.tag : 'не установлен'),
        p.pin && !i ? h('span', { class: 'badge', title: tr('Версия закреплена: установщик сверяет контрольную сумму файла') }, p.pin.tag) : null,
        p.license ? h('span', { class: 'badge', title: tr('Лицензия') }, p.license) : null,
        live),
      h('div', { class: 'muted small plg-d' }, pdesc(p), p.risky ? h('div', { class: 'warn small' }, 'может привести к блокировке GSLT-токена (правила Valve для серверов)') : null),
      others.length ? h('div', { class: 'muted small' }, `${tr('Отдельный режим игры: не включайте вместе с')} ${others.join(', ')}`) : null,
      (p.cmds || []).length ? h('div', { class: 'plg-cmds' }, p.cmds.map((c) => h('code', {}, c))) : null,
      p.repo ? h('a', { class: 'small', href: `https://github.com/${p.repo}`, target: '_blank', rel: 'noopener noreferrer' }, `github.com/${p.repo}`) : null);
    card.dataset.q = [p.id, p.title, p.desc, pdesc(p), p.repo, p.category, tr(catOf(p)), (p.cmds || []).join(' ')].join(' ').toLowerCase();
    cardEls[p.id] = card;
    return card;
  });
  let mkCat = 'all';
  const q = h('input', { type: 'text', inputmode: 'search', autocomplete: 'off', placeholder: tr('Поиск плагина: название, команда, описание…'), 'aria-label': tr('Поиск плагина'), style: 'flex:1;min-width:200px' });
  const empty = h('div', { class: 'muted', hidden: true }, 'Ничего не найдено');
  const catBtns = {};
  const applyFilter = () => {
    const needle = q.value.trim().toLowerCase(); let shown = 0;
    for (const p of sorted) {
      const el = cardEls[p.id];
      const okCat = mkCat === 'all' || (mkCat === 'on' ? boxes[p.id].checked : mkCat === 'inst' ? Boolean(inst[p.id]) : p.category === mkCat);
      const ok = okCat && (!needle || needle.split(/\s+/).every((w) => el.dataset.q.includes(w)));
      el.hidden = !ok; if (ok) shown += 1;
    }
    empty.hidden = shown > 0;
    for (const [k, b] of Object.entries(catBtns)) b.classList.toggle('on', k === mkCat);
  };
  q.addEventListener('input', applyFilter);
  const catRow = h('div', { class: 'row mk-cats', role: 'group', 'aria-label': tr('Категории плагинов') },
    [['all', 'Все'], ...CATS, ['on', 'Включены'], ['inst', 'Установлены']].map(([k, t]) => { const b = h('button', { class: `btn mk-cat${k === 'all' ? ' on' : ''}`, onclick: () => { mkCat = k; applyFilter(); } }, t); catBtns[k] = b; return b; }));
  const bulk = (on) => () => { for (const p of list) if (boxes[p.id]) boxes[p.id].checked = on && Boolean(p.default) && !p.broken; applyFilter(); };
  const gameBox = h('div');
  const checkLoaded = act(async () => {
    const r = await api('POST', '/rcon', { command: 'css_plugins list' });
    const text = String(r.output || '');
    const rows = [...text.matchAll(/\[#(\d+):(\w+)\]:\s*"([^"]+)"(?:\s*\(([^)]*)\))?/g)].map((m) => ({ state: m[2], name: m[3], ver: m[4] || '' }));
    for (const p of list) {
      const b = liveBadges[p.id]; const keys = [p.dirs && p.dirs[0], p.title, p.id].map(norm).filter((k) => k.length >= 4);
      const hit = rows.find((e) => { const n = norm(e.name); return n.length >= 4 && keys.some((k) => n === k || n.includes(k) || k.includes(n)); });
      b.hidden = !rows.length || (!hit && !(st.plugins[p.id] && inst[p.id]));
      b.className = `badge ${hit ? (hit.state === 'LOADED' ? 'ok' : 'bad') : 'warn'}`;
      b.textContent = hit ? `${tr('в игре')}: ${hit.state === 'LOADED' ? tr('загружен') : hit.state}` : tr('нет в списке игры');
    }
    gameBox.replaceChildren(rows.length
      ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Плагин'), h('th', {}, 'Состояние'), h('th', {}, 'Версия'))), h('tbody', {}, rows.map((e) => h('tr', {}, h('td', {}, e.name), h('td', {}, e.state), h('td', {}, e.ver)))))
      : h('pre', { class: 'small' }, text.trim() || tr('Пустой ответ игры')));
  }, 'Список обновлён');
  const flags = {};
  const flagDefs = [['autoUpdateGame', 'Обновлять CS2 при каждом запуске ВМ'], ['autoUpdatePlugins', 'Обновлять Metamod/CounterStrikeSharp/плагины при запуске'], ['insecure', 'Запуск с -insecure (отключает VAC на сервере)'], ['dotChat', 'Команды в чате с точкой (.команда) — вместе с «!» и «/»; нужен рестарт CS2']];
  const flagRows = flagDefs.map(([k, t]) => { flags[k] = h('input', { type: 'checkbox', checked: st.flags[k] }); return h('div', { class: 'row' }, h('label', { class: 'switch' }, flags[k], t)); });
  return h('div', {}, h('h2', {}, 'Плагины и фича-флаги'),
    h('div', { class: 'card' }, h('h3', {}, 'Маркетплейс плагинов'),
      h('div', { class: 'muted small' }, 'Каталог подобран вручную: у новых плагинов версия закреплена, а контрольная сумма файла проверяется при установке. Отметьте нужные и нажмите «Сохранить» — скачивание и включение произойдут при запуске CS2.'),
      h('div', { class: 'row' }, q, h('button', { class: 'btn', onclick: bulk(true) }, 'Рекомендованные'), h('button', { class: 'btn', onclick: bulk(false) }, 'Выключить все')),
      catRow,
      h('div', { class: 'plg-grid' }, cards), empty,
      h('div', { class: 'muted small' }, 'Включение и выключение применяется после перезапуска CS2. Зависимости (MenuManager и др.) ставятся автоматически. Плагины работают с правами игрового сервера: ставьте только то, чему доверяете. Совместимость новых плагинов с вашей версией CounterStrikeSharp заранее не проверена: не загрузившийся плагин просто не заработает, остальные не пострадают.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: checkLoaded }, 'Что загружено в игре'), h('span', { class: 'muted small' }, 'Спрашивает у запущенного сервера css_plugins list')),
      gameBox),
    h('div', { class: 'card' }, h('h3', {}, 'Флаги'), flagRows),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: act(async () => {
        const plugins = {}; for (const [k, el] of Object.entries(boxes)) plugins[k] = el.checked;
        const f = {}; for (const [k, el] of Object.entries(flags)) f[k] = el.checked;
        const r = await api('PUT', '/state', { state: { plugins, flags: f } }); S.state = r;
        if (r.needsRestart && await askConfirm('Изменения вступят в силу после перезапуска CS2. Перезапустить сейчас?', { title: 'Перезапуск CS2', ok: 'Перезапустить' })) await api('POST', '/service/restart');
        renderPage();
      }, 'Сохранено') }, 'Сохранить'),
      h('button', { class: 'btn', onclick: act(async () => { if (await askConfirm('Обновить игру и плагины сейчас? CS2 перезапустится (несколько минут).', { ok: 'Обновить' })) await api('POST', '/update'); }, 'Обновление запущено') }, '⟳ Обновить игру и плагины сейчас')),
    h('div', { class: 'card' }, h('h3', {}, 'Экономия: автовыключение ВМ'),
      h('div', { class: 'row' }, 'Выключать ВМ, если игроков нет', idleMin, 'мин (0 = никогда)'),
      h('div', { class: 'row' }, 'Не выключать первые', graceMin, 'мин после запуска ВМ'),
      h('button', { class: 'btn', onclick: act(async () => { S.settings = await api('PUT', '/settings', { autoStopIdleMinutes: Number(idleMin.value), startupGraceMinutes: Number(graceMin.value) }); }, 'Сохранено') }, 'Сохранить')),
    uptimeCard());
}

/** Сколько часов работала игровая ВМ; со своей ценой часа — оценка расхода. Только учёт панели, не счёт облака. */
function uptimeCard() {
  const u = S.uptime;
  if (!u) return null;
  const price = h('input', { type: 'number', min: 0, max: 10000, step: '0.01', value: u.price || '', placeholder: '0', style: 'width:100px', 'aria-label': tr('Цена часа работы ВМ, ₽') });
  const fmt = (x) => `${x.toFixed(1)} ${tr('ч')}`;
  const money = (x) => (u.price ? ` · ≈ ${(x * u.price).toFixed(2)} ₽` : '');
  const max = Math.max(0.1, ...u.series.map((d) => d.hours));
  return h('div', { class: 'card' }, h('h3', {}, 'Расход: время работы ВМ'),
    h('div', { class: 'row' }, h('span', {}, `${tr('Сегодня')}: ${fmt(u.today)}${money(u.today)}`)),
    h('div', { class: 'row' }, h('span', {}, `${tr('7 дней')}: ${fmt(u.last7)}${money(u.last7)}`)),
    h('div', { class: 'row' }, h('span', {}, `${tr('Месяц')}: ${fmt(u.month)}${money(u.month)}`)),
    h('div', { class: 'upt-bars', role: 'img', 'aria-label': tr('Часы работы ВМ за 14 дней') }, u.series.map((d) => h('div', { class: 'upt-col', title: `${d.day}: ${d.hours.toFixed(1)} ${tr('ч')}` }, h('div', { class: 'upt-bar', style: `height:${Math.round((d.hours / max) * 100)}%` })))),
    h('div', { class: 'row', style: 'margin-top:10px' }, 'Цена часа работы ВМ, ₽', price,
      h('button', { class: 'btn', onclick: act(async () => { await api('PUT', '/settings', { vmHourPrice: Number(price.value || 0) }); S.uptime = await api('GET', '/uptime'); go('plugins'); }, 'Сохранено') }, 'Сохранить')),
    h('div', { class: 'muted small' }, 'Считается по статусу ВМ «Работает» (дни по UTC). Диск, адрес и трафик не входят: цену часа возьмите из калькулятора Yandex Cloud.'));
}

// ---------------------------------------------------------------- команды, клан-теги и меню на сервере
// Известные коды логотипов из файлов игры → [название команды, флаг]. Код, которого нет в списке, показывается как есть.
const PRO_TEAMS = {
  navi: ['Natus Vincere', 'UA'], faze: ['FaZe Clan', 'EU'], vita: ['Team Vitality', 'FR'], g2: ['G2 Esports', 'EU'], spir: ['Team Spirit', 'RU'], mouz: ['MOUZ', 'DE'],
  astr: ['Astralis', 'DK'], liq: ['Team Liquid', 'US'], c9: ['Cloud9', 'US'], furi: ['FURIA', 'BR'], hero: ['Heroic', 'DK'], ence: ['ENCE', 'FI'], nip: ['Ninjas in Pyjamas', 'SE'],
  fntc: ['Fnatic', 'GB'], big: ['BIG', 'DE'], vp: ['Virtus.pro', 'RU'], col: ['Complexity', 'US'], mibr: ['MIBR', 'BR'], pain: ['paiN Gaming', 'BR'], mngz: ['The MongolZ', 'MN'],
  gl: ['GamerLegion', 'EU'], og: ['OG', 'EU'], eg: ['Evil Geniuses', 'US'], nrg: ['NRG', 'US'], imp: ['Imperial', 'BR'], apex: ['Apeks', 'NO'], mont: ['Monte', 'UA'], saw: ['SAW', 'PT'],
};
const TEAM_LOGOS = { codes: null, err: '' };
function pageTeams() {
  const st = S.state.state;
  const cur = st.identity || { teams: {}, players: [] };
  const D = { teams: { ct: { name: '', logo: '', flag: '', ...(cur.teams.ct || {}) }, t: { name: '', logo: '', flag: '', ...(cur.teams.t || {}) } }, players: (cur.players || []).map((x) => ({ ...x })) };
  const root = h('div'); const known = {}; // steamid → ник
  const logoImg = (code, size = 40) => (code ? h('img', { class: 'tm-logo', src: `/api/team-logo/${code}`, alt: code, width: size, height: size, loading: 'lazy', onerror: (e) => { e.target.replaceWith(h('span', { class: 'tm-logo tm-nologo', style: `width:${size}px;height:${size}px` }, document.createTextNode(code.slice(0, 4).toUpperCase()))); } }) : h('span', { class: 'tm-logo tm-nologo', style: `width:${size}px;height:${size}px` }, '—'));
  const loadLogos = () => api('GET', '/team-logos').then((r) => { TEAM_LOGOS.codes = r.codes || []; TEAM_LOGOS.err = ''; }).catch((e) => { TEAM_LOGOS.err = e.message; });
  const pickLogo = (side) => {
    const grid = h('div', { class: 'tm-grid' }); const q = h('input', { type: 'text', inputmode: 'search', placeholder: 'Поиск: navi, vitality, faze…', 'aria-label': 'Поиск логотипа', style: 'width:100%' });
    let m;
    const fill = () => {
      if (!TEAM_LOGOS.codes) { put(grid, h('div', { class: TEAM_LOGOS.err ? 'warn small' : 'muted' }, TEAM_LOGOS.err ? `${tr('Логотипы недоступны')}: ${TEAM_LOGOS.err}. ${tr('Список читается из файлов игры: включите игровую ВМ.')}` : 'Читаю логотипы из файлов игры… В первый раз до минуты.')); return; }
      const w = q.value.trim().toLowerCase();
      const list = TEAM_LOGOS.codes.filter((c) => !w || c.includes(w) || (PRO_TEAMS[c] && PRO_TEAMS[c][0].toLowerCase().includes(w)));
      list.sort((a, b) => (PRO_TEAMS[a] ? 0 : 1) - (PRO_TEAMS[b] ? 0 : 1) || a.localeCompare(b));
      put(grid, h('button', { class: 'btn tm-cell', onclick: () => { D.teams[side].logo = ''; m.close(); draw(); } }, logoImg('', 44), h('span', {}, 'Без логотипа')),
        list.slice(0, 120).map((c) => h('button', { class: `btn tm-cell${D.teams[side].logo === c ? ' on' : ''}`, onclick: () => { const t = D.teams[side]; t.logo = c; if (PRO_TEAMS[c]) { if (!t.name || Object.values(PRO_TEAMS).some((x) => x[0] === t.name)) t.name = PRO_TEAMS[c][0]; if (PRO_TEAMS[c][1].length === 2 && PRO_TEAMS[c][1] !== 'EU') t.flag = PRO_TEAMS[c][1]; } m.close(); draw(); } },
          logoImg(c, 44), h('span', {}, document.createTextNode(PRO_TEAMS[c] ? PRO_TEAMS[c][0] : c)))),
        list.length > 120 ? h('div', { class: 'muted small' }, `… ${tr('и ещё')} ${list.length - 120}: ${tr('уточните поиск')}`) : null, !list.length ? h('div', { class: 'muted' }, 'Ничего не найдено') : null);
    };
    q.addEventListener('input', fill);
    m = modal('Логотип команды', h('div', {}, q, h('p', { class: 'muted small' }, 'Это логотипы из файлов самой игры: клиент показывает только их. Свою картинку сервер игрокам показать не может.'), grid), [{ text: 'Закрыть', run: () => true }]);
    fill(); if (!TEAM_LOGOS.codes) loadLogos().then(fill);
  };
  const teamCard = (side, title) => {
    const t = D.teams[side];
    const name = h('input', { type: 'text', value: t.name, maxlength: 32, placeholder: side === 'ct' ? 'Спецназ (по умолчанию)' : 'Террористы (по умолчанию)', 'aria-label': 'Название команды', style: 'min-width:220px' }); name.addEventListener('input', () => { t.name = name.value; });
    const flag = h('input', { type: 'text', value: t.flag, maxlength: 2, placeholder: 'RU', 'aria-label': 'Флаг: код страны из двух букв', title: 'Код страны из двух латинских букв: RU, UA, DE, US…', style: 'width:64px;text-transform:uppercase' }); flag.addEventListener('input', () => { t.flag = flag.value.toUpperCase(); });
    return h('div', { class: 'preset tm-team' }, h('b', {}, title),
      h('div', { class: 'row' }, logoImg(t.logo, 56), h('div', {}, h('div', { class: 'muted small' }, t.logo ? document.createTextNode(`${tr('Логотип')}: ${PRO_TEAMS[t.logo] ? PRO_TEAMS[t.logo][0] : t.logo}`) : 'Логотип не выбран'), h('button', { class: 'btn', onclick: () => pickLogo(side) }, 'Выбрать логотип'))),
      h('div', { class: 'row' }, name, flag));
  };
  const playerRow = (x) => {
    const tag = h('input', { type: 'text', value: x.tag, maxlength: 16, placeholder: 'Клан-тег', 'aria-label': 'Клан-тег', style: 'width:150px' }); tag.addEventListener('input', () => { x.tag = tag.value; });
    const name = h('input', { type: 'text', value: x.name, maxlength: 32, placeholder: 'Ник на сервере (пусто — как в Steam)', 'aria-label': 'Ник на сервере', style: 'min-width:240px' }); name.addEventListener('input', () => { x.name = name.value; });
    return h('div', { class: 'snd-row' }, h('div', { class: 'snd-name' }, h('b', {}, document.createTextNode(known[x.steamid] || x.steamid)), h('span', { class: 'muted small' }, document.createTextNode(x.steamid))), tag, name,
      h('button', { class: 'btn danger', onclick: () => { D.players = D.players.filter((y) => y !== x); draw(); } }, 'Убрать'));
  };
  const sidIn = h('input', { type: 'text', placeholder: 'SteamID64 (17 цифр)', maxlength: 17, inputmode: 'numeric', style: 'width:200px' });
  const addSid = (sid) => { if (!/^\d{17}$/.test(sid)) { toast(tr('SteamID64 — это 17 цифр'), 'e'); return; } if (D.players.some((x) => x.steamid === sid)) return; if (D.players.length >= 64) { toast(tr('Не больше 64 игроков'), 'e'); return; } D.players.push({ steamid: sid, tag: '', name: '' }); draw(); };
  const save = act(async () => {
    S.state = await api('PUT', '/state', { state: { identity: { teams: D.teams, players: D.players.filter((x) => x.tag.trim() || x.name.trim()) } } });
    renderPage();
  }, 'Сохранено: названия, теги и ники применяются сразу');
  const swap = () => { [D.teams.ct, D.teams.t] = [D.teams.t, D.teams.ct]; draw(); };
  const reset = () => { D.teams = { ct: { name: '', logo: '', flag: '' }, t: { name: '', logo: '', flag: '' } }; draw(); };
  function draw() {
    const others = Object.keys(known).filter((sid) => !D.players.some((x) => x.steamid === sid));
    put(root, h('h2', {}, 'Команды и теги'),
      st.plugins && st.plugins.cs2panel === false ? h('div', { class: 'banner' }, 'Плагин CS2Panel выключен: включите его в «Плагины и флаги», иначе оформление не применится.') : null,
      h('div', { class: 'card' }, h('h3', {}, 'Команды'),
        h('p', { class: 'muted small' }, 'Название, логотип и флаг видны в таблице счёта (TAB), в шапке со счётом и в конце матча — там, где обычно написано «Спецназ» и «Террористы».'),
        h('div', { class: 'grid' }, teamCard('ct', 'Спецназ (CT)'), teamCard('t', 'Террористы (T)')),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: swap }, '⇄ Поменять местами'), h('button', { class: 'btn', onclick: reset }, 'Сбросить к стандартным'))),
      h('div', { class: 'card' }, h('h3', {}, 'Клан-теги и ники'),
        h('p', { class: 'muted small' }, 'Тег показывается перед ником в таблице счёта и в ленте убийств. Ник меняется только на этом сервере. Игра время от времени возвращает тег из Steam — плагин ставит ваш заново каждые 10 секунд.'),
        D.players.length ? h('div', { class: 'snd-list' }, D.players.map(playerRow)) : h('div', { class: 'muted' }, 'Пока никому не назначено.'),
        others.length ? h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Добавить игрока:'), others.slice(0, 20).map((sid) => h('button', { class: 'chip', onclick: () => addSid(sid) }, document.createTextNode(`＋ ${known[sid]}`)))) : null,
        h('div', { class: 'row' }, sidIn, h('button', { class: 'btn', onclick: () => { addSid(sidIn.value.trim()); sidIn.value = ''; } }, '＋ По SteamID'))),
      h('div', { class: 'sticky-bar' }, h('div', { class: 'row', style: 'margin:0' }, h('button', { class: 'btn primary', onclick: save }, 'Сохранить и применить'), h('span', { class: 'muted small' }, serverUp() ? 'Применится сразу, без перезапуска.' : 'Сервер выключен: применится при запуске.'))),
      h('div', { class: 'card' }, h('h3', {}, 'Меню на сервере'),
        h('p', { class: 'muted' }, 'В игре напишите в чат !menu — по центру экрана откроется меню, пункты выбираются цифрами. Разделы: скины и внешний вид, выбор команды, тренировка; админам ещё раунд и боты, смена карты, звуки, животные и очистка карты.'),
        h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Чтобы открывать меню одной клавишей, выполните в консоли игры:'), h('span', { class: 'chip', tabindex: '0', onclick: copy('bind m css_menu') }, 'bind m css_menu'))),
      h('div', { class: 'card' }, h('h3', {}, 'Что сервер изменить не может'),
        h('ul', { class: 'muted' },
          h('li', {}, 'Свой логотип сервера вместо значков сторон T и CT внизу экрана: интерфейс рисует клиент игры, и своих картинок он с сервера не берёт. Доступны только логотипы команд из файлов игры — они показываются в таблице счёта и в шапке.'),
          h('li', {}, 'Оформление самой таблицы TAB (колонки, цвета, шрифты): меняются только названия команд, логотипы, флаги, теги и ники.'),
          h('li', {}, 'Модели персонажей настраиваются на странице «Скины» (агенты): свои модели требуют Workshop-аддон.'))));
  }
  draw();
  api('GET', '/skins/players').then((r) => { for (const p of r.players || []) if (p.steamid && p.name) known[p.steamid] = p.name; if (root.isConnected) draw(); }).catch(() => {});
  if (!TEAM_LOGOS.codes) loadLogos();
  return root;
}

function pageAdmins() {
  const st = S.state.state;
  const locked = new Set(S.state.protectedAdmins || S.protectedAdmins || []);
  S.protectedAdmins = [...locked];
  let list = st.admins.map((a) => ({ ...a, flags: [...a.flags] }));
  const box = h('div');
  const accounts = {}; // steamid → карточка пользователя панели (slug, аватар, ник): нужна для ссылки «Профиль на сервере»
  const isSid = (v) => /^\d{17}$/.test(String(v || ''));
  const ownerBadge = (a) => {
    const acc = accounts[a.steamid]; const nick = h('span', { class: 'muted small' });
    return h('div', { class: 'owner-box' },
      h('span', { class: 'owner-badge', title: 'Это владелец сервера: удалить его из админов и снять root нельзя' }, h('b', { 'aria-hidden': 'true' }, '♛'), 'Владелец'),
      isSid(a.steamid) ? h('div', { class: 'adm-name' }, steamAv(a.steamid, 22, a.name, (n) => { nick.textContent = n; }), nick, geoTag(a.steamid)) : null,
      h('div', { class: 'owner-links' },
        isSid(a.steamid) ? h('a', { class: 'adm-link', href: `https://steamcommunity.com/profiles/${a.steamid}`, target: '_blank', rel: 'noopener noreferrer' }, 'Профиль Steam ↗') : null,
        acc ? h('a', { class: 'adm-link', href: `#users/${acc.slug}`, title: 'Карточка в панели управления', onclick: (e) => { e.preventDefault(); go('users', acc.slug); } },
          acc.avatar ? h('img', { src: acc.avatar, alt: '', width: 16, height: 16, referrerpolicy: 'no-referrer' }) : null, 'Профиль на сервере →') : null));
  };
  const draw = () => {
    const rows = list.map((a, idx) => {
      const own = locked.has(a.steamid); // владелец: нельзя удалить, нельзя снять root, нельзя сменить SteamID
      const flagSel = h('div', { class: 'chips' }, S.adminFlags.map((f) => {
        const on = a.flags.includes(f); const fixed = own && f === '@css/root';
        return h('span', { class: `chip${on ? ' sel' : ''}${fixed ? ' fixed' : ''}`, title: fixed ? 'Права владельца менять нельзя' : '', onclick: () => { if (fixed) return; a.flags = on ? a.flags.filter((x) => x !== f) : a.flags.concat([f]); draw(); } }, f.replace('@css/', ''));
      }));
      const field = (label, ...kids) => h('div', { class: 'adm-f' }, h('span', { class: 'adm-l' }, label), ...kids);
      return h('div', { class: `adm-row${own ? ' own' : ''}` },
        h('div', { class: 'adm-grid' },
          field('Имя', h('div', { class: 'adm-name' }, isSid(a.steamid) ? steamAv(a.steamid, 32, a.name) : null, h('input', { type: 'text', value: a.name, oninput: (e) => { a.name = e.target.value; } }))),
          field('SteamID64', h('div', { class: 'adm-sid' }, h('input', { type: 'text', value: a.steamid, readonly: own, inputmode: 'numeric', oninput: (e) => { a.steamid = e.target.value.trim(); } }),
            isSid(a.steamid) && !own ? h('a', { class: 'adm-ext', href: `https://steamcommunity.com/profiles/${a.steamid}`, target: '_blank', rel: 'noopener noreferrer', title: 'Профиль Steam', 'aria-label': 'Профиль Steam' }, '↗') : null)),
          field('Права', flagSel),
          own ? null : h('div', { class: 'adm-act' }, h('button', { class: 'btn danger', onclick: () => { list.splice(idx, 1); draw(); } }, 'Удалить'))),
        own ? ownerBadge(a) : null);
    });
    box.replaceChildren(h('div', { class: 'adm-list' }, rows));
  };
  draw();
  if (locked.size) api('GET', '/users?limit=100').then((r) => { for (const u of r.users || []) if (u.steamid && locked.has(u.steamid) && u.slug) accounts[u.steamid] = u; draw(); }).catch(() => {});
  return h('div', {}, h('h2', {}, 'Админы сервера'),
    h('div', { class: 'card' }, box, h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { list.push({ name: 'new', steamid: '', flags: ['@css/root'] }); draw(); } }, '＋ Добавить'),
      h('button', { class: 'btn primary', onclick: act(async () => { S.state = await api('PUT', '/state', { state: { admins: list } }); try { await api('POST', '/rcon', { command: 'css_plugins reload MatchZy' }); } catch { /* server offline */ } renderPage(); }, 'Админы сохранены') }, 'Сохранить')),
      h('div', { class: 'muted small' }, 'root даёт все права: !map, !rcon, !kick, !ban, !cvar и т.д. (CounterStrikeSharp) и все админ-команды MatchZy. Изменения читаются при смене карты или перезапуске.')));
}

function pageBackups() {
  const listBox = h('div'); const logBox = h('div', { class: 'console logbox' }); const unit = h('select', {}, ['cs2', 'cs2-agent', 'cs2-block-metadata', 'mariadb'].map((u) => h('option', { value: u }, u)));
  const loadList = async () => {
    try {
      const r = await api('GET', '/backups');
      listBox.replaceChildren(r.backups.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Бэкап'), h('th', {}, 'Размер'), h('th', {}))), h('tbody', {}, r.backups.map((b) => h('tr', {}, h('td', {}, b.key.replace('cs2/', '')), h('td', {}, `${Math.round(b.size / 1024)} КБ`),
        h('td', {}, h('button', { class: 'btn danger', onclick: act(async () => { if (await askConfirm(`Восстановить ${b.key}? CS2 остановится, конфиги и БД скинов будут заменены.`, { ok: 'Восстановить', danger: true })) await api('POST', '/restore', { key: b.key }); }, 'Восстановление запущено') }, 'Восстановить')))))) : h('div', { class: 'muted' }, 'Бэкапов пока нет.'));
    } catch (e) { listBox.replaceChildren(h('div', { class: 'warn' }, `Нет связи с агентом: ${e.message}`)); }
  };
  const loadLogs = async () => { try { const r = await api('GET', `/logs?unit=${unit.value}&n=300`); logBox.textContent = r.text || tr('(пусто)'); logBox.scrollTop = logBox.scrollHeight; } catch (e) { logBox.textContent = e.message; } };
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
  return h('div', {}, h('h2', {}, 'Панель'),
    h('div', { class: 'card' }, h('h3', {}, `Пользователь: ${S.user}`), h('div', { class: 'row' }, o, n, h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/password', { oldPassword: o.value, newPassword: n.value }); o.value = ''; n.value = ''; }, 'Пароль изменён') }, 'Сменить пароль'))),
    auditCard());
}

/** Журнал действий: время, кто, откуда (IP и страна), что сделал. Поиск и фильтры считает сервер по последним записям журнала. */
function auditCard() {
  const F = { q: '', user: '', action: '', country: '', ip: '', from: '', to: '' };
  const box = h('div'); const info = h('div', { class: 'muted small' }); let timer = 0; let seq = 0; let retries = 0;
  const sel = (key, ph) => { const el = h('select', { 'aria-label': tr(ph), onchange: () => { F[key] = el.value; run(); } }); return el; };
  const fill = (el, ph, list, extra) => { const cur = el.value; el.replaceChildren(h('option', { value: '' }, tr(ph)), extra || null, ...list.map((v) => h('option', { value: v }, el === country ? `${flagOf(v)} ${v} · ${geoName('region', v)}` : v))); el.value = cur; };
  const user = sel('user', 'Все пользователи'); const action = sel('action', 'Все действия'); const country = sel('country', 'Все страны');
  const text = (key, ph, w) => { const el = h('input', { type: key === 'from' || key === 'to' ? 'date' : 'search', placeholder: key === 'q' || key === 'ip' ? tr(ph) : '', title: tr(ph), 'aria-label': tr(ph), style: `width:${w}px`, oninput: () => { F[key] = el.value.trim(); clearTimeout(timer); timer = setTimeout(run, 250); } }); return el; };
  const q = text('q', 'Поиск по журналу…', 220); const ip = text('ip', 'IP (начало)', 130); const from = text('from', 'С даты', 140); const to = text('to', 'По дату', 140);
  const set = (key, el, v) => { F[key] = v; if (el) el.value = v; run(); };
  const pick = (key, el, v, label) => h('span', { class: 'clickable', title: tr('Нажмите на пользователя, IP, страну или действие, чтобы отфильтровать по нему.'), onclick: () => set(key, el, v) }, label == null ? v : label);
  const reset = () => { for (const k of Object.keys(F)) F[k] = ''; for (const el of [q, ip, from, to, user, action, country]) el.value = ''; run(); };
  const when = (ts) => ts.replace('T', ' ').slice(0, 19);
  async function run() {
    const my = ++seq;
    const qs = Object.entries(F).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).concat('n=200').join('&');
    try {
      const r = await api('GET', `/audit?${qs}`);
      if (my !== seq) return;
      fill(user, 'Все пользователи', r.facets.users); fill(action, 'Все действия', r.facets.actions); fill(country, 'Все страны', r.facets.countries, h('option', { value: '-' }, tr('Страна неизвестна')));
      info.textContent = `${tr('Показано')} ${r.entries.length} ${tr('из')} ${r.total}${r.pending ? ` · ${tr('Определяю страны…')}` : ''}`;
      box.replaceChildren(r.entries.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Время', 'Кто', 'IP', 'Страна', 'Действие', 'Детали'].map((x) => h('th', {}, tr(x))))), h('tbody', {}, r.entries.map((e) => {
        const d = e.detail == null ? '' : (typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail));
        return h('tr', {}, h('td', { class: 'small' }, when(e.ts)), h('td', {}, pick('user', user, e.user)), h('td', { class: 'small mono' }, e.ip && e.ip !== '-' ? pick('ip', ip, e.ip) : '—'),
          h('td', { class: 'small' }, e.country ? pick('country', country, e.country, h('span', { title: geoName('region', e.country) }, h('span', { class: 'geo-f', 'aria-hidden': 'true' }, flagOf(e.country)), ' ', e.country)) : '—'),
          h('td', {}, pick('action', action, e.action)), h('td', { class: 'small muted', title: d }, d.slice(0, 80)));
      }))) : h('div', { class: 'muted' }, tr('Ничего не найдено')));
      if (r.pending && retries++ < 4) { clearTimeout(timer); timer = setTimeout(run, 2500); } else if (!r.pending) retries = 0;
    } catch (e) { if (my === seq) box.textContent = e.message; }
  }
  setTimeout(run, 0);
  return h('div', { class: 'card' }, h('h3', {}, 'Журнал действий'),
    h('div', { class: 'row audit-filters' }, q, user, action, country, ip, from, to, h('button', { class: 'btn', onclick: reset }, 'Сбросить фильтры')),
    info, box, h('div', { class: 'muted small' }, 'Страна определяется по IP внешним сервисом ipwho.is (отправляется только публичный адрес, ответ кэшируется на 30 дней); для внутренних адресов страны нет.'));
}

/** Очистка кэшей и мусора на игровой ВМ (против лагов). */
function cleanupCard() {
  const opts = [['files', 'Старые логи, демо, крэш-дампы, временные файлы', true], ['journal', 'Журнал systemd (оставить ≤100 МБ / 7 дней)', true], ['ram', 'Страничный кэш ОС (освободить RAM; лучше на пустом сервере)', false], ['world', 'Мир на карте: рестарт раунда (убирает выпавшее оружие, декали, лишние сущности)', false]];
  const boxes = opts.map(([k, , on]) => h('input', { type: 'checkbox', checked: on, 'data-k': k }));
  const out = h('div', { class: 'muted small' });
  const run = act(async () => {
    const actions = boxes.filter((b) => b.checked).map((b) => b.dataset.k); if (!actions.length) throw new Error('Отметьте, что чистить');
    if (actions.includes('world') && !await askConfirm('Рестарт раунда выбросит текущий раунд. Продолжить?', { ok: 'Продолжить', danger: true })) return;
    const r = await api('POST', '/cleanup', { actions });
    out.replaceChildren(h('div', {}, `Готово: ${r.done.map((d) => tr({ files: `файлы (${d.files} шт., ${d.mb} МБ)`, journal: 'журнал', ram: 'кэш ОС', world: 'мир' }[d.action] || d.action)).join(', ')}.`),
      h('div', {}, `Свободная RAM: ${r.mem.before.freeMb} → ${r.mem.after.freeMb} МБ.`), ...(r.skipped || []).map((x) => h('div', { class: 'warn small' }, `${x.action}: ${x.reason}`)));
  }, 'Очистка выполнена');
  return h('div', { class: 'card' }, h('h3', {}, 'Очистка кэшей и мусора'),
    h('div', { class: 'muted small' }, 'Нужна включённая игровая ВМ. Файлы игры, скины и настройки не затрагиваются.'),
    ...opts.map(([k, t], i) => h('label', { class: 'row' }, boxes[i], t)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: run }, 'Очистить')), out);
}
