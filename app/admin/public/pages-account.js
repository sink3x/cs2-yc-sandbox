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

// Оценка показателя FACEIT: 'good' (зелёный) / 'bad' (красный) / 'mid' (нейтральный). Пороги — ориентиры для среднего уровня FACEIT.
const TONES = { winRate: [54, 47], kd: [1.12, 0.95], hs: [48, 35], kr: [0.74, 0.62], streak: [3, 0], adr: [80, 65], rating: [1.1, 0.95] };
function tone(metric, v) {
  const n = Number(v); const t = TONES[metric];
  if (v == null || v === '' || !Number.isFinite(n) || n === 0 && metric !== 'streak' || !t) return 'mid';
  if (metric === 'streak') return n >= t[0] ? 'good' : 'mid';
  return n >= t[0] ? 'good' : n < t[1] ? 'bad' : 'mid';
}
const recentTone = (rec) => { const w = rec.filter((x) => x === '1').length; const r = rec.length ? w / rec.length : 0.5; return r >= 0.6 ? 'good' : r <= 0.4 ? 'bad' : 'mid'; };

// Значок уровня FACEIT как на сайте: тёмный круг, цветное кольцо из 10 сегментов (закрашены до уровня) и номер.
const FACEIT_LV_COLOR = ['#5b5b5b', '#eeeeee', '#1ce400', '#1ce400', '#ffc800', '#ffc800', '#ffc800', '#ffc800', '#ff6309', '#ff6309', '#fe1f00'];
function faceitLevelBadge(n, size = 44) {
  const lv = Math.max(0, Math.min(10, Number(n) || 0)); const col = FACEIT_LV_COLOR[lv];
  const NS = 'http://www.w3.org/2000/svg'; const el = (tag, a = {}, p) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (p) p.appendChild(e); return e; };
  const svg = el('svg', { viewBox: '0 0 48 48', width: size, height: size, class: 'fc-lvl', role: 'img', 'aria-label': `FACEIT level ${lv}` });
  el('circle', { cx: 24, cy: 24, r: 22, fill: '#1f1f22' }, svg);
  const R = 20; const gap = 0.16; const seg = (Math.PI * 2) / 10;
  for (let i = 0; i < 10; i++) {
    const a0 = -Math.PI / 2 + i * seg + gap / 2; const a1 = -Math.PI / 2 + (i + 1) * seg - gap / 2;
    const p = (a) => `${(24 + R * Math.cos(a)).toFixed(2)} ${(24 + R * Math.sin(a)).toFixed(2)}`;
    el('path', { d: `M ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)}`, fill: 'none', stroke: i < lv ? col : '#3a3a3f', 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
  }
  const t = el('text', { x: 24, y: 24, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: col, 'font-size': lv === 10 ? 17 : 20, 'font-weight': 800, 'font-family': 'system-ui, sans-serif' }, svg); t.textContent = String(lv || '–');
  return svg;
}


const FC_LEVEL_MIN = [0, 100, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];
// Блок «ELO и уровень»: значок, прогресс до следующего уровня и запас до вылета.
function faceitEloBlock(r) {
  const lv = r.level || 0; const elo = r.elo || 0; if (!lv) return null;
  const lo = FC_LEVEL_MIN[lv]; const hi = lv < 10 ? FC_LEVEL_MIN[lv + 1] : null; const pct = hi ? Math.max(0, Math.min(100, Math.round(((elo - lo) / (hi - lo)) * 100))) : 100;
  const col = FACEIT_LV_COLOR[lv];
  return h('div', { class: 'fc-elo' },
    h('div', { class: 'fc-bar', style: `--c:${col}` }, h('i', { style: `width:${pct}%` })),
    h('div', { class: 'fc-bar-lbl small muted' }, h('span', {}, lv > 1 ? `${lo} (ур. ${lv})` : `ур. ${lv}`), h('b', {}, `${elo} ELO`), h('span', {}, hi ? `${hi} (ур. ${lv + 1})` : 'макс. уровень')),
    h('div', { class: 'small muted' }, hi ? `До уровня ${lv + 1}: ${Math.max(0, hi - elo)} ELO` : 'Вы на максимальном уровне', lv > 1 ? ` · запас до вылета: ${Math.max(0, elo - lo)} ELO` : ''));
}
// Свои расчёты по последним матчам: плитки, динамика K/D, таблица матчей.
function faceitDetails(r) {
  const c = r.calc; if (!c) return null;
  const T = (label, v, metric, sub) => h('div', { class: `stat ${metric ? 'tone-' + tone(metric, v) : ''}` }, h('b', {}, v == null ? '—' : String(v)), h('small', {}, label), sub ? h('small', { class: 'sub' }, sub) : null);
  const delta = (a, b) => (a == null || b == null ? null : `${a >= b ? '▲' : '▼'} ${Math.abs(a - b).toFixed(2)} к прошлым`);
  const tiles = [
    T(`Рейтинг (HLTV 1.0), ${c.n} матчей`, c.rating, 'rating', c.rating10 != null ? `последние 10: ${c.rating10}` : null),
    T('ADR (урон за раунд)', c.adr, 'adr', c.adr10 != null ? `последние 10: ${c.adr10}` : null),
    T('K/D', c.kd, 'kd', delta(c.kd10, c.kdPrev) ? `10 посл.: ${c.kd10} ${delta(c.kd10, c.kdPrev)}` : null),
    T('Убийств / смертей', `${c.kills} / ${c.deaths}`, null, `ассистов ${c.assists}, MVP ${c.mvps}`),
    T('Побед, %', c.winRate, 'winRate', c.winRate10 != null ? `10 посл.: ${c.winRate10}%` : null),
    T('Хедшоты, %', c.hs, 'hs', c.hsPrev != null ? `10 посл.: ${c.hs10}%` : null),
    T('Стабильность (разброс K/D)', c.consistency, null, c.consistency <= 0.3 ? 'очень стабильно' : c.consistency >= 0.45 ? 'сильные скачки' : 'нормально'),
    T('Мультикиллы за матч', c.multiPerMatch, null, c.bestKills ? `рекорд: ${c.bestKills.kills} убийств (${c.bestKills.map})` : null),
  ];
  const ms = r.matches || [];
  const maxKd = Math.max(1.5, ...ms.map((m) => m.kd));
  const spark = ms.length ? h('div', { class: 'fc-spark', role: 'img', 'aria-label': 'K/D по последним матчам' }, ms.slice().reverse().map((m) => h('i', { class: m.win ? 'w' : 'l', style: `height:${Math.max(6, Math.round((m.kd / maxKd) * 100))}%`, title: `${m.map} ${m.score} · ${m.kills}/${m.deaths} · K/D ${m.kd}` }))) : null;
  return h('div', { class: 'fc-details' }, h('h4', {}, 'Подробная статистика (по последним матчам)'), h('div', { class: 'statgrid' }, tiles),
    ms.length ? h('div', {}, h('h4', {}, 'K/D по матчам (старые → новые)'), spark, h('div', { class: 'small muted' }, 'Высота столбца — K/D матча; зелёный — победа, красный — поражение.')) : null,
    ms.length ? h('div', {}, h('h4', {}, 'Последние матчи'), h('table', {}, h('thead', {}, h('tr', {}, ['Карта', 'Итог', 'Счёт', 'У/С/А', 'K/D', 'HS %', 'ADR', 'Рейтинг'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ms.slice(0, 15).map((m) => h('tr', {}, h('td', {}, m.map.replace(/^de_/, '')), h('td', { class: m.win ? 'tone-good' : 'tone-bad' }, m.win ? 'Победа' : 'Поражение'), h('td', {}, m.score || '—'), h('td', {}, `${m.kills}/${m.deaths}/${m.assists}`),
        h('td', { class: `tone-${tone('kd', m.kd)}` }, String(m.kd)), h('td', { class: `tone-${tone('hs', m.hs)}` }, String(m.hs || '—')), h('td', { class: `tone-${tone('adr', m.adr)}` }, m.adr == null ? '—' : String(m.adr)), h('td', { class: `tone-${tone('rating', m.rating)}` }, m.rating == null ? '—' : String(m.rating))))))) : null,
    h('div', { class: 'small muted' }, 'Рейтинг и оценки считаются панелью из данных FACEIT по формуле HLTV 1.0 — это ориентир, а не официальная цифра.'));
}

function faceitRadars(r) {
  const st = r.stats; const rec = st.recent || []; const form = rec.length ? rec.filter((x) => x === '1').length / rec.length : null;
  const axes = [
    { label: 'Победы', value: norm(st.winRate, 35, 65), text: `${st.winRate ?? '—'}%` },
    { label: 'K/D', value: norm(st.kd, 0.6, 1.6), text: String(st.kd ?? '—') },
    { label: 'Хедшоты', value: norm(st.hs, 20, 65), text: `${st.hs ?? '—'}%` },
    { label: 'K/R', value: norm(st.kr, 0.5, 0.95), text: String(st.kr ?? '—') },
    ...(form === null ? [] : [{ label: 'Форма', value: form, text: `${rec.filter((x) => x === '1').length}/${rec.length}` }]),
  ];
  const ref = [norm(50, 35, 65), norm(1, 0.6, 1.6), norm(42, 20, 65), norm(0.68, 0.5, 0.95), ...(form === null ? [] : [0.5])];
  const pool = (r.maps || []).filter((m) => m.matches >= 3 && m.winRate != null).slice(0, 8);
  return h('div', { class: 'cols radars' }, h('div', {}, h('h4', {}, 'Профиль игрока'), radar({ axes, ref, title: 'Профиль игрока' })),
    pool.length >= 3 ? h('div', {}, h('h4', {}, 'Пул карт: % побед'), radar({ axes: pool.map((m) => ({ label: m.map, value: norm(m.winRate, 30, 70), text: `${m.winRate}%` })), ref: pool.map(() => norm(50, 30, 70)), title: 'Пул карт' })) : null);
}

/** Блок «FACEIT»: уровень, ELO, статистика, карты, анализ. Общий для профиля и карточки пользователя. */
function faceitView(r) {
  const st = r.stats; const level = (n) => faceitLevelBadge(n, 52);
  return [h('div', { class: 'faceit-head' }, level(r.level || 0), h('div', {}, h('b', {}, r.nickname || '—'), h('div', { class: 'muted small' }, `${r.region || ''} ${r.country ? '· ' + String(r.country).toUpperCase() : ''}`)),
      h('div', { class: 'faceit-elo' }, h('b', {}, String(r.elo || 0)), h('small', {}, 'ELO'))),
    st ? h('div', { class: 'statgrid' }, [['Матчей', st.matches, null], ['Побед, %', st.winRate, 'winRate'], ['K/D', st.kd, 'kd'], ['HS, %', st.hs, 'hs'], ['K/R', st.kr, 'kr'], ['Серия побед', st.streak, 'streak'], ['Рекорд серии', st.longestStreak, null]].map(([k, v, m]) => h('div', { class: `stat ${m ? 'tone-' + tone(m, v) : ''}` }, h('b', {}, v == null ? '—' : String(v)), h('small', {}, k)))) : h('div', { class: 'muted small' }, 'Статистика матчей недоступна.'),
    faceitEloBlock(r),
    st ? faceitRadars(r) : null,
    faceitDetails(r),
    st && st.recent && st.recent.length ? h('div', { class: `row recent tone-${recentTone(st.recent)}` }, h('span', { class: 'muted small' }, 'Последние матчи'), h('b', { class: 'recent-sum' }, `${st.recent.filter((x) => x === '1').length} из ${st.recent.length}`), h('span', { class: 'form' }, st.recent.map((x) => h('i', { class: x === '1' ? 'w' : 'l', title: x === '1' ? 'W' : 'L' }, x === '1' ? 'W' : 'L')))) : null,
    r.maps && r.maps.length ? h('div', {}, h('h4', {}, 'Карты FACEIT'), h('table', {}, h('thead', {}, h('tr', {}, ['Карта', 'Матчей', 'Побед, %', 'K/D', 'HS, %'].map((x) => h('th', {}, x)))),
      h('tbody', {}, r.maps.map((m) => h('tr', {}, h('td', {}, m.map), h('td', {}, String(m.matches)), h('td', { class: `tone-${tone('winRate', m.winRate)}` }, String(m.winRate || '—')), h('td', { class: `tone-${tone('kd', m.kd)}` }, String(m.kd || '—')), h('td', { class: `tone-${tone('hs', m.hs)}` }, String(m.hs || '—'))))))) : null,
    r.analysis && r.analysis.length ? h('div', { class: 'tips' }, h('h4', {}, 'Анализ игры'), r.analysis.map((t) => h('div', { class: `insight ${t.kind}` }, h('i'), h('span', {}, tipText(t))))) : null,
    r.url ? h('div', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Открыть профиль на FACEIT ↗')) : null].filter(Boolean);
}

function faceitCard(P) {
  const idIn = h('input', { type: 'text', value: store.get('faceitId', '') || P.steamid || '', placeholder: 'SteamID64 (17 цифр)', style: 'width:220px' });
  const out = h('div', { class: 'faceit-out' });
  const level = (n) => faceitLevelBadge(n, 52);
  const show = (r) => {
    if (!r.found) { out.replaceChildren(h('div', { class: 'muted' }, 'Игрок с таким SteamID не найден на FACEIT (CS2).')); return; }
    const st = r.stats;
    out.replaceChildren(...faceitView(r));
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
    if (S.role === 'player' && P.steamid) { // вошёл через Steam, а админ-аккаунт уже есть: объединяем по паролю
      const lu = h('input', { type: 'text', placeholder: 'Логин админ-аккаунта', autocomplete: 'username', style: 'width:200px', 'aria-label': 'Логин админ-аккаунта' });
      const lp = h('input', { type: 'password', placeholder: 'Пароль', autocomplete: 'current-password', style: 'width:200px', 'aria-label': 'Пароль' });
      cards.splice(1, 0, h('div', { class: 'card' }, h('h3', {}, 'У меня уже есть админ-аккаунт'),
        h('div', { class: 'muted small' }, 'Если вы управляете сервером, привяжите этот Steam к своему админ-аккаунту: сетапы и профиль переедут туда, а на экране входа кнопка «Войти через Steam» будет открывать админ-аккаунт.'),
        h('div', { class: 'row', style: 'margin-top:8px' }, lu, lp, h('button', { class: 'btn primary', onclick: act(async () => {
          if (!lu.value.trim() || !lp.value) throw new Error(tr('Введите логин и пароль админ-аккаунта'));
          const r = await api('POST', '/link-account', { user: lu.value.trim(), password: lp.value });
          toast(`${tr('Steam привязан к аккаунту')} ${r.user}. ${tr('Войдите через Steam заново')}`, 's');
          setTimeout(() => location.reload(), 1500);
        }) }, 'Привязать'))));
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
    try { const r = await api('GET', '/public-info'); put(box, serverGlance(r)); } catch (e) { box.replaceChildren(h('div', { class: 'banner' }, e.message)); }
  };
  setTimeout(load, 0);
  return h('div', {}, h('h2', {}, 'Сервер'), box);
}

/** Переключатель языка (RU / EN / DE / FR). */
function langSwitch() {
  return h('div', { class: 'seg lang-seg', role: 'group', 'aria-label': 'Language' }, Object.entries(LANGS).map(([k, t]) => h('button', { class: k === LANG ? 'on' : '', title: t, onclick: () => setLang(k) }, k.toUpperCase())));
}
