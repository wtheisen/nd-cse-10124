const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const fetchCsv = require('../../lib/fetchCsv.js');

let cachedSchedule = null;
let inFlightSchedule = null;

/**
 * Load schedule from CSV URL or local file
 * Returns: [ { name: "Unit", days: [ { date, topics, assignments, topic_slug? }, ... ] }, ... ]
 */

// Helper functions
function normalizeHeaders(headers) {
  return headers.map(h => h.trim().toLowerCase().replace(/ /g, '_'));
}

function bestOf(row, ...candidates) {
  for (const c of candidates) {
    if (row[c] && row[c].trim()) {
      return row[c].trim();
    }
  }
  return '';
}

function parseDate(dateStr) {
  /**
   * Convert MM/DD/YY format to "Mon MM/DD" format.
   * Example: "01/12/26" -> "Mon 01/12"
   */
  try {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts;
      let yearInt = parseInt(year, 10);
      if (yearInt < 50) {
        yearInt += 2000;
      } else {
        yearInt += 1900;
      }

      const dt = new Date(yearInt, parseInt(month, 10) - 1, parseInt(day, 10));
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = dayNames[dt.getDay()];
      return `${dayName} ${month}/${day}`;
    }
  } catch (err) {
    // Return original if parsing fails
  }
  return dateStr;
}

function parseAssignments(assignmentsStr) {
  if (!assignmentsStr) return [];
  return assignmentsStr.split(',').map(a => a.trim()).filter(a => a);
}

function loadScheduleFromCSV(text) {
  const records = parse(text, {
    columns: (headers) => normalizeHeaders(headers),
    skip_empty_lines: true,
    trim: true
  });

  const result = [];
  let currentUnit = null;
  let currentSection = null;

  for (const row of records) {
    const dateRaw = bestOf(row, 'date');
    let unit = bestOf(row, 'unit');
    const topic = bestOf(row, 'topic');
    const assignmentsStr = bestOf(row, 'assignments', 'assignment');
    const topicId = bestOf(row, 'id');

    // If unit is empty, use the previous unit
    if (!unit && currentUnit) {
      unit = currentUnit;
    }

    // Update current unit
    if (unit) {
      currentUnit = unit;
    }

    // Skip rows without date and topic
    if (!dateRaw || !topic) continue;

    // Convert date format
    const date = parseDate(dateRaw);

    // Parse assignments
    const assignments = parseAssignments(assignmentsStr);

    // Handle unit changes
    if (unit && unit !== (currentSection ? currentSection.name : null)) {
      if (currentSection) {
        result.push(currentSection);
      }
      currentSection = {
        name: unit,
        days: []
      };
    }

    // Create section if needed
    if (!currentSection && unit) {
      currentSection = {
        name: unit,
        days: []
      };
    }

    // Add day entry
    if (currentSection) {
      const dayEntry = {
        date,
        source_date: dateRaw,
        topics: topic
      };
      if (assignments.length > 0) {
        dayEntry.assignments = assignments;
      }
      if (topicId) {
        dayEntry.topic_slug = topicId;
      }

      currentSection.days.push(dayEntry);
    }
  }

  // Add final section
  if (currentSection) {
    result.push(currentSection);
  }

  console.log(`[11ty] CSV schedule: sections=${result.length}, days=${result.reduce((acc, s) => acc + (s.days ? s.days.length : 0), 0)}`);
  return result;
}

async function loadSchedule() {
  // Read config.json for CSV URL
  const configPath = path.join(process.cwd(), 'config.json');

  let scheduleUrl = '';

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    scheduleUrl = config.csv_urls?.schedule || '';
  } catch (err) {
    throw new Error(`Could not read config.json: ${err.message}`);
  }

  // Try local CSV file first
  const localCsvPath = path.join(process.cwd(), 'static', 'csv', 'schedule.csv');

  if (fs.existsSync(localCsvPath)) {
    try {
      const csvText = fs.readFileSync(localCsvPath, 'utf8');
      return loadScheduleFromCSV(csvText);
    } catch (err) {
      throw new Error(`Could not read local schedule.csv: ${err.message}`);
    }
  }

  // Fetch from URL if available
  if (scheduleUrl) {
    const csvText = await fetchCsv(scheduleUrl);
    return loadScheduleFromCSV(csvText);
  }

  throw new Error('No schedule data source configured');
}

module.exports = async function() {
  if (cachedSchedule) return cachedSchedule;

  if (!inFlightSchedule) {
    inFlightSchedule = loadSchedule()
      .then(schedule => {
        if (!schedule.length) {
          throw new Error('Schedule data source returned no class days');
        }
        cachedSchedule = schedule;
        return schedule;
      })
      .finally(() => {
        inFlightSchedule = null;
      });
  }

  return inFlightSchedule;
};
