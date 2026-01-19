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
