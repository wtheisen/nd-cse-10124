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
  // Uses CSS Grid with absolute positioning to handle overlapping events correctly
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

    // Calculate column widths - use flexible units for full width
    // Time column is fixed, day columns use fr units (larger for days with events)
    const timeColWidth = '60px';
    const colWidths = [timeColWidth];
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      // Days with events get 2fr, empty days get 1fr
      colWidths.push(dayEventCounts[dayIdx] > 0 ? '2fr' : '1fr');
    }

    // Calculate row heights
    const emptyRowHeight = 25;  // px - just enough for time label
    const eventRowHeight = 80;  // px - room for event content

    // Build cumulative height lookup - map each hour to its pixel offset from top
    let cumulativeHeight = 0;
    const hourTopOffset = {};
    for (const hour of hours) {
      hourTopOffset[hour] = cumulativeHeight;
      cumulativeHeight += hourHasEvents[hour] ? eventRowHeight : emptyRowHeight;
    }
    const totalHeight = cumulativeHeight;

    // Helper: get background color RGB values for an event (returns "R, G, B" string)
    function getEventColorRGB(event) {
      if (event.type === 'lecture' || event.type === 'instructor') {
        return '204, 229, 255';
      } else if (event.type === 'ta') {
        // Extract RGB from taColorMap (format: "rgba(R, G, B, alpha)")
        const color = taColorMap[event.taId] || 'rgba(240, 240, 240, 0.9)';
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          return `${match[1]}, ${match[2]}, ${match[3]}`;
        }
        return '240, 240, 240';
      }
      return '245, 245, 245';
    }

    // Helper: check if two events overlap in time
    function eventsOverlap(a, b) {
      return a.start < b.end && a.end > b.start;
    }

    // Find groups of overlapping events for a day
    function findOverlapGroups(events) {
      if (events.length === 0) return [];

      // Sort by start time, then by end time
      const sorted = [...events].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return a.end - b.end;
      });

      const groups = [];
      let currentGroup = [sorted[0]];

      for (let i = 1; i < sorted.length; i++) {
        const event = sorted[i];
        // Check if this event overlaps with any event in current group
        const overlapsGroup = currentGroup.some(e => eventsOverlap(e, event));

        if (overlapsGroup) {
          currentGroup.push(event);
        } else {
          groups.push(currentGroup);
          currentGroup = [event];
        }
      }
      groups.push(currentGroup);

      return groups;
    }

    // Assign stack index to events within an overlap group
    function assignStackIndex(group) {
      if (group.length === 0) return;

      // Sort by start time, then by duration (longer events behind)
      const sorted = [...group].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return (b.end - b.start) - (a.end - a.start); // longer events first (behind)
      });

      sorted.forEach((event, index) => {
        event.stackIndex = index;
        event.stackSize = group.length;
      });
    }

    // Calculate pixel position for an event
    function getEventPosition(event) {
      const eventStartHour = Math.floor(event.start / 60);
      const eventEndHour = Math.ceil(event.end / 60);

      // Find the first hour in our range that contains the event start
      let topHour = hours.find(h => h >= eventStartHour);
      if (topHour === undefined) topHour = hours[0];

      // Calculate top position
      let top = hourTopOffset[topHour] || 0;

      // Add offset for minutes within the starting hour
      const minutesIntoHour = event.start - (topHour * 60);
      if (minutesIntoHour > 0) {
        const hourHeight = hourHasEvents[topHour] ? eventRowHeight : emptyRowHeight;
        top += (minutesIntoHour / 60) * hourHeight;
      }

      // Calculate height by summing heights of hours the event spans
      let height = 0;
      for (const hour of hours) {
        const hourStart = hour * 60;
        const hourEnd = (hour + 1) * 60;
        const hourHeight = hourHasEvents[hour] ? eventRowHeight : emptyRowHeight;

        if (event.start < hourEnd && event.end > hourStart) {
          // Event overlaps this hour
          const overlapStart = Math.max(event.start, hourStart);
          const overlapEnd = Math.min(event.end, hourEnd);
          const overlapMinutes = overlapEnd - overlapStart;
          height += (overlapMinutes / 60) * hourHeight;
        }
      }

      return { top, height: Math.max(height, 20) }; // Minimum height of 20px
    }

    // Process each day's events to assign stack indices
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      const events = dayEvents[dayIdx];
      const groups = findOverlapGroups(events);
      for (const group of groups) {
        assignStackIndex(group);
      }
    }

    // Build grid-template-columns value
    const gridCols = colWidths.join(' ');

    // Build HTML with CSS Grid
    let html = `
<style>
.oh-calendar {
  display: grid;
  grid-template-columns: ${gridCols};
  width: 100%;
  font-size: 12px;
  border: 1px solid #ddd;
}
.oh-header {
  background: #f5f5f5;
  font-weight: bold;
  text-align: center;
  padding: 8px 4px;
  border-bottom: 1px solid #ddd;
  border-right: 1px solid #ddd;
}
.oh-header:last-child {
  border-right: none;
}
.oh-times {
  border-right: 1px solid #ddd;
}
.oh-time-row {
  font-size: 11px;
  font-weight: bold;
  color: #666;
  text-align: center;
  box-sizing: border-box;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  justify-content: center;
}
.oh-day {
  position: relative;
  border-right: 1px solid #ddd;
  box-sizing: border-box;
}
.oh-day:last-child {
  border-right: none;
}
.oh-hour-line {
  position: absolute;
  left: 0;
  right: 0;
  border-bottom: 1px solid #eee;
  box-sizing: border-box;
}
.oh-event {
  position: absolute;
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
  overflow: hidden;
  transition: z-index 0s, transform 0.1s, box-shadow 0.1s;
  cursor: pointer;
}
.oh-event:hover {
  z-index: 100 !important;
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  background-color: rgba(var(--event-rgb), 1) !important;
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
<div class="oh-calendar">
`;
    // Header row
    html += `  <div class="oh-header"></div>\n`;
    for (const day of days) {
      html += `  <div class="oh-header">${day}</div>\n`;
    }

    // Time column with variable-height rows
    html += `  <div class="oh-times">\n`;
    for (const hour of hours) {
      const rowHeight = hourHasEvents[hour] ? eventRowHeight : emptyRowHeight;
      html += `    <div class="oh-time-row" style="height: ${rowHeight}px">${formatMinutesToTime(hour * 60)}</div>\n`;
    }
    html += `  </div>\n`;

    // Day columns with absolutely positioned events
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      html += `  <div class="oh-day" style="height: ${totalHeight}px">\n`;

      // Add hour line guides
      for (const hour of hours) {
        const top = hourTopOffset[hour];
        const rowHeight = hourHasEvents[hour] ? eventRowHeight : emptyRowHeight;
        html += `    <div class="oh-hour-line" style="top: ${top + rowHeight}px"></div>\n`;
      }

      // Add events
      const events = dayEvents[dayIdx];
      for (const event of events) {
        const pos = getEventPosition(event);
        const colorRGB = getEventColorRGB(event);

        // Use stacking instead of column-based positioning
        const stackIndex = event.stackIndex || 0;
        const stackSize = event.stackSize || 1;
        const zIndex = stackIndex + 1;
        const leftOffset = stackSize > 1 ? stackIndex * 4 : 0; // slight offset to show stacking

        html += `    <div class="oh-event" style="--event-rgb: ${colorRGB}; background-color: rgba(${colorRGB}, 0.5); top: ${pos.top}px; height: ${pos.height}px; left: ${leftOffset}px; right: 0; z-index: ${zIndex};">\n`;
        html += `      <strong>${event.name}</strong>\n`;
        html += `      <small>${event.time}</small>\n`;
        if (event.location) {
          html += `      <small>${event.location}</small>\n`;
        }
        html += `    </div>\n`;
      }

      html += `  </div>\n`;
    }

    html += `</div>`;
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
