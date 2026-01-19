/**
 * Generate lab data for pagination
 * Returns an array of lab objects that can be paginated
 */
module.exports = async function() {
  // Import schedule data
  const scheduleData = require('./schedule.js');
  const schedule = await scheduleData();

  // Extract lab numbers from schedule
  const labNumbers = new Set();

  for (const unit of schedule) {
    if (!unit.days) continue;
    for (const day of unit.days) {
      if (!day.assignments) continue;
      for (const assignment of day.assignments) {
        const match = assignment.match(/lab\s*(\d+)/i);
        if (match) {
          labNumbers.add(parseInt(match[1], 10));
        }
      }
    }
  }

  // Convert to sorted array of lab objects
  const labs = Array.from(labNumbers)
    .sort((a, b) => a - b)
    .map(num => ({
      number: num,
      numberStr: String(num).padStart(2, '0'),
      assignmentName: `lab${String(num).padStart(2, '0')}`,
      assignmentDisplay: `Lab ${String(num).padStart(2, '0')}`
    }));

  console.log(`[11ty] Found ${labs.length} labs: ${labs.map(l => l.number).join(', ')}`);

  return labs;
};
