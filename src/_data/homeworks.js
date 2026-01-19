/**
 * Generate homework data for pagination
 * Returns an array of homework objects that can be paginated
 */
module.exports = async function() {
  // Import schedule data
  const scheduleData = require('./schedule.js');
  const schedule = await scheduleData();

  // Extract homework numbers from schedule
  const homeworkNumbers = new Set();

  for (const unit of schedule) {
    if (!unit.days) continue;
    for (const day of unit.days) {
      if (!day.assignments) continue;
      for (const assignment of day.assignments) {
        const match = assignment.match(/homework\s*(\d+)/i);
        if (match) {
          homeworkNumbers.add(parseInt(match[1], 10));
        }
      }
    }
  }

  // Convert to sorted array of homework objects
  const homeworks = Array.from(homeworkNumbers)
    .sort((a, b) => a - b)
    .map(num => ({
      number: num,
      numberStr: String(num).padStart(2, '0'),
      assignmentName: `homework${String(num).padStart(2, '0')}`,
      assignmentDisplay: `Homework ${String(num).padStart(2, '0')}`
    }));

  console.log(`[11ty] Found ${homeworks.length} homeworks: ${homeworks.map(h => h.number).join(', ')}`);

  return homeworks;
};
