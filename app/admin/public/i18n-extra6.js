'use strict';
// Перевод интерфейса, часть 6: стикеры на оружии, «админ в игре». Подключается после extra5 и сам вливается в словарь.
(function () {
  const R = [
    ['Пустой слот', 'Empty slot', 'Leerer Slot', 'Emplacement vide'], ['Стикеры', 'Stickers', 'Sticker', 'Autocollants'],
    ['Потёртость 0–1', 'Scratches 0–1', 'Abnutzung 0–1', 'Usure 0–1'], ['Поворот °', 'Rotation °', 'Drehung °', 'Rotation °'],
    ['Смещение X', 'Offset X', 'Versatz X', 'Décalage X'], ['Смещение Y', 'Offset Y', 'Versatz Y', 'Décalage Y'],
    ['Положение и размер в игре отличаются у разных моделей оружия — значения подбираются на глаз (осмотр F в игре).', 'Position and size differ between weapon models in game — tune the values by eye (inspect with F in game).', 'Position und Größe unterscheiden sich je nach Waffenmodell — Werte nach Augenmaß einstellen (Inspektion mit F im Spiel).', 'La position et la taille varient selon le modèle d’arme — réglez à l’œil (inspection avec F en jeu).'],
    ['Поиск стикера: название, команда, турнир, номер…', 'Search stickers: name, team, tournament, number…', 'Sticker suchen: Name, Team, Turnier, Nummer…', 'Rechercher un autocollant : nom, équipe, tournoi, numéro…'],
    ['Все типы', 'All types', 'Alle Typen', 'Tous les types'], ['Все эффекты', 'All effects', 'Alle Effekte', 'Tous les effets'], ['Все турниры', 'All tournaments', 'Alle Turniere', 'Tous les tournois'],
    ['Ничего не найдено', 'Nothing found', 'Nichts gefunden', 'Aucun résultat'], ['Загрузка…', 'Loading…', 'Wird geladen…', 'Chargement…'], ['Показать ещё', 'Show more', 'Mehr anzeigen', 'Afficher plus'],
    ['Убрать', 'Remove', 'Entfernen', 'Retirer'],
    ['Обнулить счётчик убийств StatTrak™ у этого оружия', 'Reset the StatTrak™ kill counter of this weapon', 'StatTrak™-Killzähler dieser Waffe zurücksetzen', 'Remettre à zéro le compteur de kills StatTrak™ de cette arme'],
    ['Счётчик StatTrak™ сброшен', 'StatTrak™ counter reset', 'StatTrak™-Zähler zurückgesetzt', 'Compteur StatTrak™ réinitialisé'], ['Сбросить StatTrak™', 'Reset StatTrak™', 'StatTrak™ zurücksetzen', 'Réinitialiser StatTrak™'],
    ['Админ в игре', 'In-game admin', 'Admin im Spiel', 'Admin en jeu'],
    ['Полные права (root)', 'Full rights (root)', 'Volle Rechte (root)', 'Tous les droits (root)'],
    ['Модератор: кик, бан, смена карты, чат, голосования', 'Moderator: kick, ban, change map, chat, votes', 'Moderator: Kick, Bann, Kartenwechsel, Chat, Abstimmungen', 'Modérateur : kick, ban, changement de carte, chat, votes'],
    ['Свой набор прав', 'Custom set of rights', 'Eigene Rechte', 'Droits personnalisés'],
    ['Steam не привязан: выдать права в игре можно только по SteamID64.', 'Steam is not linked: in-game rights can only be granted by SteamID64.', 'Steam nicht verknüpft: Rechte im Spiel können nur per SteamID64 vergeben werden.', 'Steam non lié : les droits en jeu ne peuvent être donnés que via le SteamID64.'],
    ['Права в игре выданы', 'In-game rights granted', 'Rechte im Spiel vergeben', 'Droits en jeu accordés'], ['Права в игре сняты', 'In-game rights revoked', 'Rechte im Spiel entzogen', 'Droits en jeu retirés'],
    ['Сервер ответил: ', 'Server replied: ', 'Server antwortete: ', 'Réponse du serveur : '], ['Список админов перечитан', 'Admin list reloaded', 'Adminliste neu geladen', 'Liste des admins rechargée'],
    ['Права применятся после смены карты или перезапуска CS2', 'Rights apply after a map change or a CS2 restart', 'Die Rechte gelten nach Kartenwechsel oder CS2-Neustart', 'Les droits s’appliquent après un changement de carte ou un redémarrage de CS2'],
    ['Сейчас у пользователя нет прав в игре.', 'The user has no in-game rights right now.', 'Der Benutzer hat derzeit keine Rechte im Spiel.', 'L’utilisateur n’a actuellement aucun droit en jeu.'],
    ['Изменить права', 'Change rights', 'Rechte ändern', 'Modifier les droits'], ['Выдать админа в игре', 'Make in-game admin', 'Admin im Spiel machen', 'Rendre admin en jeu'], ['Снять права', 'Revoke rights', 'Rechte entziehen', 'Retirer les droits'],
    ['Владелец сервера защищён: его права root снять нельзя.', 'The server owner is protected: root rights cannot be revoked.', 'Der Serverbesitzer ist geschützt: root-Rechte können nicht entzogen werden.', 'Le propriétaire du serveur est protégé : ses droits root ne peuvent pas être retirés.'],
    ['Меняет список админов сервера (SteamID64 пользователя). Если сервер выключен, изменение сохранится в панели и применится при запуске.', 'Changes the server admin list (the user’s SteamID64). If the server is off, the change is kept in the panel and applied on start.', 'Ändert die Adminliste des Servers (SteamID64 des Benutzers). Ist der Server aus, wird die Änderung im Panel gespeichert und beim Start angewendet.', 'Modifie la liste des admins du serveur (SteamID64 de l’utilisateur). Si le serveur est éteint, le changement est gardé dans le panneau et appliqué au démarrage.'],
    ['выберите хотя бы одно право', 'select at least one right', 'mindestens ein Recht wählen', 'choisissez au moins un droit'],
    ['Steam не привязан: у пользователя нет SteamID64', 'Steam is not linked: the user has no SteamID64', 'Steam nicht verknüpft: Benutzer hat keine SteamID64', 'Steam non lié : l’utilisateur n’a pas de SteamID64'],
  ];
  const T = [
    [/^Слот (\d+) пуст: выберите стикер ниже\.$/, ['Slot $1 is empty: pick a sticker below.', 'Slot $1 ist leer: Sticker unten wählen.', 'L’emplacement $1 est vide : choisissez un autocollant ci-dessous.']],
    [/^Стикер #(\d+)$/, ['Sticker #$1', 'Sticker #$1', 'Autocollant #$1']],
    [/^Найдено: (\d+)$/, ['Found: $1', 'Gefunden: $1', 'Trouvés : $1']],
    [/^Предмет (\d+)$/, ['Item $1', 'Gegenstand $1', 'Objet $1']],
  ];
  for (const r of R) { if (r.length >= 4 && !D[r[0]]) D[r[0]] = [r[1], r[2], r[3]]; }
  P.unshift(...T);
})();
