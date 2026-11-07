'use strict';
// Профиль: почта, пароль, привязка Steam, Faceit (ELO/статистика), полезные ссылки; страница сервера для игрока.

const FACEIT_LOOKUP = {};

function builtinLinks(steamid, faceitUrl) {
  const id = steamid || '';
  return [
    ['FACEIT', 'https://www.faceit.com/en'],
    faceitUrl ? ['Мой профиль FACEIT', faceitUrl] : null,
    ['FACEIT · CS2 рейтинг', 'https://www.faceit.com/en/cs2/ranking'],
    id ? ['csstats.gg', `https://csstats.gg/player/${id}`] : ['csstats.gg', 'https://csstats.gg'],
    id ? ['Leetify', `https://leetify.com/app/profile/${id}`] : ['Leetify', 'https://leetify.com'],
    id ? ['Профиль Steam', `https://steamcommunity.com/profiles/${id}`] : null,
    id ? ['Инвентарь Steam', `https://steamcommunity.com/profiles/${id}/inventory/#730`] : null,
    ['Мастерская CS2', 'https://steamcommunity.com/app/730/workshop/'],
    ['Steam-статус', 'https://steamstat.us'],
  ].filter(Boolean);
}

function faceitCard(P) {
  const idIn = h('input', { type: 'text', value: store.get('faceitId', '') || P.steamid || '', placeholder: 'SteamID64 (17 цифр)', style: 'width:220px' });
  const out = h('div', { class: 'faceit-out' });
  const level = (n) => h('span', { class: 'lvl', style: `--lv:${n}` }, String(n));
  const show = (r) => {
    if (!r.found) { out.replaceChildren(h('div', { class: 'muted' }, 'Игрок с таким SteamID не найден на FACEIT (CS2).')); return; }
    const st = r.stats;
    out.replaceChildren(...[h('div', { class: 'faceit-head' }, level(r.level || 0), h('div', {}, h('b', {}, r.nickname || '—'), h('div', { class: 'muted small' }, `${r.region || ''} ${r.country ? '· ' + String(r.country).toUpperCase() : ''}`)),
      h('div', { class: 'faceit-elo' }, h('b', {}, String(r.elo || 0)), h('small', {}, 'ELO'))),
    st ? h('div', { class: 'statgrid' }, [['Матчей', st.matches], ['Побед, %', st.winRate], ['K/D', st.kd], ['HS, %', st.hs], ['Серия побед', st.streak], ['Рекорд серии', st.longestStreak]].map(([k, v]) => h('div', { class: 'stat' }, h('b', {}, v == null ? '—' : String(v)), h('small', {}, k)))) : h('div', { class: 'muted small' }, 'Статистика матчей недоступна.'),
    st && st.recent && st.recent.length ? h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Последние матчи'), h('span', { class: 'form' }, st.recent.map((x) => h('i', { class: x === '1' ? 'w' : 'l', title: x === '1' ? 'W' : 'L' }, x === '1' ? 'W' : 'L')))) : null,
    r.maps && r.maps.length ? h('div', {}, h('h4', {}, 'Карты FACEIT'), h('table', {}, h('thead', {}, h('tr', {}, ['Карта', 'Матчей', 'Побед, %', 'K/D', 'HS, %'].map((x) => h('th', {}, x)))),
      h('tbody', {}, r.maps.map((m) => h('tr', {}, h('td', {}, m.map), h('td', {}, String(m.matches)), h('td', { class: m.winRate >= 52 ? 'good' : m.winRate && m.winRate < 45 ? 'bad' : '' }, String(m.winRate || '—')), h('td', {}, String(m.kd || '—')), h('td', {}, String(m.hs || '—'))))))) : null,
    r.analysis && r.analysis.length ? h('div', { class: 'tips' }, h('h4', {}, 'Анализ игры'), r.analysis.map((t) => h('div', { class: `insight ${t.kind}` }, h('i'), h('span', {}, tipText(t))))) : null,
    r.url ? h('div', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Открыть профиль на FACEIT ↗')) : null].filter(Boolean));
    P.faceitUrl = r.url; FACEIT_LOOKUP.url = r.url;
  };
  const go = act(async () => {
    const id = parseSteamId(idIn.value); if (!id) throw new Error('Нужен 17-значный SteamID64');
    store.set('faceitId', id); out.replaceChildren(h('div', { class: 'muted' }, 'Загрузка…')); show(await api('GET', `/faceit/${id}`));
  });
  if (idIn.value && P.faceitKey) setTimeout(() => go({ currentTarget: null }), 0);
  const keyIn = h('input', { type: 'password', placeholder: P.faceitKey ? 'Ключ задан (введите, чтобы заменить)' : 'API-ключ FACEIT (Server side)', style: 'width:300px', autocomplete: 'off' });
  return h('div', { class: 'card' }, h('h3', {}, 'FACEIT: ELO и статистика'),
    h('div', { class: 'row' }, idIn, h('button', { class: 'btn primary', onclick: go }, 'Показать')),
    out,
    S.role === 'admin' ? h('div', { class: 'row', style: 'margin-top:10px' }, keyIn,
      h('button', { class: 'btn', onclick: act(async () => { await api('PUT', '/faceit-key', { key: keyIn.value.trim() }); keyIn.value = ''; P.faceitKey = true; }, 'Ключ сохранён') }, 'Сохранить ключ'),
      P.faceitKey ? h('button', { class: 'btn', onclick: act(async () => { await api('PUT', '/faceit-key', { key: '' }); P.faceitKey = false; }, 'Ключ удалён') }, 'Удалить ключ') : null,
      h('a', { href: 'https://developers.faceit.com/', target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Где взять ключ ↗')) : null,
    !P.faceitKey && S.role === 'admin' ? h('div', { class: 'muted small' }, 'Без API-ключа FACEIT ELO и статистику показать нельзя. Бесплатный ключ создаётся на developers.faceit.com (Server side API key).') : null);
}

function linksCard(P) {
  const box = h('div', { class: 'links' });
  const draw = () => {
    box.replaceChildren(...builtinLinks(P.steamid, P.faceitUrl || FACEIT_LOOKUP.url).concat((P.links || []).map((l) => [l.title, l.url, true]))
      .map(([t, u, mine]) => h('a', { class: 'linkchip', href: u, target: '_blank', rel: 'noopener noreferrer' }, t, mine && S.role === 'admin' ? h('button', { class: 'x', 'aria-label': 'Убрать', onclick: async (e) => { e.preventDefault(); P.links = P.links.filter((x) => x.url !== u); await saveLinks(); draw(); } }, '×') : null)));
  };
  const saveLinks = act(async () => { const r = await api('PUT', '/profile', { links: P.links }); P.links = r.links; });
  const tIn = h('input', { type: 'text', placeholder: 'Название', style: 'width:150px' }); const uIn = h('input', { type: 'text', placeholder: 'https://…', style: 'width:260px' });
  draw();
  return h('div', { class: 'card' }, h('h3', {}, 'Полезные ссылки'), box,
    S.role === 'admin' ? h('div', { class: 'row', style: 'margin-top:10px' }, tIn, uIn, h('button', { class: 'btn', onclick: act(async () => {
      P.links = (P.links || []).concat([{ title: tIn.value, url: uIn.value }]); try { const r = await api('PUT', '/profile', { links: P.links }); P.links = r.links; } catch (e) { P.links.pop(); throw e; }
      tIn.value = ''; uIn.value = ''; draw();
    }) }, 'Добавить ссылку')) : null);
}

function pageProfile() {
  const root = h('div', {}, h('h2', {}, 'Профиль'), h('div', { class: 'muted' }, 'Загрузка…'));
  (async () => {
    let P; try { P = await api('GET', '/profile'); } catch (e) { root.replaceChildren(h('h2', {}, 'Профиль'), h('div', { class: 'banner' }, e.message)); return; }
    const email = h('input', { type: 'text', value: P.email, placeholder: 'name@example.com', autocomplete: 'email', style: 'width:260px' });
    const o = h('input', { type: 'password', placeholder: 'Текущий пароль', autocomplete: 'current-password' });
    const n = h('input', { type: 'password', placeholder: 'Новый пароль (≥10 символов)', autocomplete: 'new-password' });
    const steamBox = h('div');
    const drawSteam = () => steamBox.replaceChildren(
      P.steamid ? h('div', { class: 'row' }, pill('Steam привязан', 'ok'), h('code', {}, P.steamid), h('a', { href: `https://steamcommunity.com/profiles/${P.steamid}`, target: '_blank', rel: 'noopener noreferrer' }, 'профиль ↗'),
        S.role === 'admin' ? h('button', { class: 'btn', onclick: act(async () => { P.steamid = (await api('POST', '/profile/steam-unlink', {})).steamid; drawSteam(); }, 'Steam отвязан') }, 'Отвязать') : null)
        : h('div', { class: 'row' }, pill('Steam не привязан', 'warn'), h('button', { class: 'btn primary', onclick: act(async () => { location.href = (await api('POST', '/profile/steam-link', {})).url; }) }, 'Привязать Steam-аккаунт')),
      h('div', { class: 'muted small' }, 'Привязка проверяется через официальный вход Steam (OpenID): пароль Steam панель не видит. После привязки на экране входа работает кнопка «Войти через Steam».'));
    drawSteam();
    const cards = [
      h('div', { class: 'card' }, h('div', { class: 'row' }, P.avatar ? h('img', { class: 'avatar', src: P.avatar, alt: '', referrerpolicy: 'no-referrer' }) : null, h('h3', {}, `Аккаунт: ${P.displayName || P.user}`)), S.role === 'admin' && P.displayName && P.displayName !== P.user ? h('div', { class: 'muted small' }, `Логин для входа по паролю: ${P.user}`) : null, h('div', { class: 'muted small' }, S.role === 'admin' ? 'Роль: администратор — полный доступ.' : ''),
        h('div', { class: 'row', style: 'margin-top:8px' }, email, h('button', { class: 'btn', onclick: act(async () => { P.email = (await api('PUT', '/profile', { email: email.value })).email; email.value = P.email; }, 'Почта сохранена') }, 'Сохранить почту')),
        h('div', { class: 'muted small' }, 'Почта хранится только в панели (для связи и будущих уведомлений); письма панель сама не рассылает.')),
      h('div', { class: 'card' }, h('h3', {}, 'Steam'), steamBox),
    ];
    if (S.role === 'admin') {
      cards.splice(1, 0, h('div', { class: 'card' }, h('h3', {}, 'Пароль'), h('div', { class: 'row' }, o, n, h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/password', { oldPassword: o.value, newPassword: n.value }); o.value = ''; n.value = ''; }, 'Пароль изменён') }, 'Сменить пароль')),
        h('div', { class: 'muted small' }, 'Остальные сессии этого пользователя будут закрыты.')));
      const pl = h('input', { type: 'checkbox', checked: !!(S.settings ? S.settings.playerLogin !== false : true) });
      api('GET', '/settings').then((s) => { S.settings = s; pl.checked = s.playerLogin !== false; }).catch(() => {});
      cards.push(h('div', { class: 'card' }, h('h3', {}, 'Игроки'), h('label', { class: 'row' }, pl, 'Разрешить вход любому игроку через Steam (только свои скины и профиль)'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: act(async () => { S.settings = await api('PUT', '/settings', { playerLogin: pl.checked }); }, 'Сохранено') }, 'Сохранить')),
        h('div', { class: 'muted small' }, 'Игрок попадает в панель по кнопке «Войти через Steam»: ему доступны скины, профиль и информация о сервере — ничего больше. Лимит: 300 аккаунтов игроков.')));
    }
    cards.push(faceitCard(P), linksCard(P));
    root.replaceChildren(h('h2', {}, 'Профиль'), ...cards);
  })();
  return root;
}

/** Страница сервера для игрока: статус, адрес, карта, онлайн. */
function pageInfo() {
  const box = h('div', { class: 'muted' }, 'Загрузка…');
  const load = async () => {
    try {
      const r = await api('GET', '/public-info'); const [st, kind] = fmtStatus(r.status || '');
      put(box, h('div', { class: 'row' }, pill(st, kind), r.map ? h('span', {}, `Карта: ${r.map}`) : null, r.humans != null ? h('span', {}, `Игроков: ${r.humans}/${r.maxPlayers}`) : null),
        r.connect ? h('div', { class: 'row' }, h('code', {}, r.connect), h('button', { class: 'btn', onclick: copy(r.connect) }, 'Скопировать')) : null,
        null);
    } catch (e) { box.replaceChildren(h('div', { class: 'banner' }, e.message)); }
  };
  setTimeout(load, 0);
  return h('div', {}, h('h2', {}, 'Сервер'), h('div', { class: 'card' }, box));
}

/** Переключатель языка (RU / EN / DE / FR). */
function langSwitch() {
  return h('div', { class: 'seg lang-seg', role: 'group', 'aria-label': 'Language' }, Object.entries(LANGS).map(([k, t]) => h('button', { class: k === LANG ? 'on' : '', title: t, onclick: () => setLang(k) }, k.toUpperCase())));
}
