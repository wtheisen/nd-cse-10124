(function() {
  'use strict';

  var table = document.getElementById('football-games-table');
  var search = document.getElementById('game-search');
  var season = document.getElementById('season-filter');
  var count = document.getElementById('game-count');
  var noGames = document.getElementById('no-games');
  if (!table || !search || !season || !count || !noGames) return;

  var body = table.tBodies[0];
  var rows = Array.prototype.slice.call(body.rows);

  function filterRows() {
    var query = search.value.trim().toLowerCase();
    var selectedSeason = season.value;
    var visible = 0;

    rows.forEach(function(row) {
      var matchesSeason = !selectedSeason || row.getAttribute('data-season') === selectedSeason;
      var matchesSearch = !query || row.textContent.toLowerCase().indexOf(query) !== -1;
      var show = matchesSeason && matchesSearch;
      row.hidden = !show;
      if (show) visible += 1;
    });

    count.textContent = visible === rows.length
      ? 'Showing all ' + rows.length + ' games'
      : 'Showing ' + visible + ' of ' + rows.length + ' games';
    noGames.hidden = visible !== 0;
  }

  function sortRows(button) {
    var column = Number(button.getAttribute('data-column'));
    var direction = button.getAttribute('data-direction') === 'asc' ? 'desc' : 'asc';

    Array.prototype.forEach.call(table.querySelectorAll('th button'), function(other) {
      if (other !== button) other.removeAttribute('data-direction');
    });
    button.setAttribute('data-direction', direction);
    button.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');

    rows.sort(function(a, b) {
      var left = Number(a.cells[column].textContent.trim());
      var right = Number(b.cells[column].textContent.trim());
      return direction === 'asc' ? left - right : right - left;
    });
    rows.forEach(function(row) { body.appendChild(row); });
  }

  search.addEventListener('input', filterRows);
  season.addEventListener('change', filterRows);
  Array.prototype.forEach.call(table.querySelectorAll('th button'), function(button) {
    button.addEventListener('click', function() { sortRows(button); });
  });
})();
