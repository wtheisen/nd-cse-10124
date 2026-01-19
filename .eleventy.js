const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const markdownItFootnote = require("markdown-it-footnote");

module.exports = function(eleventyConfig) {
  // ===== MARKDOWN CONFIGURATION =====
  const md = markdownIt({
    html: true,
    breaks: false,
    linkify: true
  })
    .use(markdownItAnchor, {
      permalink: markdownItAnchor.permalink.headerLink()
    })
    .use(markdownItFootnote);

  eleventyConfig.setLibrary("md", md);

  // ===== CUSTOM FILTERS =====

  // TA color palette - colors are assigned dynamically based on TA order
  const TA_COLOR_PALETTE = [
    'rgba(255, 204, 204, 0.5)',  // light red
    'rgba(204, 255, 204, 0.5)',  // light green
    'rgba(204, 204, 255, 0.5)',  // light blue
    'rgba(255, 255, 204, 0.5)',  // light yellow
    'rgba(255, 204, 255, 0.5)',  // light magenta
    'rgba(204, 255, 255, 0.5)',  // light cyan
    'rgba(255, 224, 204, 0.5)',  // light orange
    'rgba(224, 204, 255, 0.5)',  // light purple
    'rgba(204, 255, 224, 0.5)',  // light mint
    'rgba(255, 204, 224, 0.5)',  // light pink
  ];

  // Helper: parse time string like "10:00 AM" to minutes since midnight
  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // Helper: format minutes since midnight to time string
  function formatMinutesToTime(mins) {
    let hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    return `${hours}:${String(minutes).padStart(2, '0')} ${period}`;
  }

  // Office hours calendar filter - generates the HTML for the calendar
  // Uses HTML table with variable row/column sizes for better space usage
  eleventyConfig.addFilter("officeHoursCalendar", function(semesterInfo) {
    if (!semesterInfo) return '<p>No semester info available</p>';

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    // Build TA color map dynamically based on order in data
    const taColorMap = {};
    const tas = semesterInfo.TAs || {};
    const taIdList = Object.keys(tas);
    taIdList.forEach((taId, index) => {
      taColorMap[taId] = TA_COLOR_PALETTE[index % TA_COLOR_PALETTE.length];
    });

    // Helper: parse "10:00 AM - 11:30 AM|Location" format
    function parseOfficeHours(ohStr) {
      if (!ohStr) return null;
      const parts = ohStr.split('|');
      const timeRange = parts[0].trim();
      const location = parts[1] ? parts[1].trim() : '';
      const timeParts = timeRange.split(' - ');
      if (timeParts.length !== 2) return null;
      const start = parseTimeToMinutes(timeParts[0].trim());
      const end = parseTimeToMinutes(timeParts[1].trim());
      if (start === null || end === null) return null;
      return { start, end, time: timeRange, location };
    }

    // Collect all events for each day
    const dayEvents = {};
    let globalMinStart = 24 * 60;
    let globalMaxEnd = 0;

    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      dayEvents[dayIdx] = [];
      const day = days[dayIdx];

      // Class times
      const classHours = semesterInfo.class_times && semesterInfo.class_times[day];
      if (classHours) {
        const parsed = parseOfficeHours(classHours + '|' + (semesterInfo.class_location || ''));
        if (parsed) {
          dayEvents[dayIdx].push({
            id: 'lecture',
            type: 'lecture',
            name: 'Lecture',
            time: parsed.time,
            location: parsed.location,
            start: parsed.start,
            end: parsed.end
          });
          globalMinStart = Math.min(globalMinStart, parsed.start);
          globalMaxEnd = Math.max(globalMaxEnd, parsed.end);
        }
      }

      // Instructor office hours
      const instructor = semesterInfo.Instructor;
      if (instructor && instructor.office_hours && instructor.office_hours[day]) {
        const parsed = parseOfficeHours(instructor.office_hours[day]);
        if (parsed) {
          dayEvents[dayIdx].push({
            id: 'instructor',
            type: 'instructor',
            name: instructor.name || 'Instructor',
            time: parsed.time,
            location: parsed.location,
            start: parsed.start,
            end: parsed.end
          });
          globalMinStart = Math.min(globalMinStart, parsed.start);
          globalMaxEnd = Math.max(globalMaxEnd, parsed.end);
        }
      }

      // TA office hours
      for (const [taId, ta] of Object.entries(semesterInfo.TAs || {})) {
        if (ta.office_hours && ta.office_hours[day]) {
          const parsed = parseOfficeHours(ta.office_hours[day]);
          if (parsed) {
            dayEvents[dayIdx].push({
              id: `ta-${taId}`,
              type: 'ta',
              taId: taId,
              name: ta.name || 'TA',
              time: parsed.time,
              location: parsed.location,
              start: parsed.start,
              end: parsed.end
            });
            globalMinStart = Math.min(globalMinStart, parsed.start);
            globalMaxEnd = Math.max(globalMaxEnd, parsed.end);
          }
        }
      }
    }

    // Calculate time range - round to hour boundaries
    const startHour = Math.floor(globalMinStart / 60);
    const endHour = Math.ceil(globalMaxEnd / 60);
    const hours = [];
    for (let h = startHour; h < endHour; h++) {
      hours.push(h);
    }

    // Count events per day for column width calculation
    const dayEventCounts = {};
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      dayEventCounts[dayIdx] = dayEvents[dayIdx].length;
    }

    // Track which hours have events
    const hourHasEvents = {};
    for (const hour of hours) {
      hourHasEvents[hour] = false;
      const hourStart = hour * 60;
      const hourEnd = (hour + 1) * 60;
      for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        for (const event of dayEvents[dayIdx]) {
          // Event overlaps this hour if it starts before hour ends and ends after hour starts
          if (event.start < hourEnd && event.end > hourStart) {
            hourHasEvents[hour] = true;
            break;
          }
        }
        if (hourHasEvents[hour]) break;
      }
    }

    // Calculate column widths - days with events get more width
    const minWidth = 60;    // px for empty days
    const eventWidth = 150; // px for days with events
    const timeColWidth = 70; // px for time column
    const colWidths = [timeColWidth];
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      colWidths.push(dayEventCounts[dayIdx] > 0 ? eventWidth : minWidth);
    }

    // Calculate row heights
    const emptyRowHeight = 25;  // px - just enough for time label
    const eventRowHeight = 80;  // px - room for event content

    // Helper: get background color for an event
    function getEventBgColor(event) {
      if (event.type === 'lecture') {
        return 'rgba(204, 229, 255, 0.9)';
      } else if (event.type === 'instructor') {
        return 'rgba(204, 229, 255, 0.9)';
      } else if (event.type === 'ta') {
        return taColorMap[event.taId] || 'rgba(240, 240, 240, 0.9)';
      }
      return 'rgba(245, 245, 245, 0.9)';
    }

    // Build event grid: for each hour/day, track which events start, continue, or overlap
    // eventGrid[hour][dayIdx] = { events: [], rowspan: {} }
    const eventGrid = {};
    for (const hour of hours) {
      eventGrid[hour] = {};
      for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        eventGrid[hour][dayIdx] = { events: [], occupied: false };
      }
    }

    // Place events in the grid and calculate rowspans
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      for (const event of dayEvents[dayIdx]) {
        const startHourIdx = Math.floor(event.start / 60);
        const endHourIdx = Math.ceil(event.end / 60);

        // Calculate how many rows this event spans
        let rowspan = 0;
        for (const hour of hours) {
          if (hour >= startHourIdx && hour < endHourIdx) {
            rowspan++;
          }
        }

        // Add event to its starting hour
        const startingHour = hours.find(h => h >= startHourIdx);
        if (startingHour !== undefined && eventGrid[startingHour]) {
          event.rowspan = rowspan;
          event.startHour = startingHour;
          eventGrid[startingHour][dayIdx].events.push(event);
        }

        // Mark subsequent hours as occupied (for rowspan)
        for (const hour of hours) {
          if (hour > startHourIdx && hour < endHourIdx) {
            if (eventGrid[hour]) {
              eventGrid[hour][dayIdx].occupied = true;
            }
          }
        }
      }
    }

    // Build HTML table
    let html = `
<style>
.oh-calendar-table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
  table-layout: fixed;
}
.oh-calendar-table th,
.oh-calendar-table td {
  border: 1px solid #ddd;
  padding: 4px;
  vertical-align: top;
}
.oh-calendar-table thead th {
  background: #f5f5f5;
  font-weight: bold;
  text-align: center;
}
.oh-calendar-table .oh-time {
  font-size: 11px;
  color: #666;
  text-align: right;
  white-space: nowrap;
}
.oh-calendar-table .oh-cell {
  vertical-align: top;
  padding: 2px;
}
.oh-calendar-table .oh-cell-content {
  display: flex;
  gap: 2px;
  height: 100%;
}
.oh-event {
  flex: 1;
  box-sizing: border-box;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid rgba(0,0,0,0.15);
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}
.oh-event strong {
  display: block;
  font-size: 12px;
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oh-event small {
  display: block;
  color: #555;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
<table class="oh-calendar-table">
<colgroup>
`;
    // Column widths
    for (let i = 0; i < colWidths.length; i++) {
      html += `  <col style="width: ${colWidths[i]}px">\n`;
    }
    html += `</colgroup>
<thead>
<tr>
  <th></th>
`;
    // Header row
    for (const day of days) {
      html += `  <th>${day}</th>\n`;
    }
    html += `</tr>
</thead>
<tbody>
`;

    // Body rows - one per hour
    for (const hour of hours) {
      const rowHeight = hourHasEvents[hour] ? eventRowHeight : emptyRowHeight;
      html += `<tr style="height: ${rowHeight}px">\n`;

      // Time label cell
      html += `  <td class="oh-time">${formatMinutesToTime(hour * 60)}</td>\n`;

      // Day cells
      for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        const cell = eventGrid[hour][dayIdx];

        // Skip if this cell is occupied by a rowspan from above
        if (cell.occupied) {
          continue;
        }

        // Get events that start in this cell
        const cellEvents = cell.events;

        if (cellEvents.length === 0) {
          html += `  <td class="oh-cell"></td>\n`;
        } else {
          // Calculate the rowspan - use max of all events' rowspans
          const maxRowspan = Math.max(...cellEvents.map(e => e.rowspan || 1));

          // Calculate total height for the cell
          let totalHeight = 0;
          for (let i = 0; i < maxRowspan && (hours.indexOf(hour) + i) < hours.length; i++) {
            const h = hours[hours.indexOf(hour) + i];
            totalHeight += hourHasEvents[h] ? eventRowHeight : emptyRowHeight;
          }

          const rowspanAttr = maxRowspan > 1 ? ` rowspan="${maxRowspan}"` : '';
          html += `  <td class="oh-cell"${rowspanAttr} style="height: ${totalHeight}px">\n`;
          html += `    <div class="oh-cell-content">\n`;

          for (const event of cellEvents) {
            const bgColor = getEventBgColor(event);
            html += `      <div class="oh-event" style="background-color: ${bgColor};">\n`;
            html += `        <strong>${event.name}</strong>\n`;
            html += `        <small>${event.time}</small>\n`;
            if (event.location) {
              html += `        <small>${event.location}</small>\n`;
            }
            html += `      </div>\n`;
          }

          html += `    </div>\n`;
          html += `  </td>\n`;
        }
      }

      html += `</tr>\n`;
    }

    html += `</tbody>
</table>`;
    return html;
  });

  // Known aliases for topic-to-lecture-id mapping
  const LECTURE_ALIASES = {
    'syllabus, history of ai': 'introduction',
    'intro to ai': 'introduction',
  };

  // Slugify function - convert string to URL-safe slug
  eleventyConfig.addFilter("slugify", function(s) {
    if (!s) return '';
    return s.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  });

  // Pad number with leading zeros
  eleventyConfig.addFilter("pad", function(num, size) {
    let s = String(num);
    while (s.length < size) s = "0" + s;
    return s;
  });

  // startswith filter - check if string starts with prefix
  eleventyConfig.addFilter("startswith", function(str, prefix) {
    if (!str || !prefix) return false;
    return String(str).startsWith(prefix);
  });

  // lecture_id_for - convert topic name to lecture ID
  eleventyConfig.addFilter("lectureIdFor", function(topic) {
    if (!topic) return '';
    const key = topic.trim().toLowerCase();
    const slug = LECTURE_ALIASES[key] || key
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return slug ? `lec-${slug}` : '';
  });

  // resources_for - get resources for a topic/lecture_id
  eleventyConfig.addFilter("resourcesFor", function(resourcesMap, topicOrId) {
    if (!resourcesMap || typeof resourcesMap !== 'object') return [];
    const key = (topicOrId || '').trim();

    // If caller passed a full id like 'lec-...'
    if (key.startsWith('lec-')) {
      return resourcesMap[key] || [];
    }

    // Otherwise compute from topic text
    const keyLower = key.toLowerCase();
    const slug = LECTURE_ALIASES[keyLower] || keyLower
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const lid = slug ? `lec-${slug}` : '';
    return resourcesMap[lid] || [];
  });

  // find_assignment_resource - find resource for an assignment
  eleventyConfig.addFilter("findAssignmentResource", function(resourcesMap, assignmentName, lectureId = '') {
    if (!resourcesMap || typeof resourcesMap !== 'object') return null;

    const targetName = (assignmentName || '').trim().toLowerCase();
    if (!targetName) return null;

    const preferredKeywords = [
      'assignment', 'homework', 'project', 'exam', 'quiz', 'practice', 'solution'
    ];

    // Helper to slugify
    const slugify = (s) => {
      if (!s) return '';
      return s.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    };

    // Helper to get lecture ID from topic
    const lectureIdFor = (topic) => {
      if (!topic) return '';
      const key = topic.trim().toLowerCase();
      const slug = LECTURE_ALIASES[key] || slugify(topic);
      return slug ? `lec-${slug}` : '';
    };

    // Build candidate IDs
    const candidateIds = [];
    if (lectureId) candidateIds.push(lectureId);
    const slug = lectureIdFor(assignmentName);
    if (slug && !candidateIds.includes(slug)) candidateIds.push(slug);
    if (!candidateIds.includes('lec-assignments')) candidateIds.push('lec-assignments');

    // Search function
    const searchResources = (ids, keywords = null) => {
      for (const lid of ids) {
        if (!lid) continue;
        const resources = resourcesMap[lid] || [];
        for (const resource of resources) {
          const resName = (resource.name || '').trim().toLowerCase();
          if (resName !== targetName) continue;
          if (keywords) {
            const rtype = (resource.type || '').trim().toLowerCase();
            if (!rtype) continue;
            if (!keywords.some(k => rtype.includes(k))) continue;
          }
          return resource;
        }
      }
      return null;
    };

    // Try with preferred keywords first
    let result = searchResources(candidateIds, preferredKeywords);
    if (result) return result;

    // Try without keywords
    result = searchResources(candidateIds);
    if (result) return result;

    // Fallback: search all resources
    const allKeys = Object.keys(resourcesMap);
    if (!allKeys.includes('lec-assignments')) allKeys.push('lec-assignments');

    result = searchResources(allKeys, preferredKeywords);
    if (result) return result;

    return searchResources(allKeys);
  });

  // Filter resources by type
  eleventyConfig.addFilter("filterByType", function(resources, type) {
    if (!resources || !Array.isArray(resources)) return [];
    return resources.filter(r => r.type === type);
  });

  // Get day abbreviation
  eleventyConfig.addFilter("dayAbbrev", function(day) {
    const abbrevs = {
      'Monday': 'M',
      'Tuesday': 'T',
      'Wednesday': 'W',
      'Thursday': 'TR',
      'Friday': 'F',
      'Saturday': 'Sa',
      'Sunday': 'Su'
    };
    return abbrevs[day] || day.charAt(0);
  });

  // Parse time string to get just the time part (before |)
  eleventyConfig.addFilter("parseTime", function(timeStr) {
    if (!timeStr) return '';
    return timeStr.split('|')[0].trim();
  });

  // Parse location from time string (after |)
  eleventyConfig.addFilter("parseLocation", function(timeStr) {
    if (!timeStr || !timeStr.includes('|')) return '';
    return timeStr.split('|')[1].trim();
  });

  // Extract term code (e.g., "sp26" from Term="Spring", Year="2026")
  eleventyConfig.addFilter("termCode", function(semesterInfo) {
    if (!semesterInfo) return '';
    const term = semesterInfo.Term || '';
    const year = semesterInfo.Year || '';
    return term.substring(0, 2).toLowerCase() + year.slice(-2);
  });

  // Make assignment ID from name (lowercase, spaces to underscores)
  eleventyConfig.addFilter("assignmentId", function(name) {
    if (!name) return '';
    return name.toLowerCase().split(' ').join('_');
  });

  // Get assignment label class based on type
  eleventyConfig.addFilter("assignmentLabel", function(assignmentId) {
    if (!assignmentId) return 'caution';
    const id = assignmentId.toLowerCase();
    if (id.includes('solutions')) return 'success';
    if (id.startsWith('reading')) return 'primary';
    if (id.includes('practice')) return 'success';
    if (id.includes('exam')) return 'danger';
    if (id.includes('primer')) return 'success';
    return 'caution';
  });

  // Check if topic is cancelled
  eleventyConfig.addFilter("isCancelled", function(topic, cancelledDays) {
    if (!topic) return false;
    if (topic === 'Office Hours' || topic.startsWith('Cancelled')) return true;
    if (!cancelledDays || !Array.isArray(cancelledDays)) return false;

    const topicLower = topic.toLowerCase();
    return cancelledDays.some(cancelled =>
      topicLower.includes(cancelled.toLowerCase()) ||
      cancelled.toLowerCase().includes(topicLower)
    );
  });

  // Get homeworks from schedule
  eleventyConfig.addFilter("getHomeworks", function(schedule) {
    if (!schedule || !Array.isArray(schedule)) return [];
    const homeworks = new Set();

    for (const unit of schedule) {
      if (!unit.days) continue;
      for (const day of unit.days) {
        if (!day.assignments) continue;
        for (const assignment of day.assignments) {
          const match = assignment.match(/homework\s*(\d+)/i);
          if (match) {
            homeworks.add(parseInt(match[1], 10));
          }
        }
      }
    }

    return Array.from(homeworks).sort((a, b) => a - b);
  });

  // Get readings from schedule
  eleventyConfig.addFilter("getReadings", function(schedule) {
    if (!schedule || !Array.isArray(schedule)) return [];
    const readings = new Map(); // Map reading number to topics

    for (const unit of schedule) {
      if (!unit.days) continue;
      for (const day of unit.days) {
        if (!day.assignments) continue;
        for (const assignment of day.assignments) {
          const match = assignment.match(/reading\s*(\d+)/i);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!readings.has(num)) {
              readings.set(num, {
                number: num,
                topics: [],
                topicSlugs: []
              });
            }
            // Add topic if it exists and isn't already added
            if (day.topics && !readings.get(num).topics.includes(day.topics)) {
              readings.get(num).topics.push(day.topics);
              if (day.topic_slug) {
                readings.get(num).topicSlugs.push(day.topic_slug);
              }
            }
          }
        }
      }
    }

    return Array.from(readings.values()).sort((a, b) => a.number - b.number);
  });

  // Format reading title from topics
  eleventyConfig.addFilter("formatReadingTitle", function(reading) {
    if (!reading) return '';
    const num = String(reading.number).padStart(2, '0');
    if (!reading.topics || reading.topics.length === 0) {
      return `Reading ${num}`;
    }
    const topicsStr = reading.topics.join(' + ');
    return `Reading ${num}: ${topicsStr}`;
  });

  // ===== PASSTHROUGH COPY =====
  // Copy static assets
  eleventyConfig.addPassthroughCopy({ "static": "static" });
  eleventyConfig.addPassthroughCopy({ "static/ico/favicon.ico": "favicon.ico" });

  // ===== WATCH TARGETS =====
  eleventyConfig.addWatchTarget("./src/");
  eleventyConfig.addWatchTarget("./static/");

  // ===== COLLECTIONS =====
  // Create a collection for homeworks
  eleventyConfig.addCollection("homeworks", function(collectionApi) {
    // This will be populated by the homework.njk pagination
    return collectionApi.getFilteredByTag("homework");
  });

  // Create a collection for readings
  eleventyConfig.addCollection("readings", function(collectionApi) {
    return collectionApi.getFilteredByTag("reading");
  });

  // ===== SHORTCODES =====
  // Markdown rendering shortcode
  eleventyConfig.addPairedShortcode("markdown", function(content) {
    return md.render(content);
  });

  // ===== CONFIGURATION =====
  return {
    dir: {
      input: "src",
      output: "docs",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    passthroughFileCopy: true
  };
};
