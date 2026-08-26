const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

module.exports = function() {
  const csvPath = path.join(
    process.cwd(),
    'static',
    'data',
    'notre_dame_football_games_2012_2022.csv'
  );
  const records = parse(fs.readFileSync(csvPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    cast: true
  });

  const wins = records.filter((game) => game.win === 1).length;

  return {
    records,
    seasons: [...new Set(records.map((game) => game.season))].sort((a, b) => a - b),
    summary: {
      games: records.length,
      wins,
      losses: records.length - wins,
      winPercentage: ((wins / records.length) * 100).toFixed(1)
    }
  };
};
