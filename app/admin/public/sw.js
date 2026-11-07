'use strict';
// Service worker панели: оболочка (HTML/JS/CSS/иконки) доступна без сети; API никогда не кэшируется.
const CACHE = 'cs2panel-shell-v5';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/style.css', '/i18n.js', '/i18n-extra.js', '/i18n-extra2.js', '/i18n-extra3.js', '/i18n-extra4.js', '/i18n-extra5.js', '/i18n-extra6.js', '/i18n-extra7.js', '/core.js', '/data.js', '/fx.js', '/pages-main.js', '/pages-play.js', '/skin-links.js', '/pages-skins.js', '/pages-practice.js', '/pages-account.js', '/pages-stats.js', '/pages-callouts.js', '/pages-people.js', '/shell.js', '/manifest.webmanifest', '/icon-192.png']).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // API и сторонние картинки — напрямую
  // сначала сеть (чтобы обновления приходили сразу), при отсутствии сети — из кэша
  e.respondWith(fetch(r).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); } return res; }).catch(() => caches.match(r).then((m) => m || caches.match('/'))));
});
