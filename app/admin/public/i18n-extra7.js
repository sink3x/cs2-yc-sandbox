'use strict';
// Перевод интерфейса, часть 7: страница Callouts. Подключается после extra6 и сам вливается в словарь.
(function () {
  const R = [
    ['Callouts', 'Callouts', 'Callouts', 'Callouts'], ['Места на карте', 'Places on the map', 'Orte auf der Karte', 'Lieux sur la carte'],
    ['Поиск места…', 'Search place…', 'Ort suchen…', 'Rechercher un lieu…'], ['Поиск места', 'Search place', 'Ort suchen', 'Rechercher un lieu'],
    ['Все', 'All', 'Alle', 'Tous'], ['Центр', 'Mid', 'Mitte', 'Centre'],
    ['Все названия на схеме', 'Show all labels', 'Alle Namen anzeigen', 'Afficher tous les noms'],
    ['Выберите место на схеме или в списке.', 'Pick a place on the map or in the list.', 'Wähle einen Ort auf der Karte oder in der Liste.', 'Choisissez un lieu sur la carte ou dans la liste.'],
    ['Сторона T', 'T side', 'T-Seite', 'Côté T'], ['Центр карты', 'Centre of the map', 'Kartenmitte', 'Centre de la carte'], ['Сторона CT', 'CT side', 'CT-Seite', 'Côté CT'],
    ['Рядом с точкой A', 'Near A site', 'Nahe Bombenplatz A', 'Près du site A'], ['Рядом с точкой B', 'Near B site', 'Nahe Bombenplatz B', 'Près du site B'],
    ['Между точками A и B', 'Between sites A and B', 'Zwischen den Bombenplätzen A und B', 'Entre les sites A et B'],
    ['Низкая', 'Low', 'Niedrig', 'Basse'], ['Средняя', 'Medium', 'Mittel', 'Moyenne'], ['Высокая', 'High', 'Hoch', 'Haute'],
    ['Положение мест на этой карте определено с небольшой погрешностью.', 'Place positions on this map are accurate to within a small margin.', 'Die Positionen der Orte auf dieser Karte sind nur mit kleiner Abweichung bestimmt.', 'La position des lieux sur cette carte est connue avec une petite marge d’erreur.'],
    ['Карта сильно переработана в CS2: положение мест здесь примерное, ориентируйтесь на названия.', 'This map was heavily reworked in CS2: place positions here are approximate, rely on the names.', 'Diese Karte wurde in CS2 stark überarbeitet: Die Positionen hier sind ungefähr, orientiere dich an den Namen.', 'Cette carte a été fortement remaniée dans CS2 : les positions sont approximatives, fiez-vous aux noms.'],
    ['Название в игре', 'In-game name', 'Name im Spiel', 'Nom en jeu'], ['Расположение', 'Location', 'Lage', 'Emplacement'], ['Высота', 'Height', 'Höhe', 'Hauteur'],
    ['Скопировать название', 'Copy name', 'Namen kopieren', 'Copier le nom'], ['Скопировано', 'Copied', 'Kopiert', 'Copié'], ['Не удалось скопировать', 'Could not copy', 'Kopieren fehlgeschlagen', 'Copie impossible'],
    ['Схема построена по навигационной сетке карты (это не радар Valve). Названия мест — официальные, из данных Valve; ru/de/fr — общепринятые термины сообщества. Источник данных: awpy (MIT).',
      'The map is drawn from the map’s navigation mesh (it is not the Valve radar). Place names are the official ones from Valve’s data; ru/de/fr are the community’s usual terms. Data source: awpy (MIT).',
      'Die Karte ist aus dem Navigationsnetz der Karte gezeichnet (nicht das Valve-Radar). Ortsnamen sind die offiziellen aus den Valve-Daten; ru/de/fr sind gängige Community-Begriffe. Datenquelle: awpy (MIT).',
      'La carte est dessinée à partir du maillage de navigation (ce n’est pas le radar de Valve). Les noms de lieux sont les noms officiels des données Valve ; ru/de/fr sont les termes usuels de la communauté. Source : awpy (MIT).'],
  ];
  for (const r of R) { if (r.length >= 4 && !D[r[0]]) D[r[0]] = [r[1], r[2], r[3]]; }
})();
