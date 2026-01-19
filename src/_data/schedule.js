const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

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

async function fetchCSV(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'nd-cse-site-bot/1.0' }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status}`);
  }
  let text = await response.text();
  // Handle UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text;
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

module.exports = async function() {
  // Read semester_info.yaml for CSV URL
  const yamlPath = path.join(process.cwd(), 'static', 'yaml', 'semester_info.yaml');

  let scheduleUrl = '';

  try {
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const match = yamlContent.match(/schedule:\s*(.+)/);
    if (match) {
      scheduleUrl = match[1].trim();
    }
  } catch (err) {
    console.error('Warning: Could not read semester_info.yaml:', err.message);
  }

  // Try local CSV file first
  const localCsvPath = path.join(process.cwd(), 'static', 'csv', 'schedule.csv');

  try {
    if (fs.existsSync(localCsvPath)) {
      const csvText = fs.readFileSync(localCsvPath, 'utf8');
      return loadScheduleFromCSV(csvText);
    }
  } catch (err) {
    console.error('Warning: Could not read local schedule.csv:', err.message);
  }

  // Fetch from URL if available
  if (scheduleUrl) {
    try {
      const csvText = await fetchCSV(scheduleUrl);
      return loadScheduleFromCSV(csvText);
    } catch (err) {
      console.error('Warning: Could not fetch schedule CSV:', err.message);
    }
  }

  console.warn('Warning: No schedule data available');
  return [];
};
