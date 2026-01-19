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
  // Uses CSS Grid with absolute positioning for clean overlap handling
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

    // Calculate time range - round to hour boundaries with padding
    const startMinutes = Math.floor(globalMinStart / 60) * 60; // Round down to hour
    const endMinutes = Math.ceil(globalMaxEnd / 60) * 60;       // Round up to hour
    const totalMinutes = endMinutes - startMinutes;
    const pixelsPerHour = 80; // Larger for better text visibility
    const totalHeight = (totalMinutes / 60) * pixelsPerHour;

    // Find overlap groups - events that share any time
    function findOverlapGroups(events) {
      if (events.length === 0) return [];

      // Sort by start time
      const sorted = [...events].sort((a, b) => a.start - b.start);

      const groups = [];
      let currentGroup = [];
      let groupEnd = 0;

      for (const event of sorted) {
        if (event.start >= groupEnd && currentGroup.length > 0) {
          // No overlap with current group - start new group
          groups.push(currentGroup);
          currentGroup = [];
          groupEnd = 0;
        }
        currentGroup.push(event);
        groupEnd = Math.max(groupEnd, event.end);
      }

      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }

      return groups;
    }

    // Assign columns within an overlap group
    function assignColumns(group) {
      // Sort by start time, then by duration (longer first)
      group.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

      const columnEnds = []; // Track when each column becomes free

      for (const event of group) {
        // Find first column where event fits
        let col = columnEnds.findIndex(endTime => event.start >= endTime);
        if (col === -1) {
          col = columnEnds.length;
          columnEnds.push(0);
        }
        event.column = col;
        columnEnds[col] = event.end;
      }

      // Set total columns for width calculation
      const totalCols = columnEnds.length;
      group.forEach(e => e.totalColumns = totalCols);
    }

    // Process each day's events
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      const events = dayEvents[dayIdx];
      const groups = findOverlapGroups(events);
      for (const group of groups) {
        assignColumns(group);
      }
    }

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

    // Build HTML with CSS Grid layout
    let html = `
<style>
.oh-calendar {
  display: grid;
  grid-template-columns: 80px repeat(7, 1fr);
  border: 1px solid #ddd;
  font-size: 12px;
}
.oh-header {
  background: #f5f5f5;
  padding: 8px 4px;
  text-align: center;
  font-weight: bold;
  border-bottom: 1px solid #ddd;
  border-left: 1px solid #ddd;
}
.oh-header:first-child {
  border-left: none;
}
.oh-times {
  border-right: 1px solid #ddd;
}
.oh-hour {
  height: ${pixelsPerHour}px;
  padding: 4px;
  border-bottom: 1px solid #eee;
  box-sizing: border-box;
  font-size: 11px;
  color: #666;
}
.oh-day {
  position: relative;
  height: ${totalHeight}px;
  border-left: 1px solid #ddd;
  background: repeating-linear-gradient(
    to bottom,
    transparent,
    transparent ${pixelsPerHour - 1}px,
    #eee ${pixelsPerHour - 1}px,
    #eee ${pixelsPerHour}px
  );
}
.oh-event {
  position: absolute;
  box-sizing: border-box;
  padding: 4px 6px;
  border-radius: 4px;
  overflow: visible;
  border: 1px solid rgba(0,0,0,0.15);
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.oh-event strong {
  display: block;
  font-size: 12px;
  margin-bottom: 2px;
}
.oh-event small {
  display: block;
  color: #555;
  font-size: 10px;
}
</style>
<div class="oh-calendar">
`;

    // Header row
    html += '<div class="oh-header"></div>';
    for (const day of days) {
      html += `<div class="oh-header">${day}</div>`;
    }

    // Time labels column
    html += '<div class="oh-times">';
    for (let m = startMinutes; m < endMinutes; m += 60) {
      html += `<div class="oh-hour">${formatMinutesToTime(m)}</div>`;
    }
    html += '</div>';

    // Day columns with positioned events
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      html += '<div class="oh-day">';

      const events = dayEvents[dayIdx];
      for (const event of events) {
        // Calculate position as percentage of total height
        const topMinutes = Math.max(0, event.start - startMinutes);
        const bottomMinutes = Math.min(totalMinutes, event.end - startMinutes);
        const topPercent = (topMinutes / totalMinutes) * 100;
        const heightPercent = ((bottomMinutes - topMinutes) / totalMinutes) * 100;

        // Calculate horizontal position based on column assignment
        const column = event.column || 0;
        const totalColumns = event.totalColumns || 1;
        const widthPercent = (100 / totalColumns) - 1; // -1 for small gaps
        const leftPercent = (column / totalColumns) * 100 + 0.5; // +0.5 for padding

        const bgColor = getEventBgColor(event);

        html += `<div class="oh-event" style="top: ${topPercent.toFixed(2)}%; height: ${heightPercent.toFixed(2)}%; left: ${leftPercent.toFixed(2)}%; width: ${widthPercent.toFixed(2)}%; background-color: ${bgColor};">`;
        html += `<strong>${event.name}</strong>`;
        html += `<small>${event.time}</small>`;
        if (event.location) {
          html += `<small>${event.location}</small>`;
        }
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div>';
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
