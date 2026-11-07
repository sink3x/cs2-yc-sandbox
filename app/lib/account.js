'use strict';
// Account helpers for the admin panel: Steam OpenID 2.0 sign-in, e-mail validation and Faceit lookups.
// Zero dependencies; the network function is injected so everything is testable offline.

const STEAM_OP = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENT_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/** URL to send the browser to for Steam sign-in. `returnTo` must be an absolute URL on this panel. */
function steamAuthUrl(returnTo, realm) {
  const p = new URLSearchParams({
    'openid.ns': OPENID_NS, 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo, 'openid.realm': realm,
    'openid.identity': IDENT_SELECT, 'openid.claimed_id': IDENT_SELECT,
  });
  return `${STEAM_OP}?${p}`;
}

/**
 * Verify a Steam OpenID assertion (query of the callback). Returns the SteamID64 or throws.
 * Checks: mode, endpoint, claimed id shape, return_to equals what we sent, then asks Steam to confirm the signature.
 */
async function verifySteamAssertion(query, expectedReturnTo, post, nonces = new Map(), now = Date.now()) {
  const bad = (m) => Object.assign(new Error(m), { status: 403 });
  const q = query || {};
  if (q['openid.mode'] !== 'id_res') throw bad('steam: login cancelled');
  if (q['openid.op_endpoint'] !== STEAM_OP) throw bad('steam: bad endpoint');
  if (q['openid.return_to'] !== expectedReturnTo) throw bad('steam: return_to mismatch');
  const m = CLAIMED_RE.exec(String(q['openid.claimed_id'] || ''));
  if (!m || q['openid.identity'] !== q['openid.claimed_id']) throw bad('steam: bad identity');
  const nonce = String(q['openid.response_nonce'] || '');
  if (!nonce) throw bad('steam: no nonce');
  for (const [k, t] of nonces) if (now - t > 10 * 60_000) nonces.delete(k);
  if (nonces.has(nonce)) throw bad('steam: replayed response');
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (k.startsWith('openid.')) form.set(k, String(v));
  form.set('openid.mode', 'check_authentication');
  const text = await post(STEAM_OP, form.toString());
  if (!/^is_valid:true$/m.test(String(text))) throw bad('steam: signature not valid');
  nonces.set(nonce, now);
  return m[1];
}

const EMAIL_RE = /^[^\s@<>"'`;,]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
function validateEmail(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.length > 254 || !EMAIL_RE.test(s)) throw Object.assign(new Error('email: invalid address'), { status: 400 });
  return s;
}

/** Custom useful links: [{title, url}], https only, up to 12. */
function validateLinks(input) {
  if (!Array.isArray(input) || input.length > 12) throw Object.assign(new Error('links: up to 12'), { status: 400 });
  return input.map((l) => {
    const title = String((l && l.title) || '').trim().slice(0, 40);
    const url = String((l && l.url) || '').trim();
    if (!title || /[<>]/.test(title)) throw Object.assign(new Error('links: title 1–40 chars, no < >'), { status: 400 });
    let u; try { u = new URL(url); } catch { throw Object.assign(new Error('links: bad url'), { status: 400 }); }
    if (u.protocol !== 'https:' || url.length > 300) throw Object.assign(new Error('links: https only'), { status: 400 });
    return { title, url: u.toString() };
  });
}

/** Faceit Data API v4 by SteamID64 → compact summary {nickname, level, elo, country, url, stats}. */
async function faceitLookup(steamid, apiKey, get) {
  if (!/^\d{17}$/.test(String(steamid))) throw Object.assign(new Error('faceit: bad SteamID64'), { status: 400 });
  if (!apiKey) throw Object.assign(new Error('faceit: API key not set'), { status: 400 });
  const H = { Authorization: `Bearer ${apiKey}` };
  const pr = await get(`https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${steamid}`, H);
  if (pr.status === 404) return { found: false };
  if (pr.status === 401 || pr.status === 403) throw Object.assign(new Error('faceit: API key rejected'), { status: 400 });
  if (pr.status !== 200) throw Object.assign(new Error(`faceit: HTTP ${pr.status}`), { status: 502 });
  const p = pr.json || {};
  const g = (p.games && (p.games.cs2 || p.games.csgo)) || {};
  const out = { found: true, nickname: p.nickname || '', country: p.country || '', level: g.skill_level || 0, elo: g.faceit_elo || 0, region: g.region || '',
    url: String(p.faceit_url || '').replace('{lang}', 'en'), stats: null };
  if (p.player_id) {
    try {
      const sr = await get(`https://open.faceit.com/data/v4/players/${encodeURIComponent(p.player_id)}/stats/cs2`, H);
      const l = sr.status === 200 && sr.json && sr.json.lifetime;
      if (l) out.stats = { matches: l.Matches, winRate: l['Win Rate %'], kd: l['Average K/D Ratio'], hs: l['Average Headshots %'], streak: l['Current Win Streak'], longestStreak: l['Longest Win Streak'], kr: l['Average K/R Ratio'],
        recent: Array.isArray(l['Recent Results']) ? l['Recent Results'].map(String).slice(0, 10) : [] };
      const seg = sr.status === 200 && sr.json && Array.isArray(sr.json.segments) ? sr.json.segments : [];
      out.maps = seg.filter((x) => x && x.type === 'Map' && (!x.mode || x.mode === '5v5')).map((x) => {
        const t = x.stats || {};
        return { map: String(x.label || ''), matches: num(t.Matches), winRate: num(t['Win Rate %']), kd: num(t['Average K/D Ratio']), hs: num(t['Average Headshots %']), kr: num(t['Average K/R Ratio']) };
      }).filter((m) => m.map && m.matches > 0).sort((a, b) => b.matches - a.matches);
    } catch { /* без статистики */ }
    try {
      const mr = await get(`https://open.faceit.com/data/v4/players/${encodeURIComponent(p.player_id)}/games/cs2/stats?limit=50`, H);
      const items = mr.status === 200 && mr.json && Array.isArray(mr.json.items) ? mr.json.items : [];
      const calc = faceitCalc(items, out);
      if (calc) { out.matches = calc.matches; out.calc = calc.summary; }
    } catch { /* история матчей недоступна */ }
  }
  out.analysis = analyzeFaceit(out);
  return out;
}

const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
// Границы ELO по уровням FACEIT (CS2): нижняя граница уровня.
const LEVEL_MIN = [0, 100, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];


const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const r2 = (x) => Math.round(x * 100) / 100;
/**
 * Собственные расчёты по последним матчам (до 50): форма, стабильность, ADR/K/D/HS по периодам, рейтинг по формуле HLTV 1.0,
 * мультикиллы, ожидаемое число матчей до следующего уровня. Поля API FACEIT читаем осторожно: каких-то может не быть.
 */
function faceitCalc(items, f) {
  const ms = [];
  for (const it of items || []) {
    const s = (it && it.stats) || {}; const k = num(s.Kills); const d = num(s.Deaths);
    if (!k && !d) continue;
    const sc = String(s['Final Score'] || s.Score || '').match(/(\d+)\D+(\d+)/); const rounds = num(s.Rounds) || (sc ? Number(sc[1]) + Number(sc[2]) : 0);
    const mk = { k2: num(s['Double Kills']), k3: num(s['Triple Kills']), k4: num(s['Quadro Kills']), k5: num(s['Penta Kills']) };
    const kpr = rounds ? k / rounds : num(s['K/R Ratio']); const dpr = rounds ? d / rounds : 0;
    let rating = null;
    if (rounds) { const multi = (k - (mk.k2 * 2 + mk.k3 * 3 + mk.k4 * 4 + mk.k5 * 5)) + mk.k2 * 4 + mk.k3 * 9 + mk.k4 * 16 + mk.k5 * 25;
      rating = r2(((kpr / 0.679) + 0.7 * (((rounds - d) / rounds) / 0.317) + (multi / rounds) / 1.277) / 2.7); }
    ms.push({ map: String(s.Map || ''), win: String(s.Result) === '1', kills: k, deaths: d, assists: num(s.Assists), kd: d ? r2(k / d) : k, kr: r2(kpr), hs: num(s['Headshots %']), adr: num(s.ADR) || null,
      mvps: num(s.MVPs), rounds, rating, multi: mk.k3 + mk.k4 * 2 + mk.k5 * 3, score: String(s['Final Score'] || s.Score || ''), date: it.stats && it.stats['Match Finished At'] ? Number(it.stats['Match Finished At']) : 0 });
  }
  if (!ms.length) return null;
  const avg = (arr, key) => r2(mean(arr.map((m) => m[key]).filter((v) => v != null)));
  const first = ms.slice(0, 10); const prev = ms.slice(10, 30);
  const wr = (arr) => (arr.length ? Math.round((arr.filter((m) => m.win).length / arr.length) * 100) : null);
  const rated = ms.filter((m) => m.rating != null);
  const withAdr = ms.filter((m) => m.adr);
  // стабильность: коэффициент вариации K/D (меньше — стабильнее)
  const kds = ms.map((m) => m.kd); const cv = mean(kds) ? sd(kds) / mean(kds) : 0;
  const bestK = ms.slice().sort((a, b) => b.kills - a.kills)[0]; const worstD = ms.slice().sort((a, b) => a.kd - b.kd)[0];
  const perMap = {};
  for (const m of ms) if (m.map) { const e = (perMap[m.map] ||= { map: m.map, n: 0, w: 0, k: 0, d: 0 }); e.n++; e.w += m.win ? 1 : 0; e.k += m.kills; e.d += m.deaths; }
  const summary = {
    n: ms.length, winRate: wr(ms), winRate10: wr(first), winRatePrev: wr(prev),
    kd: avg(ms, 'kd'), kd10: avg(first, 'kd'), kdPrev: prev.length ? avg(prev, 'kd') : null,
    kr: avg(ms, 'kr'), kills: avg(ms, 'kills'), deaths: avg(ms, 'deaths'), assists: avg(ms, 'assists'), mvps: avg(ms, 'mvps'),
    hs: avg(ms, 'hs'), hs10: avg(first, 'hs'), hsPrev: prev.length ? avg(prev, 'hs') : null,
    adr: withAdr.length ? avg(withAdr, 'adr') : null, adr10: withAdr.length ? r2(mean(withAdr.slice(0, 10).map((m) => m.adr))) : null,
    rating: rated.length ? avg(rated, 'rating') : null, rating10: rated.length ? r2(mean(rated.slice(0, 10).map((m) => m.rating))) : null,
    multiPerMatch: avg(ms, 'multi'), consistency: r2(cv), bestKills: bestK ? { kills: bestK.kills, map: bestK.map } : null, worstKd: worstD ? { kd: worstD.kd, map: worstD.map } : null,
    maps: Object.values(perMap).map((e) => ({ map: e.map, n: e.n, winRate: Math.round((e.w / e.n) * 100), kd: e.d ? r2(e.k / e.d) : e.k })).sort((a, b) => b.n - a.n),
  };
  // ожидаемый прирост ELO за матч ≈ (2·WR−1)·25 (±25 за матч — типичное значение), оценка числа матчей до нового уровня
  if (f && f.level && f.level < 10 && f.elo && summary.winRate != null) {
    const need = LEVEL_MIN[f.level + 1] - f.elo; const perMatch = (2 * (summary.winRate / 100) - 1) * 25;
    summary.eloPerMatch = r2(perMatch); summary.eloNeed = need; summary.matchesToNext = need > 0 && perMatch > 0.5 ? Math.ceil(need / perMatch) : null;
  }
  if (f && f.level > 1 && f.elo) summary.eloToDrop = f.elo - LEVEL_MIN[f.level];
  return { summary, matches: ms.slice(0, 20).map((m) => ({ map: m.map, win: m.win, kills: m.kills, deaths: m.deaths, assists: m.assists, kd: m.kd, hs: m.hs, adr: m.adr, rating: m.rating, score: m.score, date: m.date })) };
}

/**
 * Разбор статистики FACEIT в список подсказок {kind: good|warn|info, code, p}. Тексты — на клиенте (4 языка).
 * Пороги — ориентиры по средним значениям FACEIT, а не истина в последней инстанции.
 */
function analyzeFaceit(f) {
  const tips = []; const add = (kind, code, p = {}) => tips.push({ kind, code, p });
  if (!f || !f.found) return tips;
  const st = f.stats;
  if (f.level && f.level < 10 && f.elo) { const need = LEVEL_MIN[f.level + 1] - f.elo; if (need > 0) add('info', 'next_level', { level: f.level + 1, need }); }
  if (!st) { add('info', 'no_stats'); return tips; }
  const kd = num(st.kd); const hs = num(st.hs); const wr = num(st.winRate); const n = num(st.matches);
  if (n < 30) add('info', 'few_matches', { n });
  if (kd) { if (kd < 0.9) add('warn', 'kd_low', { kd }); else if (kd >= 1.15) add('good', 'kd_high', { kd }); else add('info', 'kd_mid', { kd }); }
  if (hs) { if (hs < 35) add('warn', 'hs_low', { hs }); else if (hs > 55) add('good', 'hs_high', { hs }); }
  if (wr) { if (wr < 46) add('warn', 'wr_low', { wr }); else if (wr >= 54) add('good', 'wr_high', { wr }); }
  if (kd >= 1.1 && wr && wr < 48) add('warn', 'kd_wr_gap', { kd, wr });
  if (kd && kd < 0.95 && wr >= 52) add('info', 'wr_over_kd', { kd, wr });
  const rec = (st.recent || []).map((x) => x === '1');
  if (rec.length >= 5) { const w = rec.slice(0, 5).filter(Boolean).length; if (w <= 1) add('warn', 'slump', { w }); else if (w >= 4) add('good', 'hot', { w }); }
  if (num(st.streak) >= 3) add('good', 'streak', { n: num(st.streak) });
  const maps = (f.maps || []).filter((m) => m.matches >= 8);
  if (maps.length >= 2) {
    const best = maps.slice().sort((a, b) => b.winRate - a.winRate)[0]; const worst = maps.slice().sort((a, b) => a.winRate - b.winRate)[0];
    if (best.winRate >= 52) add('good', 'best_map', { map: best.map, wr: best.winRate, n: best.matches });
    if (worst.map !== best.map && worst.winRate < 45) add('warn', 'worst_map', { map: worst.map, wr: worst.winRate, n: worst.matches });
    const weakKd = maps.filter((m) => m.kd && m.kd < 0.85 && m !== worst)[0]; if (weakKd) add('warn', 'map_kd_low', { map: weakKd.map, kd: weakKd.kd });
  }
  const c = f.calc;
  if (c && c.n >= 10) {
    if (c.kdPrev != null && c.kd10 - c.kdPrev >= 0.15) add('good', 'trend_up', { a: c.kd10, b: c.kdPrev });
    else if (c.kdPrev != null && c.kdPrev - c.kd10 >= 0.15) add('warn', 'trend_down', { a: c.kd10, b: c.kdPrev });
    if (c.adr != null) { if (c.adr < 65) add('warn', 'adr_low', { adr: c.adr }); else if (c.adr >= 85) add('good', 'adr_high', { adr: c.adr }); }
    if (c.rating != null) { if (c.rating < 0.95) add('warn', 'rating_low', { r: c.rating }); else if (c.rating >= 1.15) add('good', 'rating_high', { r: c.rating }); }
    if (c.consistency >= 0.45) add('info', 'inconsistent', { cv: c.consistency });
    else if (c.consistency <= 0.3) add('good', 'consistent', { cv: c.consistency });
    if (c.deaths > c.kills && c.assists >= c.kills * 0.4) add('info', 'support_role', { a: c.assists });
    if (c.hsPrev != null && c.hsPrev - c.hs10 >= 6) add('warn', 'hs_drop', { a: c.hs10, b: c.hsPrev });
    if (c.matchesToNext) add('info', 'eta_level', { n: c.matchesToNext, per: c.eloPerMatch, level: f.level + 1 });
    else if (c.eloPerMatch != null && c.eloPerMatch <= 0 && f.level < 10) add('warn', 'elo_stall', { per: c.eloPerMatch });
    if (c.eloToDrop != null && c.eloToDrop <= 40 && f.level > 1) add('warn', 'drop_risk', { n: c.eloToDrop, level: f.level });
    if (c.maps && c.maps.length >= 3) { const w = c.maps.filter((m) => m.n >= 4).sort((a, b) => a.kd - b.kd)[0]; if (w && w.kd < 0.85) add('warn', 'recent_map_weak', { map: w.map, kd: w.kd, n: w.n }); }
  }
  const few = (f.maps || []).filter((m) => m.matches > 0 && m.matches < 5).map((m) => m.map); if (few.length) add('info', 'few_map_games', { maps: few.slice(0, 4).join(', ') });
  return tips;
}

/** Публичный профиль Steam (XML, без ключа API): ник и аватар. Возвращает null, если профиль скрыт/недоступен. */
function parseSteamProfileXml(text) {
  const t = String(text || '');
  const name = (/<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/.exec(t) || [])[1];
  if (!name) return null;
  const av = (/<avatarFull><!\[CDATA\[([^\]]*)\]\]><\/avatarFull>/.exec(t) || [])[1] || '';
  return { name: name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || null, avatar: /^https:\/\/avatars(\.akamai)?\.steamstatic\.com\/[\w]+_full\.jpg$/.test(av) ? av : '' };
}
async function steamProfile(steamid, get) {
  if (!/^\d{17}$/.test(String(steamid))) return null;
  try { const r = await get(`https://steamcommunity.com/profiles/${steamid}/?xml=1`, {}); return r && r.status === 200 ? parseSteamProfileXml(r.text) : null; } catch { return null; }
}

module.exports = {
  parseSteamProfileXml, steamProfile, analyzeFaceit, faceitCalc, steamAuthUrl, verifySteamAssertion, validateEmail, validateLinks, faceitLookup, STEAM_OP, IDENT_SELECT };
