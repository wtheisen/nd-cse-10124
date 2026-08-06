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
      // The public schedule export stores due items in the topics cell.
      // Retain support for the older assignments array as well.
      const assignments = day.assignments || (day.topics ? [day.topics] : []);
      for (const assignment of assignments) {
        const match = assignment.match(/lab\s*(\d+)/i);
        if (match) {
          labNumbers.add(parseInt(match[1], 10));
        }
      }
    }
  }

  // Convert to sorted array of lab objects
  const labMeta = {
    1: { title: 'Learning from Numbers with MNIST', points: 5 },
    2: { title: 'From Text to Model Inputs', points: 6 },
    3: { title: 'Transformer Block', points: 5 },
    4: { title: 'Supervised Fine-Tuning and Efficient Updates', points: 7 },
    5: { title: 'Grounded Notre Dame Course Assistant', points: 8 }
  };

  const labs = Array.from(labNumbers)
    .sort((a, b) => a - b)
    .map(num => {
      const meta = labMeta[num] || { title: 'Building an LLM', points: 5 };
      return {
        number: num,
        numberStr: String(num).padStart(2, '0'),
        assignmentName: `lab${String(num).padStart(2, '0')}`,
        assignmentDisplay: `Lab ${String(num).padStart(2, '0')}`,
        title: meta.title,
        points: meta.points
      };
    });

  console.log(`[11ty] Found ${labs.length} labs: ${labs.map(l => l.number).join(', ')}`);

  return labs;
};
