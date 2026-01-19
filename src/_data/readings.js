/**
 * Generate reading data for pagination
 * Returns an array of reading objects with associated topics
 */
module.exports = async function() {
  // Import schedule data
  const scheduleData = require('./schedule.js');
  const schedule = await scheduleData();

  // Map reading numbers to topics
  const readingsMap = new Map();

  for (const unit of schedule) {
    if (!unit.days) continue;
    for (const day of unit.days) {
      if (!day.assignments) continue;
      for (const assignment of day.assignments) {
        const match = assignment.match(/reading\s*(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!readingsMap.has(num)) {
            readingsMap.set(num, {
              number: num,
              numberStr: String(num).padStart(2, '0'),
              topics: [],
              topicSlugs: []
            });
          }

          // Add topic if it exists and isn't already added
          if (day.topics && !readingsMap.get(num).topics.includes(day.topics)) {
            readingsMap.get(num).topics.push(day.topics);
            if (day.topic_slug) {
              readingsMap.get(num).topicSlugs.push(day.topic_slug);
            }
          }
        }
      }
    }
  }

  // Convert to sorted array and add display properties
  const readings = Array.from(readingsMap.values())
    .sort((a, b) => a.number - b.number)
    .map(reading => {
      const topicsStr = reading.topics.length > 0
        ? reading.topics.join(' + ')
        : '';
      const title = topicsStr
        ? `Reading ${reading.numberStr}: ${topicsStr}`
        : `Reading ${reading.numberStr}`;

      return {
        ...reading,
        title,
        readingDisplay: `Reading ${reading.numberStr}`
      };
    });

  console.log(`[11ty] Found ${readings.length} readings: ${readings.map(r => r.number).join(', ')}`);

  return readings;
};
