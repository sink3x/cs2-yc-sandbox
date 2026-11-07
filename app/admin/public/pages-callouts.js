'use strict';
// Callouts: схемы соревновательных карт и названия мест на ru/en/de/fr. Страница — остров Preact + TypeScript (web/src/pages/Callouts.tsx).
// Данные: GET /api/callouts, правки админа: PUT /api/callouts/custom, картинки: /callouts/<карта>.webp.

function pageCallouts() {
  return h('div', {}, h('h2', {}, 'Callouts'), island('callouts'));
}
