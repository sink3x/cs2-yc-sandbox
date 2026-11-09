'use strict';
// Манифест PWA на языке интерфейса: название приложения, описание и ярлыки зависят от выбранного языка.
// Браузер забирает манифест без cookie, поэтому язык приходит в адресе (/manifest.webmanifest?lang=de), его подставляет страница.
const LANGS = ['ru', 'en', 'de', 'fr'];
const TEXT = {
  ru: { suffix: 'панель управления', desc: 'Управление сервером CS2: скины, карты, настройки, профиль', skins: 'Скины', overview: 'Обзор' },
  en: { suffix: 'control panel', desc: 'Manage the CS2 server: skins, maps, settings, profile', skins: 'Skins', overview: 'Overview' },
  de: { suffix: 'Steuerungspanel', desc: 'CS2-Server verwalten: Skins, Karten, Einstellungen, Profil', skins: 'Skins', overview: 'Übersicht' },
  fr: { suffix: 'panneau de contrôle', desc: 'Gérer le serveur CS2 : skins, cartes, paramètres, profil', skins: 'Skins', overview: 'Aperçu' },
};
const DEFAULT_NAME = 'sandbox cs2';

const pickLang = (v) => (LANGS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'ru');

/** base — статичный манифест (иконки, цвета, display); → манифест для языка `lang` с названием `brandName`. */
function buildManifest(base, brandName, lang) {
  const l = pickLang(lang); const t = TEXT[l]; const name = String(brandName || DEFAULT_NAME);
  return {
    ...base, id: '/', lang: l, name: `${name} · ${t.suffix}`, short_name: name.length > 12 ? name.slice(0, 12).trim() : name, description: t.desc,
    shortcuts: [{ name: t.skins, url: '/#skins' }, { name: t.overview, url: '/#overview' }],
  };
}

module.exports = { buildManifest, pickLang, LANGS, DEFAULT_NAME, TEXT };
