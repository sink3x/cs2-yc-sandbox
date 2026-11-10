'use strict';
// Перевод интерфейса, часть 8: журнал действий, подсказки к командам. Подключается после extra7 и сам вливается в словарь.
(function () {
  const R = [
    ['Поиск по журналу…', 'Search the log…', 'Protokoll durchsuchen…', 'Rechercher dans le journal…'],
    ['Все пользователи', 'All users', 'Alle Benutzer', 'Tous les utilisateurs'], ['Все действия', 'All actions', 'Alle Aktionen', 'Toutes les actions'],
    ['Все страны', 'All countries', 'Alle Länder', 'Tous les pays'], ['Страна неизвестна', 'Unknown country', 'Land unbekannt', 'Pays inconnu'],
    ['IP (начало)', 'IP (prefix)', 'IP (Anfang)', 'IP (début)'], ['С даты', 'From date', 'Ab Datum', 'À partir du'], ['По дату', 'To date', 'Bis Datum', 'Jusqu’au'],
    ['Сбросить фильтры', 'Reset filters', 'Filter zurücksetzen', 'Réinitialiser les filtres'],
    ['IP', 'IP', 'IP', 'IP'], ['Страна', 'Country', 'Land', 'Pays'],
    ['Показано', 'Shown', 'Angezeigt', 'Affichées'], ['из', 'of', 'von', 'sur'],
    ['Определяю страны…', 'Looking up countries…', 'Länder werden ermittelt…', 'Recherche des pays…'],
    ['Ничего не найдено', 'Nothing found', 'Nichts gefunden', 'Aucun résultat'],
    ['Нажмите на пользователя, IP, страну или действие, чтобы отфильтровать по нему.', 'Click a user, IP, country or action to filter by it.', 'Klicke auf Benutzer, IP, Land oder Aktion, um danach zu filtern.', 'Cliquez sur un utilisateur, une IP, un pays ou une action pour filtrer.'],
    ['Страна определяется по IP внешним сервисом ipwho.is (отправляется только публичный адрес, ответ кэшируется на 30 дней); для внутренних адресов страны нет.', 'The country is looked up by IP via the external ipwho.is service (only the public address is sent, the answer is cached for 30 days); internal addresses have no country.', 'Das Land wird per IP über den externen Dienst ipwho.is ermittelt (nur die öffentliche Adresse wird gesendet, die Antwort wird 30 Tage gecacht); interne Adressen haben kein Land.', 'Le pays est déterminé par IP via le service externe ipwho.is (seule l’adresse publique est envoyée, la réponse est mise en cache 30 jours) ; les adresses internes n’ont pas de pays.'],
  ];
  for (const r of R) { if (r.length >= 4 && !D[r[0]]) D[r[0]] = [r[1], r[2], r[3]]; }
})();
