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
  }
  out.analysis = analyzeFaceit(out);
  return out;
}

const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
// Границы ELO по уровням FACEIT (CS2): нижняя граница уровня.
const LEVEL_MIN = [0, 100, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];

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
  parseSteamProfileXml, steamProfile, analyzeFaceit, steamAuthUrl, verifySteamAssertion, validateEmail, validateLinks, faceitLookup, STEAM_OP, IDENT_SELECT };
