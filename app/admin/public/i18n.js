'use strict';
// Языки интерфейса: ru (исходный), en, de, fr. Ключ словаря — русская строка, значение — [en, de, fr].
// Что не переведено — остаётся по-русски (длинные справочные тексты). Переключение: setLang('en').

const LANGS = { ru: 'Русский', en: 'English', de: 'Deutsch', fr: 'Français' };
const LANG_IDX = { en: 0, de: 1, fr: 2 };
function detectLang() {
  try { const v = localStorage.getItem('cs2ui.lang'); if (v && LANGS[JSON.parse(v)]) return JSON.parse(v); } catch { /* нет хранилища */ }
  const n = String((navigator.languages && navigator.languages[0]) || navigator.language || 'ru').slice(0, 2).toLowerCase();
  return LANGS[n] ? n : (n === 'ru' || n === 'uk' || n === 'be' ? 'ru' : 'en');
}
let LANG = detectLang();
document.documentElement.lang = LANG;
function setLang(l) { if (!LANGS[l]) return; try { localStorage.setItem('cs2ui.lang', JSON.stringify(l)); } catch { /* ok */ } location.reload(); }

const D = {
  // --- навигация и общие
  'Статистика': ['Statistics', 'Statistik', 'Statistiques'], 'Убийств': ['Kills', 'Kills', 'Éliminations'], 'Смертей': ['Deaths', 'Tode', 'Morts'], 'Урон': ['Damage', 'Schaden', 'Dégâts'], 'Попаданий': ['Hits', 'Treffer', 'Touches'], 'Время на сервере': ['Time on server', 'Zeit auf dem Server', 'Temps sur le serveur'], 'Гранат': ['Grenades', 'Granaten', 'Grenades'], 'Гранаты': ['Grenades', 'Granaten', 'Grenades'], 'Раундов': ['Rounds', 'Runden', 'Manches'], 'Запусков': ['Loads', 'Starts', 'Lancements'], 'Сбросить статистику': ['Reset statistics', 'Statistik zurücksetzen', 'Réinitialiser les statistiques'], 'Оружие (убийства)': ['Weapons (kills)', 'Waffen (Kills)', 'Armes (éliminations)'], 'Попадания по частям тела': ['Hits by body part', 'Treffer nach Körperteil', 'Touches par zone'], 'По картам': ['By map', 'Nach Karte', 'Par carte'], 'Пока нет данных': ['No data yet', 'Noch keine Daten', 'Pas encore de données'], 'в игре': ['in game', 'im Spiel', 'en jeu'],
  'панель управления': ['control panel', 'Steuerungspanel', 'panneau de contrôle'], 'Логотип и название': ['Logo & name', 'Logo & Name', 'Logo et nom'], 'Загрузить логотип': ['Upload logo', 'Logo hochladen', 'Téléverser un logo'], 'Убрать логотип': ['Remove logo', 'Logo entfernen', 'Retirer le logo'],
  'Животные': ['Animals', 'Tiere', 'Animaux'],
  'Курицы': ['Chickens', 'Hühner', 'Poules'],
  'Свиньи': ['Pigs', 'Schweine', 'Cochons'],
  'Коровы': ['Cows', 'Kühe', 'Vaches'],
  'Заспавнить': ['Spawn', 'Spawnen', 'Faire apparaître'],
  'Скопировать для консоли': ['Copy for console', 'Für Konsole kopieren', 'Copier pour la console'],
  'Убрать всех животных': ['Remove all animals', 'Alle Tiere entfernen', 'Retirer tous les animaux'],
  'Сколько:': ['How many:', 'Wie viele:', 'Combien :'],
  'Подробная статистика (по последним матчам)': ['Detailed stats (recent matches)', 'Detaillierte Statistik (letzte Matches)', 'Statistiques détaillées (derniers matchs)'],
  'K/D по матчам (старые → новые)': ['K/D per match (old → new)', 'K/D pro Match (alt → neu)', 'K/D par match (ancien → récent)'],
  'Последние матчи': ['Recent matches', 'Letzte Matches', 'Derniers matchs'],
  'Победа': ['Win', 'Sieg', 'Victoire'],
  'Поражение': ['Loss', 'Niederlage', 'Défaite'],
  'Карта': ['Map', 'Karte', 'Carte'],
  'Итог': ['Result', 'Ergebnis', 'Résultat'],
  'Счёт': ['Score', 'Spielstand', 'Score'],
  'Рейтинг': ['Rating', 'Rating', 'Rating'],
  'Стабильность (разброс K/D)': ['Consistency (K/D spread)', 'Konstanz (K/D-Streuung)', 'Régularité (dispersion K/D)'],
  'Мультикиллы за матч': ['Multi-kills per match', 'Multikills pro Match', 'Multi-kills par match'],
  'ADR (урон за раунд)': ['ADR (damage per round)', 'ADR (Schaden pro Runde)', 'ADR (dégâts par round)'],
  'Воркшоп-карты для тренировки': ['Workshop maps for practice', 'Workshop-Karten zum Üben', 'Cartes Workshop d’entraînement'],
  '＋ Добавить все в список': ['＋ Add all to list', '＋ Alle zur Liste', '＋ Tout ajouter'],
  'Тренировка аима': ['Aim training', 'Aim-Training', 'Entraînement visée'],
  'Раскидки': ['Utility lineups', 'Granaten-Lineups', 'Utilitaires'],
  'Дуэли и AWP': ['Duels & AWP', 'Duelle & AWP', 'Duels & AWP'],
  'Движение и паркур': ['Movement & parkour', 'Bewegung & Parkour', 'Mouvement & parkour'],
  'Сервер': ['Server', 'Server', 'Serveur'], 'Игра': ['Game', 'Spiel', 'Jeu'], 'Игроки': ['Players', 'Spieler', 'Joueurs'], 'Панель и аккаунт': ['Panel & account', 'Panel & Konto', 'Panneau et compte'],
  'Обзор': ['Overview', 'Übersicht', 'Aperçu'], 'Скины': ['Skins', 'Skins', 'Skins'], 'Тренировка': ['Practice', 'Training', 'Entraînement'],
  'Карты и режимы': ['Maps & modes', 'Karten & Modi', 'Cartes & modes'], 'Консоль': ['Console', 'Konsole', 'Console'], 'Настройки': ['Settings', 'Einstellungen', 'Paramètres'],
  'Плагины и флаги': ['Plugins & flags', 'Plugins & Flags', 'Plugins & flags'], 'Админы': ['Admins', 'Admins', 'Admins'], 'Оформление': ['Appearance', 'Darstellung', 'Apparence'],
  'Профиль': ['Profile', 'Profil', 'Profil'], 'Сервер': ['Server', 'Server', 'Serveur'], 'Бэкапы и логи': ['Backups & logs', 'Backups & Logs', 'Sauvegardes & journaux'],
  'Справка': ['Help', 'Hilfe', 'Aide'], 'Панель': ['Panel', 'Panel', 'Panneau'], 'Поиск (Ctrl+K)': ['Search (Ctrl+K)', 'Suche (Strg+K)', 'Recherche (Ctrl+K)'],
  'Свернуть меню': ['Collapse menu', 'Menü einklappen', 'Réduire le menu'], 'Развернуть меню': ['Expand menu', 'Menü ausklappen', 'Développer le menu'],
  'Быстрый поиск': ['Quick search', 'Schnellsuche', 'Recherche rapide'], 'Выйти': ['Log out', 'Abmelden', 'Se déconnecter'],
  // --- вход
  'Войти': ['Log in', 'Anmelden', 'Se connecter'], 'Войти через Steam': ['Sign in with Steam', 'Mit Steam anmelden', 'Se connecter avec Steam'], 'или': ['or', 'oder', 'ou'],
  'Логин': ['Username', 'Benutzername', 'Identifiant'], 'Пароль': ['Password', 'Passwort', 'Mot de passe'], 'Неверный логин или пароль': ['Wrong username or password', 'Benutzername oder Passwort falsch', 'Identifiant ou mot de passe incorrect'],
  'Нужен вход': ['Login required', 'Anmeldung erforderlich', 'Connexion requise'], 'Нет связи с панелью': ['No connection to the panel', 'Keine Verbindung zum Panel', 'Pas de connexion au panneau'],
  'Слишком много попыток, подождите немного': ['Too many attempts, please wait', 'Zu viele Versuche, bitte warten', 'Trop de tentatives, patientez'],
  // --- общие кнопки/слова
  'Сохранить': ['Save', 'Speichern', 'Enregistrer'], 'Сохранено': ['Saved', 'Gespeichert', 'Enregistré'], 'Отмена': ['Cancel', 'Abbrechen', 'Annuler'], 'Закрыть': ['Close', 'Schließen', 'Fermer'],
  'Удалить': ['Delete', 'Löschen', 'Supprimer'], 'Убрать': ['Remove', 'Entfernen', 'Retirer'], 'Обновить': ['Refresh', 'Aktualisieren', 'Actualiser'], 'Сбросить': ['Reset', 'Zurücksetzen', 'Réinitialiser'],
  'Сбросить всё': ['Reset all', 'Alles zurücksetzen', 'Tout réinitialiser'], 'Применить': ['Apply', 'Anwenden', 'Appliquer'], 'Добавить': ['Add', 'Hinzufügen', 'Ajouter'],
  'Показать': ['Show', 'Anzeigen', 'Afficher'], 'Скопировать': ['Copy', 'Kopieren', 'Copier'], 'Скопировано': ['Copied', 'Kopiert', 'Copié'], 'Загрузка…': ['Loading…', 'Lädt…', 'Chargement…'],
  'Загрузка настроек…': ['Loading settings…', 'Einstellungen werden geladen…', 'Chargement des paramètres…'], 'Выбрать': ['Select', 'Auswählen', 'Choisir'], 'Все': ['All', 'Alle', 'Tous'],
  'Имя': ['Name', 'Name', 'Nom'], 'Название': ['Title', 'Titel', 'Titre'], 'Описание': ['Description', 'Beschreibung', 'Description'], 'Время': ['Time', 'Zeit', 'Heure'], 'Кто': ['Who', 'Wer', 'Qui'],
  'Действие': ['Action', 'Aktion', 'Action'], 'Детали': ['Details', 'Details', 'Détails'], 'Статус': ['Status', 'Status', 'Statut'], 'Версия': ['Version', 'Version', 'Version'], 'Нагрузка': ['Load', 'Auslastung', 'Charge'],
  'Включена': ['On', 'Läuft', 'Allumée'], 'Выключена': ['Off', 'Aus', 'Éteinte'], 'Запускается…': ['Starting…', 'Startet…', 'Démarrage…'], 'Выключается…': ['Stopping…', 'Fährt herunter…', 'Arrêt…'],
  'вкл': ['on', 'an', 'activé'], 'выкл': ['off', 'aus', 'désactivé'], 'Ничего не найдено.': ['Nothing found.', 'Nichts gefunden.', 'Rien trouvé.'], 'Не найдено': ['Not found', 'Nicht gefunden', 'Introuvable'],
  'Пароль изменён': ['Password changed', 'Passwort geändert', 'Mot de passe modifié'], 'Сменить пароль': ['Change password', 'Passwort ändern', 'Changer le mot de passe'],
  'Текущий пароль': ['Current password', 'Aktuelles Passwort', 'Mot de passe actuel'], 'Новый пароль (≥10 символов)': ['New password (≥10 characters)', 'Neues Passwort (≥10 Zeichen)', 'Nouveau mot de passe (≥10 caractères)'],
  'Неверный текущий пароль': ['Wrong current password', 'Aktuelles Passwort falsch', 'Mot de passe actuel incorrect'],
  // --- обзор / сервер
  'Виртуальная машина': ['Virtual machine', 'Virtuelle Maschine', 'Machine virtuelle'], 'Публичный IP': ['Public IP', 'Öffentliche IP', 'IP publique'], 'Конфигурация': ['Configuration', 'Konfiguration', 'Configuration'],
  'Подключиться': ['Connect', 'Verbinden', 'Se connecter'], '▶ Включить сервер': ['▶ Start server', '▶ Server starten', '▶ Démarrer le serveur'], '■ Выключить сервер': ['■ Stop server', '■ Server stoppen', '■ Arrêter le serveur'],
  'Запустить сервер': ['Start server', 'Server starten', 'Démarrer le serveur'], 'Сервер CS2': ['CS2 server', 'CS2-Server', 'Serveur CS2'], 'Сервис': ['Service', 'Dienst', 'Service'], 'Карта': ['Map', 'Karte', 'Carte'],
  'Игроки': ['Players', 'Spieler', 'Joueurs'], 'Версия игры': ['Game version', 'Spielversion', 'Version du jeu'], 'Диск данных': ['Data disk', 'Datenplatte', 'Disque de données'],
  'Перезапустить CS2': ['Restart CS2', 'CS2 neu starten', 'Redémarrer CS2'], 'Стоп': ['Stop', 'Stopp', 'Arrêt'], 'Старт': ['Start', 'Start', 'Démarrer'], 'Сменить карту': ['Change map', 'Karte wechseln', 'Changer de carte'],
  'Сервер запускается…': ['Server is starting…', 'Server startet…', 'Le serveur démarre…'], 'Сервер выключен': ['Server is off', 'Server ist aus', 'Serveur éteint'],
  'Скопировать для консоли CS2': ['Copy for the CS2 console', 'Für die CS2-Konsole kopieren', 'Copier pour la console CS2'], 'Откроет Steam и подключит к серверу': ['Opens Steam and joins the server', 'Öffnet Steam und verbindet mit dem Server', 'Ouvre Steam et rejoint le serveur'],
  'Дождитесь запуска CS2': ['Wait for CS2 to start', 'Warten, bis CS2 gestartet ist', 'Attendez le démarrage de CS2'],
  // --- скины
  'Скины, ножи, перчатки, агенты': ['Skins, knives, gloves, agents', 'Skins, Messer, Handschuhe, Agenten', 'Skins, couteaux, gants, agents'], 'Ножи': ['Knives', 'Messer', 'Couteaux'], 'Перчатки': ['Gloves', 'Handschuhe', 'Gants'],
  'Винтовки': ['Rifles', 'Gewehre', 'Fusils'], 'Пистолеты': ['Pistols', 'Pistolen', 'Pistolets'], 'Пистолеты-пулемёты': ['SMGs', 'MPs', 'Pistolets-mitrailleurs'], 'Тяжёлое': ['Heavy', 'Schwere Waffen', 'Armes lourdes'],
  'Агенты': ['Agents', 'Agenten', 'Agents'], 'Музыка': ['Music', 'Musik', 'Musique'], 'Свои': ['Custom', 'Eigene', 'Perso'], 'Нож': ['Knife', 'Messer', 'Couteau'], 'Агент': ['Agent', 'Agent', 'Agent'],
  'Сортировка': ['Sort', 'Sortierung', 'Tri'], 'Сортировка:': ['Sort:', 'Sortierung:', 'Tri :'], 'По умолчанию': ['Default', 'Standard', 'Par défaut'], 'По названию А–Я': ['By name A–Z', 'Nach Name A–Z', 'Par nom A–Z'],
  'Редкость: высокая → низкая': ['Rarity: high → low', 'Seltenheit: hoch → niedrig', 'Rareté : haute → basse'], 'Редкость: низкая → высокая': ['Rarity: low → high', 'Seltenheit: niedrig → hoch', 'Rareté : basse → haute'],
  'Float: меньше → больше': ['Float: low → high', 'Float: niedrig → hoch', 'Float : bas → haut'], 'Float: больше → меньше': ['Float: high → low', 'Float: hoch → niedrig', 'Float : haut → bas'],
  'Надетые первыми': ['Equipped first', 'Angelegte zuerst', 'Équipés en premier'], 'Все ножи': ['All knives', 'Alle Messer', 'Tous les couteaux'], 'Предпросмотр': ['Preview', 'Vorschau', 'Aperçu'], 'Износ': ['Wear', 'Abnutzung', 'Usure'],
  'Паттерн': ['Pattern', 'Muster', 'Motif'], 'Прямо с завода': ['Factory New', 'Neuwertig', 'Neuf'], 'Немного поношенное': ['Minimal Wear', 'Kaum gebraucht', 'Très peu usé'], 'После полевых': ['Field-Tested', 'Einsatzspuren', 'Testé sur le terrain'],
  'Поношенное': ['Well-Worn', 'Abgenutzt', 'Usé'], 'Закалённое в боях': ['Battle-Scarred', 'Kampfspuren', 'Marqué par les combats'], 'Ваниль': ['Vanilla', 'Vanilla', 'Vanilla'], 'Надето': ['Equipped', 'Angelegt', 'Équipé'],
  'Сейчас надето': ['Currently equipped', 'Aktuell angelegt', 'Actuellement équipé'], 'Надеть скин': ['Equip skin', 'Skin anlegen', 'Équiper le skin'], 'Снять скин': ['Remove skin', 'Skin entfernen', 'Retirer le skin'],
  'Надеть нож': ['Equip knife', 'Messer anlegen', 'Équiper le couteau'], 'Надеть перчатки': ['Equip gloves', 'Handschuhe anlegen', 'Équiper les gants'], 'Снять перчатки': ['Remove gloves', 'Handschuhe entfernen', 'Retirer les gants'],
  'Надеть агента': ['Equip agent', 'Agent anlegen', "Équiper l'agent"], 'Случайный': ['Random', 'Zufall', 'Aléatoire'], 'Перезагрузить плагин': ['Reload plugin', 'Plugin neu laden', 'Recharger le plugin'],
  'Игрок:': ['Player:', 'Spieler:', 'Joueur :'], 'Открыть по SteamID': ['Open by SteamID', 'Per SteamID öffnen', 'Ouvrir par SteamID'], 'Показать ещё': ['Show more', 'Mehr anzeigen', 'Afficher plus'],
  'Поиск: «редлайн», fade, ak, карамбит…': ['Search: “redline”, fade, ak, karambit…', 'Suche: „Redline“, Fade, AK, Karambit…', 'Recherche : « redline », fade, ak, karambit…'],
  'Конкретное оружие: ak-47, m4a1-s, awp, карамбит…': ['Specific weapon: ak-47, m4a1-s, awp, karambit…', 'Bestimmte Waffe: AK-47, M4A1-S, AWP, Karambit…', 'Arme précise : ak-47, m4a1-s, awp, karambit…'],
  'Свои скины (по Paint ID)': ['Custom skins (by Paint ID)', 'Eigene Skins (per Paint-ID)', 'Skins perso (par Paint ID)', ],
  // --- профиль
  'Steam': ['Steam', 'Steam', 'Steam'], 'Steam привязан': ['Steam linked', 'Steam verknüpft', 'Steam lié'], 'Steam не привязан': ['Steam not linked', 'Steam nicht verknüpft', 'Steam non lié'],
  'Привязать Steam-аккаунт': ['Link Steam account', 'Steam-Konto verknüpfen', 'Lier un compte Steam'], 'Отвязать': ['Unlink', 'Trennen', 'Délier'], 'Сохранить почту': ['Save e-mail', 'E-Mail speichern', "Enregistrer l'e-mail"],
  'Почта сохранена': ['E-mail saved', 'E-Mail gespeichert', 'E-mail enregistré'], 'Игроки': ['Players', 'Spieler', 'Joueurs'], 'Полезные ссылки': ['Useful links', 'Nützliche Links', 'Liens utiles'],
  'Добавить ссылку': ['Add link', 'Link hinzufügen', 'Ajouter un lien'], 'FACEIT: ELO и статистика': ['FACEIT: ELO & stats', 'FACEIT: ELO & Statistik', 'FACEIT : ELO et stats'], 'Сохранить ключ': ['Save key', 'Schlüssel speichern', 'Enregistrer la clé'],
  'Удалить ключ': ['Delete key', 'Schlüssel löschen', 'Supprimer la clé'], 'Ключ сохранён': ['Key saved', 'Schlüssel gespeichert', 'Clé enregistrée'], 'Где взять ключ ↗': ['Get a key ↗', 'Schlüssel holen ↗', 'Obtenir une clé ↗'],
  'Открыть профиль на FACEIT ↗': ['Open FACEIT profile ↗', 'FACEIT-Profil öffnen ↗', 'Ouvrir le profil FACEIT ↗'], 'Матчей': ['Matches', 'Matches', 'Matchs'], 'Побед, %': ['Win rate, %', 'Siegquote, %', 'Victoires, %'],
  'K/D': ['K/D', 'K/D', 'K/D'], 'HS, %': ['HS, %', 'HS, %', 'HS, %'], 'Серия побед': ['Win streak', 'Siegesserie', 'Série de victoires'], 'Рекорд серии': ['Best streak', 'Beste Serie', 'Meilleure série'],
  'Анализ игры': ['Game analysis', 'Spielanalyse', 'Analyse de jeu'], 'Карты FACEIT': ['FACEIT maps', 'FACEIT-Karten', 'Cartes FACEIT'], 'Последние матчи': ['Recent matches', 'Letzte Matches', 'Derniers matchs'],
  // --- оформление
  'Тема': ['Theme', 'Design', 'Thème'], 'Как в системе': ['System', 'Wie System', 'Système'], 'Тёмная': ['Dark', 'Dunkel', 'Sombre'], 'Светлая': ['Light', 'Hell', 'Clair'], 'Акцентный цвет': ['Accent color', 'Akzentfarbe', "Couleur d'accent"],
  'Язык': ['Language', 'Sprache', 'Langue'], 'Погода интерфейса': ['Interface weather', 'Oberflächen-Wetter', "Météo de l'interface"], 'Снег': ['Snow', 'Schnee', 'Neige'], 'Дождь': ['Rain', 'Regen', 'Pluie'], 'Ясно': ['Clear', 'Klar', 'Dégagé'],
  'Свой цвет:': ['Custom color:', 'Eigene Farbe:', 'Couleur perso :'],
  // --- настройки / плагины / админы / бэкапы
  'Настройки сервера': ['Server settings', 'Servereinstellungen', 'Paramètres du serveur'], 'Имя сервера': ['Server name', 'Servername', 'Nom du serveur'], 'Пароль входа': ['Join password', 'Beitrittspasswort', "Mot de passe d'accès"],
  'пусто = без пароля': ['empty = no password', 'leer = kein Passwort', 'vide = sans mot de passe'], 'Слотов': ['Slots', 'Slots', 'Slots'], 'Карты': ['Maps', 'Karten', 'Cartes'], 'Режимы игры': ['Game modes', 'Spielmodi', 'Modes de jeu'],
  'Плагины': ['Plugins', 'Plugins', 'Plugins'], 'Плагин': ['Plugin', 'Plugin', 'Plugin'], 'Права': ['Permissions', 'Rechte', 'Droits'], 'Флаги': ['Flags', 'Flags', 'Flags'], 'Админы сервера': ['Server admins', 'Server-Admins', 'Admins du serveur'],
  'Админы сохранены': ['Admins saved', 'Admins gespeichert', 'Admins enregistrés'], 'Права владельца менять нельзя': ['The owner’s rights cannot be changed', 'Rechte des Besitzers können nicht geändert werden', 'Les droits du propriétaire ne sont pas modifiables'],
  'владелец': ['owner', 'Besitzer', 'propriétaire'], 'Бэкап': ['Backup', 'Backup', 'Sauvegarde'], 'Сделать бэкап сейчас': ['Create backup now', 'Jetzt Backup erstellen', 'Créer une sauvegarde maintenant'],
  'Восстановить': ['Restore', 'Wiederherstellen', 'Restaurer'], 'Логи': ['Logs', 'Logs', 'Journaux'], 'Журнал действий': ['Activity log', 'Aktivitätsprotokoll', "Journal d'activité"], 'Очистить': ['Clean up', 'Bereinigen', 'Nettoyer'],
  'Очистка кэшей и мусора': ['Cache & junk cleanup', 'Cache- und Müllbereinigung', 'Nettoyage des caches et déchets'], 'Очистка выполнена': ['Cleanup done', 'Bereinigung abgeschlossen', 'Nettoyage terminé'],
  // --- консоль / тренировка
  'Консоль RCON': ['RCON console', 'RCON-Konsole', 'Console RCON'], 'Отправить': ['Send', 'Senden', 'Envoyer'], 'Боты': ['Bots', 'Bots', 'Bots'], 'Добавить бота': ['Add bot', 'Bot hinzufügen', 'Ajouter un bot'],
  'Удалить ботов': ['Remove bots', 'Bots entfernen', 'Retirer les bots'], 'Читы': ['Cheats', 'Cheats', 'Triche'], 'Приколы': ['Fun', 'Spaß', 'Fun'], 'Разминка': ['Warmup', 'Aufwärmen', 'Échauffement'], 'Рестарт раунда': ['Restart round', 'Runde neu starten', 'Relancer la manche'],
  'Соревновательный': ['Competitive', 'Wettkampf', 'Compétitif'], 'Бомба': ['Bomb', 'Bombe', 'Bombe'], 'Заложники': ['Hostages', 'Geiseln', 'Otages'], 'Воркшоп': ['Workshop', 'Workshop', 'Workshop'],
  // --- профиль: пояснения
  'Почта хранится только в панели (для связи и будущих уведомлений); письма панель сама не рассылает.': ['The e-mail is stored in the panel only (for contact and future notifications); the panel does not send mail itself.', 'Die E-Mail wird nur im Panel gespeichert (für Kontakt und spätere Benachrichtigungen); das Panel versendet selbst keine Mails.', "L’e-mail n’est stocké que dans le panneau (contact et futures notifications) ; le panneau n’envoie pas de courrier."],
  'Остальные сессии этого пользователя будут закрыты.': ['Other sessions of this user will be signed out.', 'Andere Sitzungen dieses Benutzers werden beendet.', "Les autres sessions de cet utilisateur seront fermées."],
  'Привязка проверяется через официальный вход Steam (OpenID): пароль Steam панель не видит. После привязки на экране входа работает кнопка «Войти через Steam».': ['Linking is verified through the official Steam sign-in (OpenID): the panel never sees your Steam password. Afterwards the “Sign in with Steam” button works on the login screen.', 'Die Verknüpfung wird über die offizielle Steam-Anmeldung (OpenID) geprüft: Dein Steam-Passwort sieht das Panel nie. Danach funktioniert „Mit Steam anmelden“ auf dem Anmeldebildschirm.', "La liaison est vérifiée via la connexion Steam officielle (OpenID) : le panneau ne voit jamais votre mot de passe Steam. Ensuite, « Se connecter avec Steam » fonctionne sur l’écran de connexion."],
  'Разрешить вход любому игроку через Steam (только свои скины и профиль)': ['Allow any player to sign in with Steam (own skins and profile only)', 'Jedem Spieler die Steam-Anmeldung erlauben (nur eigene Skins und Profil)', "Autoriser tout joueur à se connecter via Steam (uniquement ses skins et son profil)"],
  'Игрок попадает в панель по кнопке «Войти через Steam»: ему доступны скины, профиль и информация о сервере — ничего больше. Лимит: 300 аккаунтов игроков.': ['Players enter via “Sign in with Steam” and get skins, profile and server info — nothing else. Limit: 300 player accounts.', 'Spieler kommen über „Mit Steam anmelden“ und erhalten Skins, Profil und Serverinfo — sonst nichts. Limit: 300 Spielerkonten.', "Les joueurs entrent via « Se connecter avec Steam » et accèdent aux skins, au profil et aux infos serveur — rien d’autre. Limite : 300 comptes."],
  'Без API-ключа FACEIT ELO и статистику показать нельзя. Бесплатный ключ создаётся на developers.faceit.com (Server side API key).': ['Without a FACEIT API key, ELO and stats cannot be shown. A free key is created at developers.faceit.com (Server side API key).', 'Ohne FACEIT-API-Schlüssel können ELO und Statistik nicht angezeigt werden. Ein kostenloser Schlüssel wird auf developers.faceit.com erstellt (Server side API key).', "Sans clé API FACEIT, l’ELO et les stats ne peuvent pas s’afficher. Une clé gratuite se crée sur developers.faceit.com (Server side API key)."],
  'Русский · English · Deutsch · Français. Длинные справочные тексты пока на русском.': ['Русский · English · Deutsch · Français. Long help texts are still in Russian.', 'Русский · English · Deutsch · Français. Lange Hilfetexte sind noch auf Russisch.', 'Русский · English · Deutsch · Français. Les longs textes d’aide sont encore en russe.'],
  'Нужна включённая игровая ВМ. Файлы игры, скины и настройки не затрагиваются.': ['The game VM must be running. Game files, skins and settings are not touched.', 'Die Spiel-VM muss laufen. Spieldateien, Skins und Einstellungen bleiben unberührt.', 'La VM de jeu doit être allumée. Les fichiers du jeu, skins et réglages ne sont pas touchés.'],
};

// Шаблоны с числами/именами: [регэксп по русской строке, [en, de, fr]] — «$1» подставляется.
const P = [
  [/^Показать ещё \((\d+)\)$/, ['Show more ($1)', 'Mehr anzeigen ($1)', 'Afficher plus ($1)']],
  [/^Выйти \((.+)\)$/, ['Log out ($1)', 'Abmelden ($1)', 'Se déconnecter ($1)']],
  [/^Аккаунт: (.+)$/, ['Account: $1', 'Konto: $1', 'Compte : $1']],
  [/^Роль: администратор — полный доступ\.$/, ['Role: administrator — full access.', 'Rolle: Administrator — voller Zugriff.', 'Rôle : administrateur — accès complet.']],
  [/^Админ (\d+) указан дважды$/, ['Admin $1 is listed twice', 'Admin $1 ist doppelt aufgeführt', 'Admin $1 apparaît deux fois']],
  [/^Занято: (.+)$/, ['Busy: $1', 'Beschäftigt: $1', 'Occupé : $1']],
  [/^(\d+) скинов$/, ['$1 skins', '$1 Skins', '$1 skins']],
  [/^Карта: (.+)$/, ['Map: $1', 'Karte: $1', 'Carte : $1']],
  [/^Игроков: (.+)$/, ['Players: $1', 'Spieler: $1', 'Joueurs : $1']],
  [/^Свободная RAM: (.+)$/, ['Free RAM: $1', 'Freier RAM: $1', 'RAM libre : $1']],
  [/^Новый пароль: минимум (\d+) символов$/, ['New password: at least $1 characters', 'Neues Passwort: mindestens $1 Zeichen', 'Nouveau mot de passe : au moins $1 caractères']],
];

function tr(s) {
  if (LANG === 'ru' || typeof s !== 'string' || !s) return s;
  const i = LANG_IDX[LANG];
  const hit = D[s]; if (hit && hit[i]) return hit[i];
  for (const [re, t] of P) { const m = re.exec(s); if (m && t[i]) return t[i].replace(/\$(\d)/g, (_x, n) => m[Number(n)] ?? ''); }
  return s;
}

// Подсказки анализа FACEIT: код → шаблон по языкам, {x} подставляется из параметров.
const TIPS = {
  next_level: { ru: 'До уровня {level} не хватает {need} ELO — держите стабильную форму, каждый выигранный матч приближает.', en: '{need} ELO to reach level {level} — keep a steady form, every win gets you closer.', de: 'Bis Level {level} fehlen {need} ELO — bleib konstant, jeder Sieg bringt dich näher.', fr: "Il manque {need} ELO pour le niveau {level} — restez régulier, chaque victoire vous rapproche." },
  no_stats: { ru: 'Статистика матчей недоступна.', en: 'Match stats are unavailable.', de: 'Match-Statistiken sind nicht verfügbar.', fr: 'Les statistiques de match sont indisponibles.' },
  few_matches: { ru: 'Матчей всего {n} — выводы предварительные, нужна большая выборка (30+).', en: 'Only {n} matches — conclusions are tentative, you need a bigger sample (30+).', de: 'Nur {n} Matches — Schlüsse sind vorläufig, es braucht mehr Daten (30+).', fr: "Seulement {n} matchs — conclusions provisoires, il faut plus de données (30+)." },
  kd_low: { ru: 'K/D {kd} ниже 0.9: упор на позиции и трейды (не пикать в одиночку), тренируйте прицел на DM/Aim Botz и не берите лишних дуэлей без поддержки.', en: 'K/D {kd} is below 0.9: focus on positioning and trades (don’t peek alone), practice aim on DM/Aim Botz and avoid unsupported duels.', de: 'K/D {kd} liegt unter 0,9: achte auf Positionen und Trades (nicht allein peeken), trainiere Aim auf DM/Aim Botz und meide Duelle ohne Support.', fr: 'Un K/D de {kd} est sous 0,9 : travaillez le placement et les trades (ne peekez pas seul), entraînez le aim sur DM/Aim Botz et évitez les duels sans soutien.' },
  kd_high: { ru: 'K/D {kd} — сильный показатель: вы выигрываете дуэли чаще среднего.', en: 'K/D {kd} is strong: you win duels more often than average.', de: 'K/D {kd} ist stark: du gewinnst überdurchschnittlich oft Duelle.', fr: 'Un K/D de {kd} est solide : vous gagnez plus de duels que la moyenne.' },
  kd_mid: { ru: 'K/D {kd} — на уровне среднего; рост даст стабильный прицел и экономика гранат.', en: 'K/D {kd} is about average; steadier aim and better utility usage will lift it.', de: 'K/D {kd} ist durchschnittlich; stabileres Aim und besserer Granateneinsatz heben ihn.', fr: 'Un K/D de {kd} est moyen ; un aim plus stable et un meilleur usage des grenades le feront progresser.' },
  hs_low: { ru: 'HS {hs}% — низковато: держите прицел на уровне головы, короткие очереди/тапы вместо длинного спрея.', en: 'HS {hs}% is low: keep your crosshair at head level, use taps and short bursts instead of long sprays.', de: 'HS {hs}% ist niedrig: Fadenkreuz auf Kopfhöhe halten, Taps und kurze Bursts statt langem Spray.', fr: 'HS {hs}% est bas : gardez le viseur à hauteur de tête, tapez ou tirez en rafales courtes plutôt qu’en longs sprays.' },
  hs_high: { ru: 'HS {hs}% — отличная точность по голове.', en: 'HS {hs}% — excellent headshot accuracy.', de: 'HS {hs}% — hervorragende Kopfschuss-Präzision.', fr: 'HS {hs}% — excellente précision à la tête.' },
  wr_low: { ru: 'Винрейт {wr}% — ниже 46%: разберите проигранные матчи (демо), чаще играйте в группе и по комам, не тильтуйте после поражений.', en: 'Win rate {wr}% is under 46%: review lost matches (demos), play in a party with comms, and don’t tilt after losses.', de: 'Siegquote {wr}% unter 46%: Verlorene Matches (Demos) auswerten, mit Team/Comms spielen, nach Niederlagen nicht tilten.', fr: 'Taux de victoire {wr}% sous 46% : analysez vos défaites (démos), jouez en groupe avec comms, évitez le tilt.' },
  wr_high: { ru: 'Винрейт {wr}% — вы стабильно приносите победы.', en: 'Win rate {wr}% — you consistently bring wins.', de: 'Siegquote {wr}% — du holst konstant Siege.', fr: 'Taux de victoire {wr}% — vous apportez des victoires régulièrement.' },
  kd_wr_gap: { ru: 'K/D {kd} хороший, но винрейт {wr}%: фраги не конвертируются в победы — играйте на раунд (трейды, ретейки, план на бомбу), а не на личную статистику.', en: 'K/D {kd} is good but the win rate is {wr}%: frags don’t convert into wins — play for the round (trades, retakes, bomb plan), not personal stats.', de: 'K/D {kd} ist gut, die Siegquote aber {wr}%: Frags werden nicht zu Siegen — spiel für die Runde (Trades, Retakes, Bombenplan), nicht für Stats.', fr: 'Un bon K/D ({kd}) mais {wr}% de victoires : les frags ne se convertissent pas — jouez pour la manche (trades, retakes, plan bombe).' },
  wr_over_kd: { ru: 'Винрейт {wr}% при K/D {kd}: вы выигрываете за счёт игры на команду — добавьте личный импакт (энтри, флеши) и прицел.', en: 'Win rate {wr}% with K/D {kd}: you win through teamplay — add personal impact (entries, flashes) and aim.', de: 'Siegquote {wr}% bei K/D {kd}: du gewinnst über Teamplay — ergänze persönlichen Impact (Entries, Flashes) und Aim.', fr: 'Taux de victoire {wr}% avec un K/D de {kd} : vous gagnez par le jeu d’équipe — ajoutez de l’impact personnel (entrées, flashs) et du aim.' },
  slump: { ru: 'Последние 5 матчей: побед {w} — серия неудач. Сделайте паузу, разберите демо и разомнитесь перед следующей игрой.', en: 'Last 5 matches: {w} win(s) — a rough patch. Take a break, review a demo and warm up before the next game.', de: 'Letzte 5 Matches: {w} Sieg(e) — Durststrecke. Pause machen, Demo ansehen, vor dem nächsten Spiel aufwärmen.', fr: '5 derniers matchs : {w} victoire(s) — mauvaise passe. Faites une pause, analysez une démo et échauffez-vous avant la prochaine partie.' },
  hot: { ru: 'Последние 5 матчей: побед {w} — вы в форме, пользуйтесь моментом.', en: 'Last 5 matches: {w} wins — you’re in form, make the most of it.', de: 'Letzte 5 Matches: {w} Siege — du bist in Form, nutze es.', fr: '5 derniers matchs : {w} victoires — vous êtes en forme, profitez-en.' },
  streak: { ru: 'Текущая серия побед: {n}.', en: 'Current win streak: {n}.', de: 'Aktuelle Siegesserie: {n}.', fr: 'Série de victoires en cours : {n}.' },
  best_map: { ru: 'Лучшая карта — {map}: винрейт {wr}% за {n} матчей. Берите её в вето/пик чаще.', en: 'Best map — {map}: {wr}% win rate over {n} matches. Pick it more often.', de: 'Beste Karte — {map}: {wr}% Siegquote in {n} Matches. Öfter picken.', fr: 'Meilleure carte — {map} : {wr}% de victoires sur {n} matchs. Choisissez-la plus souvent.' },
  worst_map: { ru: 'Слабая карта — {map}: винрейт {wr}% за {n} матчей. Баньте её или потренируйте раскидки и позиции на ней.', en: 'Weak map — {map}: {wr}% win rate over {n} matches. Ban it or practice its utility and positions.', de: 'Schwache Karte — {map}: {wr}% Siegquote in {n} Matches. Bannen oder Utility und Positionen dort üben.', fr: 'Carte faible — {map} : {wr}% de victoires sur {n} matchs. Bannissez-la ou travaillez ses utilitaires et positions.' },
  map_kd_low: { ru: 'На карте {map} K/D всего {kd} — поработайте над позициями и дуэлями именно там.', en: 'On {map} your K/D is only {kd} — work on positions and duels there.', de: 'Auf {map} liegt dein K/D nur bei {kd} — dort Positionen und Duelle verbessern.', fr: 'Sur {map} votre K/D n’est que de {kd} — travaillez placements et duels là-bas.' },
  trend_up: { ru: 'Форма растёт: K/D за последние 10 матчей {a} против {b} раньше — продолжайте в том же духе.', en: 'Form is rising: K/D over the last 10 matches is {a} vs {b} before — keep it going.', de: 'Formkurve steigt: K/D der letzten 10 Matches {a} gegenüber {b} davor — weiter so.', fr: 'Forme en hausse : K/D sur les 10 derniers matchs {a} contre {b} avant — continuez.' },
  trend_down: { ru: 'Форма падает: K/D за последние 10 матчей {a} против {b} раньше. Проверьте разминку (DM, Aim Botz), сон и тильт; разберите демо последних поражений.', en: 'Form is dropping: K/D over the last 10 matches is {a} vs {b} before. Check your warm-up (DM, Aim Botz), sleep and tilt; review demos of recent losses.', de: 'Formkurve fällt: K/D der letzten 10 Matches {a} gegenüber {b} davor. Aufwärmen (DM, Aim Botz), Schlaf und Tilt prüfen; Demos der letzten Niederlagen ansehen.', fr: 'Forme en baisse : K/D sur les 10 derniers matchs {a} contre {b} avant. Vérifiez l’échauffement (DM, Aim Botz), le sommeil et le tilt ; revoyez les démos.' },
  adr_low: { ru: 'ADR {adr} ниже 65: мало урона за раунд — чаще используйте гранаты (молотов, HE), берите дуэли с поддержкой и не сидите пассивно.', en: 'ADR {adr} is under 65: low damage per round — use utility more (molotov, HE), take supported duels and avoid playing too passively.', de: 'ADR {adr} unter 65: wenig Schaden pro Runde — mehr Utility (Molotow, HE), Duelle mit Unterstützung, nicht zu passiv spielen.', fr: 'ADR {adr} sous 65 : peu de dégâts par round — utilisez plus les grenades (molotov, HE), prenez des duels soutenus et évitez la passivité.' },
  adr_high: { ru: 'ADR {adr} — высокий урон за раунд, вы реально влияете на раунды.', en: 'ADR {adr} — high damage per round, you really impact rounds.', de: 'ADR {adr} — hoher Schaden pro Runde, du beeinflusst Runden stark.', fr: 'ADR {adr} — beaucoup de dégâts par round, vous pesez sur les rounds.' },
  rating_low: { ru: 'Рейтинг (по формуле HLTV 1.0) {r} — ниже среднего (1.0): работайте над выживаемостью (меньше лишних пиков) и убийствами за раунд.', en: 'Rating (HLTV 1.0 formula) {r} is below average (1.0): work on survival (fewer needless peeks) and kills per round.', de: 'Rating (HLTV-1.0-Formel) {r} unter dem Schnitt (1.0): Überleben verbessern (weniger unnötige Peeks) und Kills pro Runde.', fr: 'Rating (formule HLTV 1.0) {r} sous la moyenne (1.0) : travaillez la survie (moins de peeks inutiles) et les kills par round.' },
  rating_high: { ru: 'Рейтинг (по формуле HLTV 1.0) {r} — выше среднего, вы приносите импакт.', en: 'Rating (HLTV 1.0 formula) {r} is above average — you bring real impact.', de: 'Rating (HLTV-1.0-Formel) {r} über dem Schnitt — du bringst echten Impact.', fr: 'Rating (formule HLTV 1.0) {r} au-dessus de la moyenne — vous avez un vrai impact.' },
  inconsistent: { ru: 'Нестабильная игра (разброс K/D {cv}): то очень хорошо, то провально. Стабильность даёт одна и та же разминка, режим дня и выбор позиций.', en: 'Inconsistent play (K/D spread {cv}): great games mixed with bad ones. A fixed warm-up, routine and steady positions bring consistency.', de: 'Schwankende Leistung (K/D-Streuung {cv}): mal sehr gut, mal schlecht. Feste Aufwärmroutine und stabile Positionen helfen.', fr: 'Jeu irrégulier (dispersion K/D {cv}) : très bon puis mauvais. Un échauffement fixe et des positions stables aident.' },
  consistent: { ru: 'Очень стабильная игра (разброс K/D {cv}) — результат предсказуем и надёжен.', en: 'Very consistent play (K/D spread {cv}) — your results are reliable.', de: 'Sehr konstantes Spiel (K/D-Streuung {cv}) — verlässliche Ergebnisse.', fr: 'Jeu très régulier (dispersion K/D {cv}) — résultats fiables.' },
  support_role: { ru: 'Много ассистов ({a} за матч) при K/D ниже 1: вы играете как саппорт — флеши и трейды важны; добавьте агрессии в дуэлях, когда есть пространство.', en: 'Many assists ({a} per match) with K/D below 1: you play a support role — flashes and trades matter; add aggression in duels when there is space.', de: 'Viele Assists ({a} pro Match) bei K/D unter 1: du spielst Support — Flashes und Trades zählen; mehr Aggression in Duellen, wenn Platz ist.', fr: 'Beaucoup d’assistances ({a} par match) avec K/D sous 1 : rôle de support — flashs et trades comptent ; plus d’agressivité en duel quand il y a de l’espace.' },
  hs_drop: { ru: 'Точность по голове упала: {a}% за последние 10 против {b}% раньше. Вернитесь к разминке на DM/Aim Botz, проверьте высоту прицела.', en: 'Headshot accuracy dropped: {a}% over the last 10 vs {b}% before. Go back to DM/Aim Botz warm-ups and check crosshair height.', de: 'Kopfschuss-Quote gefallen: {a}% in den letzten 10 gegenüber {b}% davor. Zurück zu DM/Aim-Botz-Aufwärmen, Fadenkreuzhöhe prüfen.', fr: 'Précision à la tête en baisse : {a}% sur les 10 derniers contre {b}% avant. Revenez à l’échauffement DM/Aim Botz et vérifiez la hauteur du viseur.' },
  eta_level: { ru: 'При текущем винрейте (≈{per} ELO за матч) до уровня {level} примерно {n} матчей. Оценка грубая: прирост ELO за матч зависит от силы соперников.', en: 'At your current win rate (≈{per} ELO per match) level {level} is about {n} matches away. A rough estimate: ELO gain per match depends on opponent strength.', de: 'Bei deiner aktuellen Siegquote (≈{per} ELO pro Match) sind es etwa {n} Matches bis Level {level}. Grobe Schätzung: der ELO-Gewinn hängt von der Gegnerstärke ab.', fr: 'Avec votre taux de victoire actuel (≈{per} ELO par match), le niveau {level} est à environ {n} matchs. Estimation grossière : le gain d’ELO dépend de l’adversaire.' },
  elo_stall: { ru: 'При текущем винрейте ELO не растёт (≈{per} за матч). Нужен винрейт выше 50% — играйте на раунд и с коммуникацией.', en: 'At your current win rate ELO is not growing (≈{per} per match). You need a win rate above 50% — play for the round and communicate.', de: 'Bei deiner Siegquote wächst ELO nicht (≈{per} pro Match). Nötig sind über 50% Siegquote — auf die Runde spielen und kommunizieren.', fr: 'Avec votre taux de victoire actuel l’ELO ne progresse pas (≈{per} par match). Il faut plus de 50 % — jouez le round et communiquez.' },
  drop_risk: { ru: 'До вылета на уровень ниже всего {n} ELO — не играйте на тильте, при серии поражений делайте паузу.', en: 'Only {n} ELO above dropping a level — don’t play on tilt, take a break after a losing streak.', de: 'Nur {n} ELO über dem Abstieg — nicht auf Tilt spielen, nach Niederlagenserie pausieren.', fr: 'À seulement {n} ELO de perdre un niveau — ne jouez pas sur tilt, faites une pause après une série de défaites.' },
  recent_map_weak: { ru: 'В последних матчах на {map} K/D всего {kd} ({n} игр) — потренируйте позиции и раскидки именно на этой карте.', en: 'In recent matches on {map} your K/D is only {kd} ({n} games) — practice positions and utility on that map.', de: 'In letzten Matches auf {map} liegt dein K/D nur bei {kd} ({n} Spiele) — Positionen und Utility dort üben.', fr: 'Sur {map} récemment votre K/D n’est que de {kd} ({n} parties) — travaillez positions et utilitaires sur cette carte.' },
  few_map_games: { ru: 'Мало игр на картах: {maps} — слишком мало данных для выводов, потренируйтесь на них в практике.', en: 'Few games on: {maps} — too little data to judge, practice them in training mode.', de: 'Wenige Spiele auf: {maps} — zu wenig Daten, im Trainingsmodus üben.', fr: 'Peu de parties sur : {maps} — trop peu de données, entraînez-vous dessus.' },
};
function tipText(t) {
  const row = TIPS[t.code]; if (!row) return t.code;
  return (row[LANG] || row.ru).replace(/\{(\w+)\}/g, (_x, k) => (t.p && t.p[k] != null ? t.p[k] : ''));
}
