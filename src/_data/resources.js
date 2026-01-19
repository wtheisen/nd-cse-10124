const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

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
      return loadResourcesFromCSV(csvText);
    }
  } catch (err) {
    console.error('Warning: Could not read local resources.csv:', err.message);
  }

  // Fetch from URL if available
  if (resourcesUrl) {
    try {
      const csvText = await fetchCSV(resourcesUrl);
      return loadResourcesFromCSV(csvText);
    } catch (err) {
      console.error('Warning: Could not fetch resources CSV:', err.message);
    }
  }

  console.warn('Warning: No resources data available');
  return {};
};
