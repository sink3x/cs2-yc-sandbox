'use strict';
// Нативные окна браузера (alert/confirm/prompt) не используем: везде своё модальное окно (askConfirm/askAlert).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const roots = [path.join(__dirname, '..', 'admin', 'public'), path.join(__dirname, '..', '..', 'web', 'src')];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'ui' || e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

test('в исходниках нет вызовов window.alert/confirm/prompt', () => {
  const bad = [];
  for (const f of roots.flatMap((r) => (fs.existsSync(r) ? walk(r) : [])).filter((x) => /\.(js|ts|tsx|html)$/.test(x) && !/i18n/.test(x))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/(^|[^\w$.])(window\.)?(alert|confirm|prompt)\s*\(/.test(line.replace(/\/\/.*$/, '')) && !/^\s*\*/.test(line) && !/^\s*confirm\(message/.test(line)) bad.push(`${path.relative(process.cwd(), f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('окно подтверждения: переводы подписей кнопок есть на en/de/fr', () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ document: { addEventListener() {}, documentElement: {} }, navigator: { languages: ['ru'] }, localStorage: { getItem() { return null; }, setItem() {} }, location: { reload() {} } });
  ctx.window = ctx;
  const read = (f) => fs.readFileSync(path.join(roots[0], f), 'utf8');
  for (const f of ['i18n.js', 'i18n-extra.js', 'i18n-extra2.js', 'i18n-extra3.js', 'i18n-extra4.js', 'i18n-extra5.js', 'i18n-extra6.js', 'i18n-extra7.js', 'i18n-extra8.js', 'i18n-extra9.js']) vm.runInContext(read(f), ctx, { filename: f });
  const D = vm.runInContext('D', ctx);
  const labels = ['Подтверждение', 'Подтвердить', 'Отмена', 'Понятно', 'Удалить', 'Включить', 'Вернуть', 'Выключить', 'Перезапустить', 'Перезапуск CS2', 'Обновить', 'Восстановить', 'Продолжить', 'Снять всё', 'Сбросить', 'Кикнуть', 'Заменить', 'Скрыть', 'Файл уже есть'];
  const missing = labels.filter((l) => !D[l] || D[l].length < 3 || D[l].some((x) => !x));
  assert.deepEqual(missing, []);
});
