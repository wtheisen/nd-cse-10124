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
  eleventyConfig.addFilter("officeHoursCalendar", function(semesterInfo) {
    if (!semesterInfo) return '<p>No semester info available</p>';

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const startMinutes = 10 * 60; // 10:00 AM
    const endMinutes = 21 * 60;   // 9:00 PM
    const slotDuration = 15;      // 15 minutes per slot

    // Build TA color map dynamically based on order in data
    const taColorMap = {};
    const tas = semesterInfo.TAs || {};
    const taIdList = Object.keys(tas);
    taIdList.forEach((taId, index) => {
      taColorMap[taId] = TA_COLOR_PALETTE[index % TA_COLOR_PALETTE.length];
    });

    // Build time slots
    const timeSlots = [];
    for (let m = startMinutes; m < endMinutes; m += slotDuration) {
      timeSlots.push({
        start: m,
        end: m + slotDuration,
        label: `${formatMinutesToTime(m)} - ${formatMinutesToTime(m + slotDuration)}`
      });
    }

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

    // Collect all events for each day (not per-slot, but the full event)
    const dayEvents = {}; // dayIdx -> array of events with start/end times
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
          }
        }
      }
    }

    // For each day, compute "visual blocks" - contiguous slot ranges with the same set of active events
    // A block changes when the set of active event IDs changes
    const dayBlocks = {}; // dayIdx -> array of { startSlotIdx, endSlotIdx, events }

    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      dayBlocks[dayIdx] = [];
      const events = dayEvents[dayIdx];

      let currentBlock = null;
      let currentEventIds = null;

      for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
        const slot = timeSlots[slotIdx];

        // Find all events active during this slot
        const activeEvents = events.filter(e => e.start < slot.end && e.end > slot.start);
        const activeIds = activeEvents.map(e => e.id).sort().join(',');

        if (activeIds !== currentEventIds) {
          // Event set changed - save current block and start new one
          if (currentBlock !== null) {
            currentBlock.endSlotIdx = slotIdx;
            dayBlocks[dayIdx].push(currentBlock);
          }

          currentBlock = {
            startSlotIdx: slotIdx,
            endSlotIdx: slotIdx + 1,
            events: activeEvents
          };
          currentEventIds = activeIds;
        } else if (currentBlock !== null) {
          // Same events, extend the block
          currentBlock.endSlotIdx = slotIdx + 1;
        }
      }

      // Don't forget the last block
      if (currentBlock !== null) {
        dayBlocks[dayIdx].push(currentBlock);
      }
    }

    // Track which cells have been consumed by rowspan
    const consumedCells = {};
    const key = (slotIdx, dayIdx) => `${slotIdx}-${dayIdx}`;

    // Pre-compute block lookup: for each slot/day, which block does it belong to?
    const slotBlock = {}; // key -> block or null
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      for (const block of dayBlocks[dayIdx]) {
        for (let slotIdx = block.startSlotIdx; slotIdx < block.endSlotIdx; slotIdx++) {
          slotBlock[key(slotIdx, dayIdx)] = block;
        }
      }
    }

    // Helper: get background style for a set of events
    function getBgStyle(events) {
      const taIds = [...new Set(events.filter(e => e.type === 'ta').map(e => e.taId))];
      const hasNonTa = events.some(e => e.type !== 'ta');

      if (events.length === 0) {
        return '';
      } else if (!hasNonTa && taIds.length === 1) {
        return `background-color: ${taColorMap[taIds[0]] || 'rgba(240,240,240,0.5)'};`;
      } else if (!hasNonTa && taIds.length >= 2) {
        // Gradient for multiple TAs
        const colors = taIds.map(id => taColorMap[id] || 'rgba(240,240,240,0.5)');
        const stops = colors.map((c, i) => `${c} ${Math.floor(100*i/colors.length)}% ${Math.floor(100*(i+1)/colors.length)}%`);
        return `background-image: linear-gradient(90deg, ${stops.join(', ')});`;
      } else if (events.some(e => e.type === 'lecture' || e.type === 'instructor')) {
        return 'background-color: rgba(204, 229, 255, 0.5);';
      } else {
        return 'background-color: rgba(245, 245, 245, 0.7);';
      }
    }

    // Build HTML
    let html = '<div class="row">';
    html += '<table cellpadding="5" cellspacing="0" style="table-layout: fixed; width: 100%; border-collapse: collapse; border: 1px solid #ddd;">';

    // Header row
    html += '<tr><th style="width: 150px;"></th>';
    for (const day of days) {
      html += `<th style="width: calc((100% - 150px) / 7); text-align: center;">${day}</th>`;
    }
    html += '</tr>';

    // Time slot rows
    for (let slotIdx = 0; slotIdx < timeSlots.length; slotIdx++) {
      const slot = timeSlots[slotIdx];
      const isHourStart = slot.start % 60 === 0;

      html += '<tr>';

      // Time label cell (spans 4 rows for each hour with 15-min slots)
      if (isHourStart) {
        const hourLabel = `${formatMinutesToTime(slot.start)} - ${formatMinutesToTime(slot.start + 60)}`;
        html += `<td rowspan="4" style="text-align: left; padding: 8px; border-top: 1px solid #ddd;">${hourLabel}</td>`;
      }

      // Day cells
      for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        const k = key(slotIdx, dayIdx);

        // Skip if consumed by previous rowspan
        if (consumedCells[k]) continue;

        const block = slotBlock[k];

        if (block && block.events.length > 0 && block.startSlotIdx === slotIdx) {
          // This is the start of a block with events - render the cell
          const rowspan = block.endSlotIdx - block.startSlotIdx;
          const bgStyle = getBgStyle(block.events);

          // Mark subsequent cells as consumed
          for (let r = 1; r < rowspan; r++) {
            consumedCells[key(slotIdx + r, dayIdx)] = true;
          }

          html += `<td rowspan="${rowspan}" style="text-align: center; vertical-align: middle; padding: 6px; ${bgStyle} border: 1px solid #ddd; border-top: 1px solid #ddd;">`;

          // Display each unique person/event
          const displayedNames = new Set();
          for (const evt of block.events) {
            if (displayedNames.has(evt.name)) continue;
            displayedNames.add(evt.name);

            if (displayedNames.size > 1) {
              html += '<hr style="margin: 4px 0; border-color: rgba(0,0,0,0.2);">';
            }
            html += `<div><strong>${evt.name}</strong></div>`;
            html += `<div><small>${evt.time}</small></div>`;
            if (evt.location) {
              html += `<div><small>${evt.location}</small></div>`;
            }
          }
          html += '</td>';
        } else if (!block || block.events.length === 0) {
          // Empty slot - try to merge empty cells
          // Find how many consecutive empty slots we have
          let emptyCount = 1;
          for (let r = slotIdx + 1; r < timeSlots.length; r++) {
            const nextBlock = slotBlock[key(r, dayIdx)];
            if (nextBlock && nextBlock.events.length > 0) break;
            emptyCount++;
          }

          // For cleaner display, try to align with hour boundaries
          if (isHourStart && emptyCount >= 4) {
            // Span the full hour if possible
            const hourSlots = Math.min(4, emptyCount);
            for (let r = 1; r < hourSlots; r++) {
              consumedCells[key(slotIdx + r, dayIdx)] = true;
            }
            html += `<td rowspan="${hourSlots}" style="padding: 8px; border: 1px solid #ddd; border-top: 1px solid #ddd;"></td>`;
          } else {
            // Just render single empty cell
            html += '<td style="padding: 8px; border: 1px solid #ddd; border-top: 1px solid #ddd;"></td>';
          }
        }
        // If block exists but this isn't the start, we skip (handled by consumed check)
      }

      html += '</tr>';
    }

    html += '</table></div>';
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
