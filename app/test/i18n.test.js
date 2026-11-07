'use strict';
// Проверка словаря интерфейса: полнота, согласованность подстановок, шаблоны с числами, отсутствие кириллицы в переводах.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'admin', 'public');
function load(lang) {
  const ctx = { document: { documentElement: {} }, localStorage: { getItem: () => JSON.stringify(lang), setItem() {} }, navigator: { language: lang }, location: {} };
  ctx.window = ctx; vm.createContext(ctx);
  const files = ['i18n.js', 'i18n-extra.js', 'i18n-extra2.js', 'i18n-extra3.js', 'i18n-extra4.js', 'i18n-extra5.js', 'i18n-extra6.js'];
  vm.runInContext(files.map((f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/^'use strict';/, '')).join('\n') + '\n;this.__D=D;this.__P=P;this.__TIPS=TIPS;this.__tr=tr;', ctx);
  return ctx;
}
const cyr = /[А-Яа-яЁё]/;

test('словарь: у каждой записи есть en/de/fr, подстановки $N совпадают', () => {
  const { __D: D } = load('en');
  assert.ok(Object.keys(D).length > 900, 'словарь должен быть большим');
  const ph = (s) => (s.match(/\$\d|\{\w+\}|<[^>]+>/g) || []).sort().join('|');
  for (const [ru, tr3] of Object.entries(D)) {
    assert.equal(tr3.length, 3, `нужны 3 перевода: ${ru}`);
    tr3.forEach((t, i) => {
      assert.ok(typeof t === 'string' && t.trim(), `пустой перевод [${i}] для «${ru}»`);
      assert.ok(!cyr.test(t.replace(/Русский|Русский · English/g, '')) || /Русский/.test(t), `кириллица в переводе «${t}»`);
      if (/\$\d/.test(ru)) assert.equal(ph(t).match(/\$\d/g)?.sort().join(), ph(ru).match(/\$\d/g)?.sort().join(), `подстановки $N: «${ru}»`);
    });
  }
});

test('шаблоны с числами и именами переводятся на все языки без кириллицы', () => {
  const samples = [
    '5 д 3 ч', '2 ч 15 мин', '45 мин', '+ 3 ботов', '23 мс', 'макс. 80 мс', 'канал панели 40 мс', 'За всё время: 5 игроков · 120 убийств · 3.5 ч игры', ' · топ: Alice (50)',
    '4 vCPU · 8 ГБ · standard-v3', 'Автовыключение: через 15 мин без игроков (пусто уже 3 мин)', 'Автовыключение: через 15 мин без игроков', '2 + 3 ботов из 10', '0.5 / 0.4 / 0.3 · своб. RAM 900 МБ',
    'свободно 50 из 100 ГБ', '120 КБ', 'Восстановить daily/2026-11-01.tgz? CS2 остановится, конфиги и БД скинов будут заменены.', 'Нет связи с агентом: timeout', 'Пользователь: alice',
    'файлы (3 шт., 10 МБ)', 'журнал', 'Свободная RAM: 400 → 900 МБ.', 'ВМ: Включена', 'ВМ: Выключается…', '12 (ур. 4)', 'ур. 7', 'До уровня 8: 120 ELO', '· запас до вылета: 40 ELO', '▲ 0.12 к прошлым',
    'Рейтинг (HLTV 1.0), 50 матчей', 'последние 10: 1.12', '10 посл.: 1.2 ▲ 0.1', 'ассистов 100, MVP 20', 'рекорд: 30 убийств (de_dust2)', '7 из 10', 'Логин для входа по паролю: alice',
    '12 убийств при 3 смертях', '15 столкновений (10 убийств / 5 смертей)', '9 смертей при 2 убийствах', 'Считается с 01.11.2026 по логу сервера: убийства, смерти, хедшоты, урон, гранаты, время. Выстрелы/пули лог не пишет.',
    'Перейти: Скины', 'Тема: Тёмная', 'Язык: English', 'Консоль: status', 'Прикол: Луна', 'Луна включён',
    'Часть команд не принята сервером: 2. Возможно, cvar нет в этой версии CS2.', 'Курица: команды отправлены (без ответа)', 'Луна: включено (до смены карты или сброса)', 'Нео (секрет)',
    'Сейчас: de_dust2, людей 2, ботов 5', 'Погода по времени года (сейчас: Осень → «Листопад»)', 'Предмет 4', 'Сохранено. Игроку: напишите !wp в чате (или перезайдите).', 'Набор №12', 'Команда: CT · модель agent.vmdl',
    'Снять (CT)', 'AK-47 (ваниль)', 'Предпросмотр режима «Дезматч»', 'Удалить пресет «My»?', 'Загружаю de_mirage', 'Несохранённых изменений: 3', 'значение: 0 | 1', 'Не приняты: mp_foo, mp_bar',
    'mp_roundtime: целое число 1–60', 'bot_difficulty: число 0…3', 'table wp_x: нет подходящих колонок'.replace('table wp_x: нет подходящих колонок', 'таблица wp_x: нет подходящих колонок'), 'CS2 не отвечает: timeout',
    'Новый пароль: минимум 8 символов', 'Админ 7656119800000000 указан дважды',
  ];
  for (const lang of ['en', 'de', 'fr']) {
    const { __tr: tr } = load(lang);
    for (const s of samples) {
      const out = tr(s);
      assert.notEqual(out, s, `[${lang}] не переведено: «${s}»`);
      assert.ok(!cyr.test(out), `[${lang}] осталась кириллица: «${s}» → «${out}»`);
    }
  }
});

test('русский язык возвращает строки без изменений', () => {
  const { __tr: tr } = load('ru');
  assert.equal(tr('Сохранить'), 'Сохранить');
  assert.equal(tr('45 мин'), '45 мин');
});

test('все подсказки анализа FACEIT имеют ru/en/de/fr', () => {
  const { __TIPS: TIPS } = load('en');
  for (const [code, row] of Object.entries(TIPS)) for (const l of ['ru', 'en', 'de', 'fr']) assert.ok(row[l], `TIPS.${code}.${l}`);
});
