'use strict';
// Перевод интерфейса, часть 4: шаблоны с числами и именами + слияние всех частей в словарь.
// В шаблоне $N подставляет N-ю группу как есть, $TN — группу, переведённую через tr().
(function () {
  const X = window.__I18N_EXTRA || (window.__I18N_EXTRA = []);
  const T = [
    [/^(\p{Extended_Pictographic}\S*) (.+)$/u, ['$1 $T2', '$1 $T2', '$1 $T2']],
    [/^Нож: (.+)$/, ['Knife: $1', 'Messer: $1', 'Couteau : $1']],
    [/^([▲●▼]\d+) · (.+)$/, ['$1 · $T2', '$1 · $T2', '$1 · $T2']],
    [/^— (.+)$/, ['— $T1', '— $T1', '— $T1']],
    // --- время, пинг, сводка сервера
    [/^(\d+) д (\d+) ч$/, ['$1 d $2 h', '$1 T $2 Std', '$1 j $2 h']],
    [/^(\d+) ч (\d+) мин$/, ['$1 h $2 min', '$1 Std $2 Min', '$1 h $2 min']],
    [/^(\d+) мин$/, ['$1 min', '$1 Min', '$1 min']],
    [/^(\d+) ч$/, ['$1 h', '$1 Std', '$1 h']],
    [/^\+ (\d+) ботов$/, ['+ $1 bots', '+ $1 Bots', '+ $1 bots']],
    [/^(\d+|—) мс$/, ['$1 ms', '$1 ms', '$1 ms']],
    [/^макс\. (\d+) мс$/, ['max. $1 ms', 'max. $1 ms', 'max. $1 ms']],
    [/^канал панели (\d+) мс$/, ['panel link $1 ms', 'Panel-Verbindung $1 ms', 'liaison du panneau $1 ms']],
    [/^За всё время: (\d+) игроков · (\d+) убийств · (.+) ч игры$/, ['All time: $1 players · $2 kills · $3 h played', 'Insgesamt: $1 Spieler · $2 Kills · $3 Std gespielt', 'Au total : $1 joueurs · $2 éliminations · $3 h de jeu']],
    [/^(\s*)· топ: (.+)$/, ['$1· top: $2', '$1· Top: $2', '$1· top : $2']],
    [/^(\d+) vCPU · (\d+) ГБ · (.+)$/, ['$1 vCPU · $2 GB · $3', '$1 vCPU · $2 GB · $3', '$1 vCPU · $2 Go · $3']],
    [/^Автовыключение: через (\d+) мин без игроков \(пусто уже (\d+) мин\)$/, ['Auto-shutdown: after $1 min without players (empty for $2 min already)', 'Automatisches Abschalten: nach $1 Min. ohne Spieler (bereits $2 Min. leer)', 'Extinction automatique : après $1 min sans joueurs (vide depuis $2 min)']],
    [/^Автовыключение: через (\d+) мин без игроков$/, ['Auto-shutdown: after $1 min without players', 'Automatisches Abschalten: nach $1 Min. ohne Spieler', 'Extinction automatique : après $1 min sans joueurs']],
    [/^(\d+) \+ (\d+) ботов из (.+)$/, ['$1 + $2 bots of $3', '$1 + $2 Bots von $3', '$1 + $2 bots sur $3']],
    [/^(.+) · своб\. RAM (\d+) МБ$/, ['$1 · free RAM $2 MB', '$1 · freier RAM $2 MB', '$1 · RAM libre $2 Mo']],
    [/^свободно (.+) из (.+) ГБ$/, ['$1 of $2 GB free', '$1 von $2 GB frei', '$1 sur $2 Go libres']],
    [/^(\d+) КБ$/, ['$1 KB', '$1 KB', '$1 Ko']],
    [/^Восстановить (.+)\? CS2 остановится, конфиги и БД скинов будут заменены\.$/, ['Restore $1? CS2 will stop; configs and the skin database will be replaced.', '$1 wiederherstellen? CS2 wird gestoppt, Konfigurationen und Skin-Datenbank werden ersetzt.', 'Restaurer $1 ? CS2 s’arrêtera, les configs et la base de skins seront remplacées.']],
    [/^Нет связи с агентом: (.+)$/, ['No connection to the agent: $1', 'Keine Verbindung zum Agenten: $1', 'Pas de connexion à l’agent : $1']],
    [/^Агент недоступен: (.+)$/, ['Agent unavailable: $1', 'Agent nicht erreichbar: $1', 'Agent indisponible : $1']],
    [/^Пользователь: (.+)$/, ['User: $1', 'Benutzer: $1', 'Utilisateur : $1']],
    [/^Свободная RAM: (.+) → (.+) МБ\.$/, ['Free RAM: $1 → $2 MB.', 'Freier RAM: $1 → $2 MB.', 'RAM libre : $1 → $2 Mo.']],
    [/^файлы \((\d+) шт\., (.+) МБ\)$/, ['files ($1 pcs, $2 MB)', 'Dateien ($1 Stk., $2 MB)', 'fichiers ($1, $2 Mo)']],
    [/^Готово: (.+)\.$/, ['Done: $1.', 'Fertig: $1.', 'Terminé : $1.']],
    [/^журнал$/, ['journal', 'Journal', 'journal']], [/^кэш ОС$/, ['OS cache', 'OS-Cache', 'cache de l’OS']], [/^мир$/, ['world', 'Welt', 'monde']], [/^файлы$/, ['files', 'Dateien', 'fichiers']],
    [/^ВМ: (.+)$/, ['VM: $T1', 'VM: $T1', 'VM : $T1']],
    // --- профиль и FACEIT
    [/^(.+) \(ур\. (\d+)\)$/, ['$1 (lvl $2)', '$1 (Lvl $2)', '$1 (niv. $2)']],
    [/^ур\. (\d+)$/, ['lvl $1', 'Lvl $1', 'niv. $1']],
    [/^До уровня (\d+): (\d+) ELO$/, ['To level $1: $2 ELO', 'Bis Level $1: $2 ELO', 'Jusqu’au niveau $1 : $2 ELO']],
    [/^(\s*)· запас до вылета: (\d+) ELO$/, ['$1· buffer before dropping: $2 ELO', '$1· Puffer bis zum Abstieg: $2 ELO', '$1· marge avant la descente : $2 ELO']],
    [/^([▲▼]) (.+) к прошлым$/, ['$1 $2 vs earlier', '$1 $2 ggü. früher', '$1 $2 par rapport aux précédents']],
    [/^Рейтинг \(HLTV 1\.0\), (\d+) матчей$/, ['Rating (HLTV 1.0), $1 matches', 'Rating (HLTV 1.0), $1 Matches', 'Rating (HLTV 1.0), $1 matchs']],
    [/^последние 10: (.+)$/, ['last 10: $1', 'letzte 10: $1', '10 derniers : $1']],
    [/^10 посл\.: (.+)$/, ['last 10: $1', 'letzte 10: $1', '10 derniers : $1']],
    [/^ассистов (\d+), MVP (\d+)$/, ['assists $1, MVP $2', 'Assists $1, MVP $2', 'assistances $1, MVP $2']],
    [/^рекорд: (\d+) убийств \((.+)\)$/, ['record: $1 kills ($2)', 'Rekord: $1 Kills ($2)', 'record : $1 éliminations ($2)']],
    [/^(\d+) из (\d+)$/, ['$1 of $2', '$1 von $2', '$1 sur $2']],
    [/^Логин для входа по паролю: (.+)$/, ['Login for password sign-in: $1', 'Login für die Passwort-Anmeldung: $1', 'Identifiant pour la connexion par mot de passe : $1']],
    // --- статистика
    [/^(\d+) убийств при (\d+) смертях$/, ['$1 kills vs $2 deaths', '$1 Kills bei $2 Toden', '$1 éliminations pour $2 morts']],
    [/^(\d+) столкновений \((\d+) убийств \/ (\d+) смертей\)$/, ['$1 encounters ($2 kills / $3 deaths)', '$1 Begegnungen ($2 Kills / $3 Tode)', '$1 affrontements ($2 éliminations / $3 morts)']],
    [/^(\d+) смертей при (\d+) убийствах$/, ['$1 deaths vs $2 kills', '$1 Tode bei $2 Kills', '$1 morts pour $2 éliminations']],
    [/^Считается с (.+) по логу сервера: убийства, смерти, хедшоты, урон, гранаты, время\. Выстрелы\/пули лог не пишет\.$/, ['Counted since $1 from the server log: kills, deaths, headshots, damage, grenades, time. The log does not record shots/bullets.', 'Gezählt seit $1 aus dem Serverlog: Kills, Tode, Kopfschüsse, Schaden, Granaten, Zeit. Schüsse/Kugeln protokolliert das Log nicht.', 'Compté depuis le $1 d’après le journal du serveur : éliminations, morts, headshots, dégâts, grenades, temps. Le journal n’enregistre pas les tirs/balles.']],
    // --- палитра команд и тосты
    [/^Перейти: (.+)$/, ['Go to: $T1', 'Gehe zu: $T1', 'Aller à : $T1']],
    [/^Прикол: (.+)$/, ['Fun: $T1', 'Spaß: $T1', 'Fun : $T1']],
    [/^Тема: (.+)$/, ['Theme: $T1', 'Design: $T1', 'Thème : $T1']],
    [/^Язык: (.+)$/, ['Language: $1', 'Sprache: $1', 'Langue : $1']],
    [/^Консоль: (.+)$/, ['Console: $1', 'Konsole: $1', 'Console : $1']],
    [/^(.+) включён$/, ['$T1 enabled', '$T1 aktiviert', '$T1 activé']],
    // --- тренировка
    [/^Часть команд не принята сервером: (\d+)\. Возможно, cvar нет в этой версии CS2\.$/, ['Some commands were not accepted by the server: $1. The cvar may not exist in this CS2 version.', 'Einige Befehle wurden vom Server nicht akzeptiert: $1. Der Cvar existiert evtl. in dieser CS2-Version nicht.', 'Certaines commandes n’ont pas été acceptées par le serveur : $1. Le cvar n’existe peut-être pas dans cette version de CS2.']],
    [/^(.+): команды отправлены \((.+)\)$/, ['$T1: commands sent ($T2)', '$T1: Befehle gesendet ($T2)', '$T1 : commandes envoyées ($T2)']],
    [/^(.+): включено \(до смены карты или сброса\)$/, ['$T1: enabled (until the map changes or a reset)', '$T1: aktiviert (bis zum Kartenwechsel oder Reset)', '$T1 : activé (jusqu’au changement de carte ou à la réinitialisation)']],
    [/^(.+) \(секрет\)$/, ['$T1 (secret)', '$T1 (geheim)', '$T1 (secret)']],
    [/^Сейчас: (.+), людей (\d+), ботов (\d+)$/, ['Now: $1, humans $2, bots $3', 'Aktuell: $1, Menschen $2, Bots $3', 'Actuellement : $1, humains $2, bots $3']],
    [/^Погода по времени года \(сейчас: (.+) → «(.+)»\)$/, ['Weather by season (now: $T1 → “$T2”)', 'Wetter nach Jahreszeit (aktuell: $T1 → „$T2“)', 'Météo selon la saison (actuellement : $T1 → « $T2 »)']],
    [/^Включите ВМ на «Обзоре», дождитесь статуса CS2 «Работает», в консоли CS2 введите: connect (.+)$/, ['Turn the VM on from “Server”, wait for the CS2 status “Running”, then in the CS2 console type: connect $1', 'Schalte die VM unter „Server“ ein, warte auf den CS2-Status „Läuft“ und gib in der CS2-Konsole ein: connect $1', 'Allumez la VM depuis « Serveur », attendez le statut CS2 « En marche », puis tapez dans la console CS2 : connect $1']],
    // --- скины
    [/^Предмет (\d+)$/, ['Item $1', 'Item $1', 'Objet $1']],
    [/^(.+)\. Игроку: напишите !wp в чате \(или перезайдите\)\.$/, ['$T1. Player: type !wp in chat (or reconnect).', '$T1. Spieler: !wp im Chat schreiben (oder neu verbinden).', '$T1. Joueur : tapez !wp dans le chat (ou reconnectez-vous).']],
    [/^Набор №(\d+)$/, ['Kit #$1', 'Kit Nr. $1', 'Kit n° $1']],
    [/^Команда: (CT|T) · модель (.+)$/, ['Team: $1 · model $2', 'Team: $1 · Modell $2', 'Équipe : $1 · modèle $2']],
    [/^Снять \((CT|T)\)$/, ['Remove ($1)', 'Ablegen ($1)', 'Retirer ($1)']],
    [/^(.+) \(ваниль\)$/, ['$1 (vanilla)', '$1 (Vanilla)', '$1 (vanilla)']],
    [/^(.+) · float (.+) · паттерн (\d+)(.*)$/, ['$T1 · float $2 · pattern $3$4', '$T1 · Float $2 · Muster $3$4', '$T1 · float $2 · motif $3$4']],
    [/^оружие (\d+), скин (\d+)$/, ['weapon $1, skin $2', 'Waffe $1, Skin $2', 'arme $1, skin $2']],
    [/^([\s\S]*)\nfloat (.+), паттерн ([^,\n]+)(.*)$/, ['$1\nfloat $2, pattern $3$4', '$1\nFloat $2, Muster $3$4', '$1\nfloat $2, motif $3$4']],
    [/^(.*?)(\d{17})\. Скины попадают в базу сразу; в игре игрок пишет !wp \(или перезаходит\)\. Новые игроки появляются в списке после первого входа и выбора скина или через ввод SteamID\.$/, ['$1$2. Skins go to the database immediately; in game the player types !wp (or reconnects). New players show up in the list after their first join and skin choice, or by entering a SteamID.', '$1$2. Skins landen sofort in der Datenbank; im Spiel schreibt der Spieler !wp (oder verbindet neu). Neue Spieler erscheinen nach dem ersten Beitritt und einer Skin-Wahl in der Liste oder per SteamID-Eingabe.', '$1$2. Les skins vont immédiatement dans la base ; en jeu, le joueur tape !wp (ou se reconnecte). Les nouveaux joueurs apparaissent dans la liste après leur première connexion et un choix de skin, ou en saisissant un SteamID.']],
    // --- карты, режимы, настройки
    [/^Предпросмотр режима «(.+)»$/, ['Preview of mode “$T1”', 'Vorschau des Modus „$T1“', 'Aperçu du mode « $T1 »']],
    [/^Удалить пресет «(.+)»\?$/, ['Delete preset “$1”?', 'Preset „$1“ löschen?', 'Supprimer le préréglage « $1 » ?']],
    [/^Загружаю (.+)$/, ['Loading $1', 'Lade $1', 'Chargement de $1']],
    [/^Сейчас: пресет «(.+)», game_type (\d+) \/ game_mode (\d+), карта (.+)\. Свои пресеты хранятся на панели и доступны всем админам\.$/, ['Now: preset “$1”, game_type $2 / game_mode $3, map $4. Custom presets are stored on the panel and available to all admins.', 'Aktuell: Preset „$1“, game_type $2 / game_mode $3, Karte $4. Eigene Presets liegen im Panel und stehen allen Admins zur Verfügung.', 'Actuellement : préréglage « $1 », game_type $2 / game_mode $3, carte $4. Les préréglages perso sont stockés sur le panneau et accessibles à tous les admins.']],
    [/^Несохранённых изменений: (\d+)$/, ['Unsaved changes: $1', 'Nicht gespeicherte Änderungen: $1', 'Modifications non enregistrées : $1']],
    [/^значение: (.+)$/, ['value: $1', 'Wert: $1', 'valeur : $1']],
    [/^Не приняты: (.+)$/, ['Not accepted: $1', 'Nicht akzeptiert: $1', 'Non acceptés : $1']],
    // --- сообщения валидации
    [/^(.+): одно из (.+)$/, ['$1: one of $2', '$1: eines von $2', '$1 : l’un de $2']],
    [/^(.+): целое число (.+)–(.+)$/, ['$1: an integer $2–$3', '$1: eine ganze Zahl $2–$3', '$1 : un entier de $2 à $3']],
    [/^(.+): число (.+)…(.+)$/, ['$1: a number $2…$3', '$1: eine Zahl $2…$3', '$1 : un nombre de $2 à $3']],
    [/^agents\.(\S+): путь модели agents\/models\/….vmdl$/, ['agents.$1: model path agents/models/….vmdl', 'agents.$1: Modellpfad agents/models/….vmdl', 'agents.$1 : chemin du modèle agents/models/….vmdl']],
    [/^таблица (\S+) ещё не создана плагином — запустите сервер и дождитесь загрузки WeaponPaints$/, ['table $1 has not been created by the plugin yet — start the server and wait for WeaponPaints to load', 'Tabelle $1 wurde vom Plugin noch nicht angelegt — Server starten und auf das Laden von WeaponPaints warten', 'la table $1 n’a pas encore été créée par le plugin — démarrez le serveur et attendez le chargement de WeaponPaints']],
    [/^таблица (\S+): нет подходящих колонок$/, ['table $1: no suitable columns', 'Tabelle $1: keine passenden Spalten', 'table $1 : aucune colonne adaptée']],
    [/^id пресета: a-z, 0-9, _ и - \(до 32\): (.+)$/, ['preset id: a-z, 0-9, _ and - (up to 32): $1', 'Preset-ID: a-z, 0-9, _ und - (bis zu 32): $1', 'id du préréglage : a-z, 0-9, _ et - (32 max.) : $1']],
    [/^CS2 не отвечает: (.+)$/, ['CS2 is not responding: $1', 'CS2 antwortet nicht: $1', 'CS2 ne répond pas : $1']],
  ];

  // слияние: словарь D (из i18n.js) пополняется строками X, шаблоны ставятся в начало P
  for (const r of X) { if (r && r.length >= 4 && !D[r[0]]) D[r[0]] = [r[1], r[2], r[3]]; }
  P.unshift(...T);
})();
