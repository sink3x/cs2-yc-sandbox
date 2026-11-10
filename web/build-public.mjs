// Сборка публичной части панели (app/admin/public → build/public): минификация JS/CSS без комментариев, чанки с подгрузкой по
// требованию, словари переводов по одному файлу на язык, имена файлов с хэшем содержимого. Исходники не меняются: тесты и
// отладка работают с ними напрямую, а на ВМ уезжает только результат этой сборки (см. scripts/pack.sh).
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../app/admin/public');
const OUT = path.resolve(here, '../build/public');

const EAGER = ['core.js', 'data.js', 'fx.js', 'shell.js']; // нужны сразу после загрузки
const LAZY = { // страницы: подгружаются при первом переходе
  main: ['pages-main.js'], play: ['pages-play.js'], skins: ['skin-links.js', 'pages-skins.js'], practice: ['pages-practice.js'], account: ['pages-account.js'],
  stats: ['pages-stats.js'], callouts: ['pages-callouts.js'], sounds: ['pages-sounds.js'], people: ['pages-people.js'],
};
const I18N = ['i18n.js', 'i18n-extra.js', 'i18n-extra2.js', 'i18n-extra3.js', 'i18n-extra4.js', 'i18n-extra5.js', 'i18n-extra6.js', 'i18n-extra7.js'];
const LANG_LIST = ['en', 'de', 'fr']; // порядок как в массивах словаря
const PROCESSED = new Set([...EAGER, ...Object.values(LAZY).flat(), ...I18N, 'style.css', 'index.html', 'sw.js']);

const die = (m) => { console.error(`build-public: ${m}`); process.exit(1); };
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const min = async (code, loader = 'js') => (await transform(code, { loader, minify: true, legalComments: 'none', target: loader === 'js' ? 'es2022' : undefined, charset: 'utf8' })).code;
const stripStrict = (s) => s.replace(/^\s*(?:"use strict"|'use strict');?/, '');
const out = [];
function emit(name, body) { const f = name; fs.writeFileSync(path.join(OUT, f), body); out.push([f, Buffer.byteLength(body), zlib.gzipSync(body).length]); return f; }
const hashed = (base, ext, body) => emit(`${base}.${hash(body)}.${ext}`, body);

// ---------------------------------------------------------------- проверки исходников (глобальные имена общие у всех скриптов)
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const decl = new Map();
const allJs = [...EAGER, ...Object.values(LAZY).flat()];
const text = Object.fromEntries(allJs.map((f) => [f, read(f)]));
for (const f of allJs) {
  const t = stripComments(text[f]);
  const add = (n) => { if (n) { const s = decl.get(n) || new Set(); s.add(f); decl.set(n, s); } };
  for (const m of t.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) add(m[1] || m[2]);
  for (const m of t.matchAll(/^(?:const|let|var)\s+\{([^}]*)\}/gm)) for (const n of m[1].split(',')) add(n.split(':').pop().trim());
}
for (const [n, fs_] of decl) if (fs_.size > 1) die(`имя ${n} объявлено в нескольких файлах: ${[...fs_].join(', ')} (в браузере одна перезапишет другую)`);

const chunkOf = new Map(); for (const [c, fl] of Object.entries(LAZY)) for (const f of fl) chunkOf.set(f, c);
const deps = Object.fromEntries(Object.keys(LAZY).map((c) => [c, new Set()]));
const pageFns = new Map(); // pageXxx → чанк
for (const f of allJs) {
  const t = stripComments(text[f]).replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
  const own = new Set([...decl].filter(([, s]) => s.has(f)).map(([n]) => n));
  const used = new Set(t.match(/[A-Za-z_$][\w$]*/g));
  for (const n of used) {
    if (own.has(n) || !decl.has(n)) continue;
    const g = [...decl.get(n)][0]; if (g === f) continue;
    if (!chunkOf.has(g)) continue; // ссылка на «сразу загружаемый» файл — всегда доступна
    if (!chunkOf.has(f)) { if (/^page[A-Z]/.test(n) && f === 'shell.js') { pageFns.set(n, chunkOf.get(g)); continue; } die(`${f} (грузится сразу) использует ${n} из ${g} (страница, грузится по требованию)`); }
    if (chunkOf.get(f) !== chunkOf.get(g)) deps[chunkOf.get(f)].add(chunkOf.get(g));
  }
}
// порядок загрузки зависимостей без циклов
const order = []; const state = {};
const visit = (c) => { if (state[c] === 2) return; if (state[c] === 1) die(`циклическая зависимость чанков: ${c}`); state[c] = 1; for (const d of deps[c]) visit(d); state[c] = 2; order.push(c); };
Object.keys(LAZY).forEach(visit);

// страница → чанк (по таблице PAGES в shell.js)
const pages = {};
for (const m of text['shell.js'].matchAll(/(\w+):\s*\['[^']*',\s*(?:\(\.\.\.a\)\s*=>\s*)?(page\w+)/g)) { if (!pageFns.has(m[2])) die(`страница ${m[1]}: функция ${m[2]} не найдена в чанках`); pages[m[1]] = pageFns.get(m[2]); }
if (!Object.keys(pages).length) die('не удалось разобрать PAGES в shell.js');

// ---------------------------------------------------------------- переводы
const ctx = vm.createContext({ document: { documentElement: {} }, navigator: { languages: ['ru'] }, localStorage: { getItem() { return null; }, setItem() {} }, location: { reload() {} }, console });
ctx.window = ctx;
for (const f of I18N) vm.runInContext(read(f), ctx, { filename: f });
const { D, P, TIPS } = vm.runInContext('({ D, P, TIPS })', ctx);
function blank(src, name, open, close) {
  const start = src.indexOf(`const ${name} = ${open}`); if (start < 0) die(`i18n.js: нет const ${name}`);
  const end = src.indexOf(`\n${close};`, start); if (end < 0) die(`i18n.js: нет конца ${name}`);
  return `${src.slice(0, start)}const ${name} = ${open}${close};${src.slice(end + close.length + 2)}`;
}
let i18nCore = read('i18n.js'); i18nCore = blank(blank(blank(i18nCore, 'D', '{', '}'), 'P', '[', ']'), 'TIPS', '{', '}');
const langBodies = {};
for (const [i, lang] of LANG_LIST.entries()) {
  const d = {}; for (const [k, v] of Object.entries(D)) if (v && v[i]) d[k] = [v[i]];
  const p = P.filter((r) => r[1] && r[1][i]).map((r) => `[${String(r[0])},[${JSON.stringify(r[1][i])}]]`);
  const tips = {}; for (const [k, v] of Object.entries(TIPS)) tips[k] = { ru: v.ru, [lang]: v[lang] };
  langBodies[lang] = `Object.assign(D,${JSON.stringify(d)});LANG_IDX.${lang}=0;P.push(${p.join(',')});Object.assign(TIPS,${JSON.stringify(tips)});`;
}

// ---------------------------------------------------------------- сборка
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
// всё, что не обрабатывается (иконки, манифест, радары, ui/ от Vite), копируем как есть
(function copy(rel) {
  for (const e of fs.readdirSync(path.join(SRC, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) { fs.mkdirSync(path.join(OUT, r), { recursive: true }); copy(r); } else if (!PROCESSED.has(r)) fs.copyFileSync(path.join(SRC, r), path.join(OUT, r));
  }
})('');
if (!fs.existsSync(path.join(OUT, 'ui/main.js'))) die('нет ui/main.js: сначала `npm run build` (Vite)');

const join = async (files) => `"use strict";${(await Promise.all(files.map(async (f) => stripStrict(await min(text[f]))))).join('\n')}`;
const files = {};
const lazyFiles = {};
for (const [c, fl] of Object.entries(LAZY)) lazyFiles[c] = hashed(c, 'js', await join(fl));
files.app = hashed('app', 'js', await join(EAGER));
const langFiles = {}; for (const lang of LANG_LIST) langFiles[lang] = `/${hashed(`lang.${lang}`, 'js', await min(langBodies[lang]))}`;
// ядро переводов + подгрузка словаря выбранного языка (document.write держит порядок: словарь выполнится до остальных скриптов)
const core = stripStrict(await min(`${i18nCore}\nif (LANG !== 'ru') document.write('<script src="' + self.__app.lang[LANG] + '"><\\/script>');`));
files.i18n = hashed('i18n', 'js', `"use strict";${core}`);
const manifest = { lang: langFiles, pages, chunks: Object.fromEntries(Object.keys(LAZY).map((c) => [c, { f: `/${lazyFiles[c]}`, d: order.filter((x) => deps[c].has(x)) }])) };
files.loader = hashed('loader', 'js', await min(`self.__app=${JSON.stringify(manifest)};
(()=>{const A=self.__app,P={};
const load=(n)=>P[n]||(P[n]=Promise.all(A.chunks[n].d.map(load)).then(()=>new Promise((ok,no)=>{const s=document.createElement('script');s.src=A.chunks[n].f;s.onload=ok;s.onerror=()=>{delete P[n];no(new Error('chunk '+n))};document.head.append(s)})));
self.__loadPage=(p)=>A.pages[p]?load(A.pages[p]):Promise.resolve();})();`));
files.css = hashed('style', 'css', await min(read('style.css'), 'css'));

let html = read('index.html');
html = html.replace(/\s*<script src="[^"]+"><\/script>/g, '').replace('href="/style.css"', `href="/${files.css}"`)
  .replace('</body>', `  <script src="/${files.loader}"></script>\n  <script src="/${files.i18n}"></script>\n  <script src="/${files.app}"></script>\n</body>`)
  .replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\n\s*/g, ' ');
emit('index.html', html.trim());

// service worker: оболочка в кэше для работы без сети; имя кэша = хэш набора файлов, поэтому вручную его менять не нужно
const shell = ['/', `/${files.css}`, `/${files.loader}`, `/${files.i18n}`, `/${files.app}`, '/manifest.webmanifest', '/icon-192.png'];
let sw = read('sw.js');
if (!/addAll\(\[[^\]]*\]\)/.test(sw) || !/const CACHE = '[^']*';/.test(sw)) die('sw.js: не найден список файлов или имя кэша');
sw = sw.replace(/addAll\(\[[^\]]*\]\)/, `addAll(${JSON.stringify(shell)})`).replace(/const CACHE = '[^']*';/, `const CACHE = 'cs2panel-shell-${hash(JSON.stringify([shell, ...Object.values(lazyFiles), ...Object.values(langFiles)]))}';`);
emit('sw.js', stripStrict(await min(sw)).replace(/^/, '"use strict";'));

// ---------------------------------------------------------------- проверка: перевод после разбиения такой же, как в исходниках
for (const [i, lang] of LANG_LIST.entries()) {
  const mk = (extra) => { const c = vm.createContext({ document: { documentElement: {}, write() {} }, navigator: { languages: [lang] }, localStorage: { getItem: () => JSON.stringify(lang), setItem() {} }, location: { reload() {} }, self: { __app: manifest }, console }); c.window = c; vm.runInContext(extra, c); return c; };
  const orig = mk(I18N.map(read).join('\n'));
  const split = mk(`${i18nCore}\n${langBodies[lang]}`);
  const probe = [...Object.keys(D), 'Админ 3 указан дважды', '12 скинов', 'Карта: de_mirage', 'Занято: тест', 'Простой — текст. И ещё одно предложение.'];
  for (const k of probe) { const a = vm.runInContext(`tr(${JSON.stringify(k)})`, orig); const b = vm.runInContext(`tr(${JSON.stringify(k)})`, split); if (a !== b) die(`перевод (${lang}) расходится: «${k}» → «${a}» / «${b}»`); }
  for (const code of Object.keys(TIPS)) { const a = vm.runInContext(`tipText({code:${JSON.stringify(code)},p:{n:1}})`, orig); const b = vm.runInContext(`tipText({code:${JSON.stringify(code)},p:{n:1}})`, split); if (a !== b) die(`подсказка ${code} (${lang}) расходится`); }
}

const total = out.reduce((a, [, s]) => a + s, 0); const gz = out.reduce((a, [, , g]) => a + g, 0);
for (const [f, s, g] of out.sort()) console.log(`${f.padEnd(34)} ${String(s).padStart(8)} B   gzip ${String(g).padStart(7)} B`);
console.log(`${'итого (обработанные файлы)'.padEnd(34)} ${String(total).padStart(8)} B   gzip ${String(gz).padStart(7)} B`);
