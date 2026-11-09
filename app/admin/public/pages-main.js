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
  const list = S.pluginsMeta.filter((p) => !p.dependency);
  const cards = list.map((p) => {
    const cb = h('input', { type: 'checkbox', checked: st.plugins[p.id] }); boxes[p.id] = cb;
    const i = inst[p.id];
    return h('div', { class: `plg${p.broken ? ' broken' : ''}` },
      h('label', { class: 'switch plg-h' }, cb, h('b', {}, p.title)),
      h('div', { class: 'plg-b' },
        p.risky ? h('span', { class: 'badge warn' }, 'риск блокировки') : null,
        p.broken ? h('span', { class: 'badge bad' }, 'не совместим') : null,
        p.default && !p.broken ? h('span', { class: 'badge' }, 'по умолчанию') : null,
        h('span', { class: 'badge' }, i ? i.tag : 'не установлен')),
      h('div', { class: 'muted small plg-d' }, p.desc, p.risky ? h('div', { class: 'warn small' }, 'может привести к блокировке GSLT-токена (правила Valve для серверов)') : null),
      p.repo ? h('a', { class: 'small', href: `https://github.com/${p.repo}`, target: '_blank', rel: 'noopener noreferrer' }, `github.com/${p.repo}`) : null);
  });
  const bulk = (on) => () => { for (const p of list) if (boxes[p.id]) boxes[p.id].checked = on && !p.risky && !p.broken; };
  const flags = {};
  const flagDefs = [['autoUpdateGame', 'Обновлять CS2 при каждом запуске ВМ'], ['autoUpdatePlugins', 'Обновлять Metamod/CounterStrikeSharp/плагины при запуске'], ['insecure', 'Запуск с -insecure (отключает VAC на сервере)'], ['dotChat', 'Команды в чате с точкой (.команда) — вместе с «!» и «/»; нужен рестарт CS2']];
  const flagRows = flagDefs.map(([k, t]) => { flags[k] = h('input', { type: 'checkbox', checked: st.flags[k] }); return h('div', { class: 'row' }, h('label', { class: 'switch' }, flags[k], t)); });
  return h('div', {}, h('h2', {}, 'Плагины и фича-флаги'),
    h('div', { class: 'card' }, h('h3', {}, 'Плагины'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: bulk(true) }, 'Включить все безопасные'), h('button', { class: 'btn', onclick: bulk(false) }, 'Выключить все'), h('span', { class: 'muted small' }, 'Рискованные и несовместимые не включаются; после выбора нажмите «Сохранить».')),
      h('div', { class: 'plg-grid' }, cards),
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
  const listBox = h('div'); const logBox = h('div', { class: 'console logbox' }); const unit = h('select', {}, ['cs2', 'cs2-agent', 'mariadb'].map((u) => h('option', { value: u }, u)));
  const loadList = async () => {
    try {
      const r = await api('GET', '/backups');
      listBox.replaceChildren(r.backups.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Бэкап'), h('th', {}, 'Размер'), h('th', {}))), h('tbody', {}, r.backups.map((b) => h('tr', {}, h('td', {}, b.key.replace('cs2/', '')), h('td', {}, `${Math.round(b.size / 1024)} КБ`),
        h('td', {}, h('button', { class: 'btn danger', onclick: act(async () => { if (confirm(`Восстановить ${b.key}? CS2 остановится, конфиги и БД скинов будут заменены.`)) await api('POST', '/restore', { key: b.key }); }, 'Восстановление запущено') }, 'Восстановить')))))) : h('div', { class: 'muted' }, 'Бэкапов пока нет.'));
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
    out.replaceChildren(h('div', {}, `Готово: ${r.done.map((d) => tr({ files: `файлы (${d.files} шт., ${d.mb} МБ)`, journal: 'журнал', ram: 'кэш ОС', world: 'мир' }[d.action] || d.action)).join(', ')}.`),
      h('div', {}, `Свободная RAM: ${r.mem.before.freeMb} → ${r.mem.after.freeMb} МБ.`), ...(r.skipped || []).map((x) => h('div', { class: 'warn small' }, `${x.action}: ${x.reason}`)));
  }, 'Очистка выполнена');
  return h('div', { class: 'card' }, h('h3', {}, 'Очистка кэшей и мусора'),
    h('div', { class: 'muted small' }, 'Нужна включённая игровая ВМ. Файлы игры, скины и настройки не затрагиваются.'),
    ...opts.map(([k, t], i) => h('label', { class: 'row' }, boxes[i], t)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: run }, 'Очистить')), out);
}
