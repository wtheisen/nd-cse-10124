const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const fetchCsv = require('../../lib/fetchCsv.js');

/**
 * Load resources from CSV URL or local file
 * Returns a mapping: { lecture_id: [ {name, type, link, student?, primary?}, ... ] }
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

function toBool(s) {
  if (!s) return false;
  s = s.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'required'].includes(s);
}

function loadResourcesFromCSV(text) {
  const records = parse(text, {
    columns: (headers) => normalizeHeaders(headers),
    skip_empty_lines: true,
    trim: true
  });

  const out = {};
  let totalRows = 0;
  let keptRows = 0;

  for (const row of records) {
    totalRows++;

    const lectureId = bestOf(row, 'lecture_id', 'lecture', 'topic_id');
    const name = bestOf(row, 'name', 'title', 'resource', 'resource_name');
    const link = bestOf(row, 'link', 'url', 'href');
    const rtype = bestOf(row, 'type', 'category', 'format') || 'reading';

    // Student credit
    let student = bestOf(
      row,
      'student',
      'student_name',
      'student_credit',
      'student_contributor',
      'submitted_by',
      'submittedby',
      'attribution',
      'credit'
    );

    if (!student) {
      // Fallback to any column containing 'student'
      const excludeKeys = ['repository', 'id', 'email', 'netid', 'username', 'link'];
      for (const [key, value] of Object.entries(row)) {
        if (!value) continue;
        if (!key.includes('student')) continue;
        if (excludeKeys.some(ex => key.includes(ex))) continue;
        student = value;
        break;
      }
    }

    const isPrimaryRaw = bestOf(row, 'is_primary', 'primary', 'required');

    if (!lectureId || !name || !link) continue;

    const entry = { name, type: rtype, link };
    if (student) entry.student = student;
    if (toBool(isPrimaryRaw)) entry.primary = true;

    if (!out[lectureId]) out[lectureId] = [];
    out[lectureId].push(entry);
    keptRows++;
  }

  // Deduplicate
  for (const [k, items] of Object.entries(out)) {
    const seen = new Set();
    const deduped = [];
    for (const it of items) {
      const sig = `${it.type || ''}|${it.name || ''}|${it.link || ''}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      deduped.push(it);
    }
    out[k] = deduped;
  }

  console.log(`[11ty] CSV resources: rows=${totalRows}, kept=${keptRows}, lectures=${Object.keys(out).length}`);
  return out;
}

function dateKey(dateText) {
  const match = String(dateText || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!match) return null;
  const [, month, day, shortYear] = match;
  return Number(`20${shortYear}${month.padStart(2, '0')}${day.padStart(2, '0')}`);
}

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Indiana/Indianapolis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(`${values.year}${values.month}${values.day}`);
}

async function assertCurrentLectureCoverage(resources) {
  const schedule = await require('./schedule.js')();
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'));
  const cancelledTopics = new Set(config.cancelled_days || []);
  const missing = [];
  const today = todayKey();

  for (const section of schedule) {
    for (const day of section.days || []) {
      const slug = day.topic_slug || '';
      const scheduledDate = dateKey(day.source_date);
      const isCoursework = /^(?:homework|lab)-/i.test(slug);
      const isCancelled = cancelledTopics.has(day.topics);

      if (!slug || !scheduledDate || scheduledDate > today || isCoursework || isCancelled) continue;
      if (!resources[`lec-${slug}`]?.length) {
        missing.push(`${day.source_date} ${day.topics} (${slug})`);
      }
    }
  }

  if (missing.length) {
    throw new Error(
      `Scheduled class resources are missing from the published export: ${missing.join('; ')}. ` +
      'Check that each current Lecture Topic List entry exactly matches its sheet tab.'
    );
  }
}

module.exports = async function() {
  // Read config.json for CSV URL
  const configPath = path.join(process.cwd(), 'config.json');

  let resourcesUrl = '';

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    resourcesUrl = config.csv_urls?.resources || '';
  } catch (err) {
    console.error('Warning: Could not read config.json:', err.message);
  }

  // Try local CSV file first
  const localCsvPath = path.join(process.cwd(), 'static', 'csv', 'resources.csv');

  try {
    if (fs.existsSync(localCsvPath)) {
      const csvText = fs.readFileSync(localCsvPath, 'utf8');
      const resources = loadResourcesFromCSV(csvText);
      await assertCurrentLectureCoverage(resources);
      return resources;
    }
  } catch (err) {
    console.error('Warning: Could not read local resources.csv:', err.message);
  }

  // Fetch from URL if available
  if (resourcesUrl) {
    const csvText = await fetchCsv(resourcesUrl);
    const resources = loadResourcesFromCSV(csvText);
    await assertCurrentLectureCoverage(resources);
    return resources;
  }

  console.warn('Warning: No resources data available');
  return {};
};
