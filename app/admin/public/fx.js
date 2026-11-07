'use strict';
// Оформление: темы, сезоны, «погода» интерфейса (canvas), пасхалки.
// Погода и сезон относятся только к панели: в самой CS2 их сервер изменить не может.

const THEMES = { auto: 'Как в системе', dark: 'Тёмная', light: 'Светлая' };
const WEATHERS = { none: 'Ясно', snow: 'Снег', rain: 'Дождь', storm: 'Гроза', leaves: 'Листопад', petals: 'Лепестки', fireflies: 'Светлячки', matrix: 'Код' };
const SEASONS = {
  winter: { name: 'Зима', weather: 'snow' }, spring: { name: 'Весна', weather: 'petals' },
  summer: { name: 'Лето', weather: 'fireflies' }, autumn: { name: 'Осень', weather: 'leaves' },
};
const seasonNow = (d = new Date()) => { const m = d.getMonth() + 1; return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn'; };

// Основные цвета (системная палитра в духе Apple). '' — монохром (акцент = цвет текста темы).
const ACCENTS = [['', 'Моно'], ['#0a84ff', 'Синий'], ['#32ade6', 'Голубой'], ['#30d158', 'Зелёный'], ['#ffd60a', 'Жёлтый'], ['#ff9f0a', 'Оранжевый'], ['#ff453a', 'Красный'], ['#ff375f', 'Розовый'], ['#bf5af2', 'Фиолетовый']];
const onColor = (hex) => { const n = parseInt(hex.slice(1), 16); const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.62 ? '#111113' : '#ffffff'; };
const LOOK_DEFAULT = { auto: false, theme: 'auto', weather: 'none', density: 1, accent: '' };
const look = { ...LOOK_DEFAULT, ...store.get('look', {}) };
if (!THEMES[look.theme]) look.theme = 'auto'; // старые цветные темы больше не поддерживаются
const systemDark = () => !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
const secretsOn = () => !!store.get('secrets', false);

function effectiveLook() {
  const weather = look.auto ? SEASONS[seasonNow()].weather : look.weather;
  const theme = look.theme === 'auto' ? (systemDark() ? 'dark' : 'light') : look.theme;
  return { theme, weather };
}

const fxCanvas = h('canvas', { id: 'fx', 'aria-hidden': 'true' });
let fxCtx = null; let parts = []; let burst = []; let flash = 0; let raf = 0; let W = 0; let Hh = 0;
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resizeFx() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; Hh = window.innerHeight;
  fxCanvas.width = W * dpr; fxCanvas.height = Hh * dpr;
  fxCtx = fxCanvas.getContext('2d'); fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const rnd = (a, b) => a + Math.random() * (b - a);
function spawn(kind) {
  const p = { x: rnd(0, W), y: rnd(-Hh, Hh), s: rnd(0.6, 1.4), ph: rnd(0, 6.28), r: rnd(0, 6.28) };
  if (kind === 'leaves') p.c = ['#b8b8b8', '#8e8e8e', '#d4d4d4', '#6e6e6e'][Math.floor(rnd(0, 4))];
  if (kind === 'matrix') { p.ch = String.fromCharCode(0x30A0 + Math.floor(rnd(0, 96))); p.y = rnd(-Hh, 0); }
  return p;
}
function setWeather(kind) {
  cancelAnimationFrame(raf); raf = 0; parts = [];
  if (!fxCtx) resizeFx();
  fxCtx.clearRect(0, 0, W, Hh);
  if (kind === 'none' || !WEATHERS[kind]) return;
  if (reduceMotion() && !look.forceMotion) return;
  const base = { snow: 110, rain: 160, storm: 260, leaves: 40, petals: 45, fireflies: 38, matrix: 70 }[kind] || 60;
  const n = Math.round(base * look.density * (W < 700 ? 0.5 : 1));
  for (let i = 0; i < n; i++) parts.push(spawn(kind));
  const tick = () => {
    fxCtx.clearRect(0, 0, W, Hh);
    for (const p of parts) drawPart(kind, p);
    if (kind === 'storm') { if (flash <= 0 && Math.random() < 0.002) flash = 1; if (flash > 0) { fxCtx.fillStyle = `rgba(255,255,255,${flash * 0.25})`; fxCtx.fillRect(0, 0, W, Hh); flash -= 0.06; } }
    drawBurst();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function drawPart(kind, p) {
  const c = fxCtx;
  if (kind === 'snow') { p.y += 0.6 + p.s; p.x += Math.sin((p.ph += 0.01)) * 0.4; c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath(); c.arc(p.x, p.y, 1.2 + p.s * 1.4, 0, 6.28); c.fill(); }
  else if (kind === 'rain' || kind === 'storm') { p.y += 11 * p.s; p.x -= 1.2; c.strokeStyle = 'rgba(150,150,150,.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 1.5, p.y - 12 * p.s); c.stroke(); }
  else if (kind === 'leaves' || kind === 'petals') {
    p.y += 0.7 + p.s * 0.8; p.x += Math.sin((p.ph += 0.02)) * 0.9; p.r += 0.02;
    c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = kind === 'leaves' ? p.c : 'rgba(200,200,200,.8)';
    c.beginPath(); c.ellipse(0, 0, 6 * p.s, 3 * p.s, 0, 0, 6.28); c.fill(); c.restore();
  } else if (kind === 'fireflies') {
    p.x += Math.cos((p.ph += 0.01)) * 0.5; p.y += Math.sin(p.ph * 1.3) * 0.4; const a = 0.3 + 0.7 * Math.abs(Math.sin(p.ph * 2));
    c.fillStyle = `rgba(235,235,235,${a})`; c.shadowColor = '#ffffff'; c.shadowBlur = 10; c.beginPath(); c.arc(p.x, p.y, 2, 0, 6.28); c.fill(); c.shadowBlur = 0;
  } else if (kind === 'matrix') { p.y += 2 + p.s * 2; c.fillStyle = 'rgba(180,180,180,.5)'; c.font = '14px monospace'; c.fillText(p.ch, p.x, p.y); if (Math.random() < 0.05) p.ch = String.fromCharCode(0x30A0 + Math.floor(rnd(0, 96))); }
  if (p.y > Hh + 20) { p.y = -20; p.x = rnd(0, W); }
  if (p.x < -20) p.x = W + 10; if (p.x > W + 20) p.x = -10;
}
function drawBurst() {
  if (!burst.length) return;
  for (const b of burst) { b.vy += 0.25; b.x += b.vx; b.y += b.vy; b.r += 0.2; fxCtx.save(); fxCtx.translate(b.x, b.y); fxCtx.rotate(b.r); fxCtx.fillStyle = b.c; fxCtx.fillRect(-4, -2, 8, 4); fxCtx.restore(); }
  burst = burst.filter((b) => b.y < Hh + 20);
}
function confetti(n = 160) {
  if (!fxCtx) resizeFx();
  const cols = ['#ffffff', '#bdbdbd', '#8c8c8c', '#5c5c5c', '#2a2a2a'];
  for (let i = 0; i < n; i++) burst.push({ x: W / 2, y: Hh / 3, vx: rnd(-8, 8), vy: rnd(-12, -2), r: rnd(0, 6), c: cols[i % cols.length] });
  if (!raf) raf = requestAnimationFrame(function loop() { fxCtx.clearRect(0, 0, W, Hh); drawBurst(); raf = burst.length ? requestAnimationFrame(loop) : 0; });
}

function applyLook() {
  const e = effectiveLook();
  document.documentElement.dataset.theme = e.theme;
  const root = document.documentElement.style;
  if (/^#[0-9a-f]{6}$/i.test(look.accent || '')) { root.setProperty('--accent', look.accent); root.setProperty('--on-accent', onColor(look.accent)); } else { root.removeProperty('--accent'); root.removeProperty('--on-accent'); }
  setWeather(e.weather);
}
function saveLook(patch) { Object.assign(look, patch); store.set('look', look); applyLook(); }

// ---------------------------------------------------------------- пасхалки
function initEggs() {
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let ki = 0; let typed = '';
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    ki = e.key.toLowerCase() === KONAMI[ki].toLowerCase() ? ki + 1 : (e.key === KONAMI[0] ? 1 : 0);
    if (ki === KONAMI.length) { ki = 0; unlockSecrets(); }
    typed = (typed + e.key.toLowerCase()).slice(-8);
    if (typed.endsWith('gaben')) { toast('Gaben одобряет этот сервер. Скидка 75% на все ваши баги.', 's'); typed = ''; }
    if (typed.endsWith('rush b')) { toast('RUSH B! Cyka blyat! (бомбы нет, расслабьтесь)', 's'); confetti(60); typed = ''; }
  });
  let clicks = 0; let clickT = 0;
  document.addEventListener('logo-click', () => {
    clicks = Date.now() - clickT > 2500 ? 1 : clicks + 1; clickT = Date.now();
    if (clicks === 7) { clicks = 0; runChicken(); }
  });
}
function unlockSecrets() {
  const first = !secretsOn();
  store.set('secrets', true);
  confetti(220);
  toast(first ? 'Konami! Открыты секретные режимы на странице «Тренировка».' : 'Konami! Секреты уже открыты — держите ещё конфетти.', 's');
  if (typeof renderPage === 'function') renderPage();
}
function runChicken() {
  const c = h('div', { class: 'chicken' }, '🐔');
  document.body.append(c); setTimeout(() => c.remove(), 6000);
  toast('Кто-то выпустил курицу. Она ничего не охраняет.', 's');
}

window.addEventListener('resize', () => { if (fxCtx) { resizeFx(); } });
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyLook());
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else applyLook(); });
document.body.prepend(fxCanvas);
applyLook();
initEggs();
