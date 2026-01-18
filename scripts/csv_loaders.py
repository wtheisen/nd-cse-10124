#!/usr/bin/env python3

"""
CSV loading functions for yasb.py
Handles loading resources, schedule, and semester_info from CSV files or URLs.
"""

import csv
import io
import os
import yaml

try:
    import requests  # type: ignore
except Exception:
    requests = None


# Helper functions used across multiple loaders

def normalize_headers(headers):
    """Normalize CSV headers: lowercase, strip, replace spaces with underscores."""
    return [h.strip().lower().replace(' ', '_') for h in headers]


def best_of(row, *cands):
    """Get the first non-empty value from row using candidate keys."""
    for c in cands:
        if c in row and row[c]:
            return str(row[c]).strip()
    return ''


def fetch_csv_content(src: str) -> str:
    """Fetch CSV content from URL or file path."""
    if src.startswith('http://') or src.startswith('https://'):
        if not requests:
            raise RuntimeError("requests module not available to fetch CSV")
        r = requests.get(src, timeout=30, headers={'User-Agent': 'nd-cse-site-bot/1.0'})
        r.raise_for_status()
        try:
            return r.content.decode('utf-8-sig')
        except Exception:
            return r.text
    else:
        with open(src, 'r', encoding='utf-8') as f:
            return f.read()


def _get_csv_url_from_semester_info(csv_type: str) -> str:
    """
    Get CSV URL from semester_info.yaml as a fallback.
    csv_type should be 'resources' or 'schedule'.
    """
    try:
        semester_info_path = 'static/yaml/semester_info.yaml'
        if os.path.exists(semester_info_path):
            with open(semester_info_path, 'r', encoding='utf-8') as f:
                semester_info = yaml.safe_load(f)
            csv_urls = semester_info.get('csv_urls', {})
            return csv_urls.get(csv_type, '')
    except Exception:
        pass
    return ''


# Resources CSV loader

def load_csv_to_resources_map(src: str):
    """
    Load CSV from a URL or file path and return a mapping:
        { lecture_id: [ {name, type, link, student?}, ... ] }

    The CSV should contain columns: lecture_id, name, link, [type], [student].
    Header names are case-insensitive and spaces become underscores.
    
    Assignments should have lecture_id = "lec-assignments" and will be found
    by find_assignment_resource when searching the resources map.
    """
    # Fetch content
    text = ''
    if src.startswith('http://') or src.startswith('https://'):
        if not requests:
            raise RuntimeError("requests module not available to fetch CSV")
        r = requests.get(src, timeout=30, headers={
            'User-Agent': 'nd-cse-site-bot/1.0 (+github actions)'
        })
        r.raise_for_status()
        # Handle BOM and odd encodings
        try:
            text = r.content.decode('utf-8-sig')
        except Exception:
            text = r.text
    else:
        # Local file path; if missing, try env fallback URL
        try:
            with open(src, 'r', encoding='utf-8') as f:
                text = f.read()
        except FileNotFoundError:
            # Try environment variable first, then semester_info.yaml
            fallback = os.environ.get('COURSE_RESOURCES_CSV_URL', '')
            if not fallback:
                fallback = _get_csv_url_from_semester_info('resources')
            if fallback:
                if not requests:
                    raise RuntimeError("requests module not available to fetch CSV")
                r = requests.get(fallback, timeout=30, headers={'User-Agent': 'nd-cse-site-bot/1.0'})
                r.raise_for_status()
                try:
                    text = r.content.decode('utf-8-sig')
                except Exception:
                    text = r.text
            else:
                raise

    reader = csv.DictReader(io.StringIO(text))
    reader.fieldnames = normalize_headers(reader.fieldnames or [])

    out = {}
    total_rows = 0
    kept_rows = 0
    for raw in reader:
        total_rows += 1
        row = {k: (v or '').strip() for k, v in raw.items()}

        lecture_id = best_of(row, 'lecture_id', 'lecture', 'lecture id', 'topic_id')
        name = best_of(row, 'name', 'title', 'resource', 'resource_name')
        link = best_of(row, 'link', 'url', 'href')
        rtype = best_of(row, 'type', 'category', 'format') or 'reading'
        student = best_of(
            row,
            'student',
            'student_name',
            'student_credit',
            'student_contributor',
            'submitted_by',
            'submittedby',
            'attribution',
            'credit',
        )
        if not student:
            # Fall back to any remaining column that looks like a student credit.
            EXCLUDE_STUDENT_KEYS = ('repository', 'id', 'email', 'netid', 'username', 'link')
            for key, value in row.items():
                if not value:
                    continue
                if 'student' not in key:
                    continue
                if any(ex in key for ex in EXCLUDE_STUDENT_KEYS):
                    continue
                student = value
                break
        is_primary_raw = best_of(row, 'is_primary', 'primary', 'required')

        def to_bool(s: str) -> bool:
            if not s:
                return False
            s = s.strip().lower()
            return s in ('1', 'true', 'yes', 'y', 'required')

        if not lecture_id or not name or not link:
            continue

        entry = {'name': name, 'type': rtype, 'link': link}
        if student:
            entry['student'] = student
        if to_bool(is_primary_raw):
            entry['primary'] = True

        out.setdefault(lecture_id, []).append(entry)
        kept_rows += 1

    # Deduplicate
    for k, items in list(out.items()):
        seen = set()
        deduped = []
        for it in items:
            sig = (it.get('type', ''), it.get('name', ''), it.get('link', ''))
            if sig in seen:
                continue
            seen.add(sig)
            deduped.append(it)
        out[k] = deduped
    # Basic debug to stderr to aid troubleshooting in Actions logs
    try:
        import sys
        sys.stderr.write(f"[yasb] CSV resources: rows={total_rows}, kept={kept_rows}, lectures={len(out)}\n")
    except Exception:
        pass
    return out


# Schedule CSV loader

def parse_date(date_str):
    """
    Convert MM/DD/YY format to "Mon MM/DD" format.
    Example: "01/12/26" -> "Mon 01/12"
    """
    try:
        # Parse MM/DD/YY
        parts = date_str.split('/')
        if len(parts) == 3:
            month, day, year = parts
            # Convert to datetime to get day name
            # Assume 20XX for years < 50, 19XX otherwise
            year_int = int(year)
            if year_int < 50:
                year_int += 2000
            else:
                year_int += 1900
            
            from datetime import datetime
            dt = datetime(int(year_int), int(month), int(day))
            day_name = dt.strftime('%a')
            return f"{day_name} {month}/{day}"
    except Exception:
        pass
    return date_str  # Return original if parsing fails


def parse_assignments(assignments_str):
    """
    Parse comma-separated assignments into a list.
    """
    if not assignments_str:
        return []
    # Split by comma and clean up
    return [a.strip() for a in assignments_str.split(',') if a.strip()]


def load_csv_to_schedule(src: str):
    """
    Load CSV from a URL or file path and return a schedule list matching YAML structure:
        [ {name: "Unit", days: [...]}, ... ]

    The CSV should contain columns: id, Date, Unit, Topic, Assignments.
    - id: Topic slug/identifier
    - Date: MM/DD/YY format (will be converted to "Mon MM/DD")
    - Unit: Unit name (empty cells continue previous unit)
    - Topic: Topic name
    - Assignments: Comma-separated list of assignments
    """
    # Fetch content (same logic as load_csv_to_resources_map)
    text = ''
    if src.startswith('http://') or src.startswith('https://'):
        if not requests:
            raise RuntimeError("requests module not available to fetch CSV")
        r = requests.get(src, timeout=30, headers={
            'User-Agent': 'nd-cse-site-bot/1.0 (+github actions)'
        })
        r.raise_for_status()
        try:
            text = r.content.decode('utf-8-sig')
        except Exception:
            text = r.text
    else:
        # Local file path; if missing, try env fallback URL
        try:
            with open(src, 'r', encoding='utf-8') as f:
                text = f.read()
        except FileNotFoundError:
            # Try environment variable first, then semester_info.yaml
            fallback = os.environ.get('COURSE_SCHEDULE_CSV_URL', '')
            if not fallback:
                fallback = _get_csv_url_from_semester_info('schedule')
            if fallback:
                if not requests:
                    raise RuntimeError("requests module not available to fetch CSV")
                r = requests.get(fallback, timeout=30, headers={'User-Agent': 'nd-cse-site-bot/1.0'})
                r.raise_for_status()
                try:
                    text = r.content.decode('utf-8-sig')
                except Exception:
                    text = r.text
            else:
                raise

    reader = csv.DictReader(io.StringIO(text))
    reader.fieldnames = normalize_headers(reader.fieldnames or [])

    # Process rows in order, maintaining structure
    result = []
    current_unit = None  # Track current unit (empty cells continue previous)
    current_section = None
    seen_units = set()  # Track which units we've created header sections for
    
    for raw in reader:
        row = {k: (v or '').strip() for k, v in raw.items()}
        
        date_raw = best_of(row, 'date')
        unit = best_of(row, 'unit')
        topic = best_of(row, 'topic')
        assignments_str = best_of(row, 'assignments', 'assignment')
        topic_id = best_of(row, 'id')
        
        # If unit is empty, use the previous unit
        if not unit and current_unit:
            unit = current_unit
        
        # Update current_unit if we have a new one
        if unit:
            current_unit = unit
        
        # Skip rows without date and topic (invalid entries)
        if not date_raw or not topic:
            continue
        
        # Convert date format from MM/DD/YY to "Mon MM/DD"
        date = parse_date(date_raw)
        
        # Parse assignments (comma-separated)
        assignments = parse_assignments(assignments_str)
        
        # Handle unit changes - start new section if unit changed
        if unit and unit != (current_section['name'] if current_section else None):
            # Close previous section
            if current_section:
                result.append(current_section)
            
            # Start new section
            current_section = {
                'name': unit,
                'days': []
            }
            seen_units.add(unit)
        
        # If we don't have a current section yet, create one
        if not current_section and unit:
            current_section = {
                'name': unit,
                'days': []
            }
            seen_units.add(unit)
        
        # Add day entry to current section
        if current_section:
            day_entry = {
                'date': date,
                'topics': topic
            }
            if assignments:
                day_entry['assignments'] = assignments
            if topic_id:
                day_entry['topic_slug'] = topic_id
            
            current_section['days'].append(day_entry)
    
    # Add final section
    if current_section:
        result.append(current_section)
    
    # Basic debug to stderr
    try:
        import sys
        sys.stderr.write(f"[yasb] CSV schedule: sections={len(result)}, days={sum(len(s.get('days', [])) for s in result)}\n")
    except Exception:
        pass

    return result


# Semester info CSV loader

def parse_office_hours(oh_str: str, location: str = '') -> dict:
    """Parse office hours string like 'Monday: 9:00 AM - 11:00 AM | Location' or 'Monday 9:00 AM - 11:00 AM, Tuesday 2:00 PM - 4:00 PM' into dict.
    
    Args:
        oh_str: Office hours string (comma or semicolon separated)
        location: Optional location to append to all entries
    """
    if not oh_str:
        return {}
    result = {}
    # Split by commas first (most common), then by semicolons, then by newlines
    if ',' in oh_str:
        entries = oh_str.split(',')
    else:
        entries = oh_str.replace('\n', ';').split(';')
    
    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
        
        # Format: "Day: Time | Location" or "Day Time"
        # Check if colon is used as day:time separator (must be followed by space and not be part of time)
        # Pattern: "Day: Time" has colon after day name, "Day Time" has space after day name
        # We check if first space comes before first colon (space-separated) or after (colon-separated)
        first_space_idx = entry.find(' ')
        first_colon_idx = entry.find(':')
        
        if first_colon_idx != -1 and (first_space_idx == -1 or first_colon_idx < first_space_idx):
            # Has colon before space: "Monday: 9:00 AM - 11:00 AM | Location" format
            parts = entry.split(':', 1)
            day = parts[0].strip()
            rest = parts[1].strip()
            # Split time and location if there's a pipe
            if '|' in rest:
                time, loc = rest.split('|', 1)
                result[day] = f"{time.strip()} | {loc.strip()}"
            else:
                # Use provided location or just the time
                if location:
                    result[day] = f"{rest} | {location}"
                else:
                    result[day] = rest
        else:
            # Space-separated: "Monday 9:00 AM - 11:00 AM" - split on first space
            parts = entry.split(' ', 1)
            if len(parts) == 2:
                day = parts[0].strip()
                time = parts[1].strip()
                # Use provided location or just the time
                if location:
                    result[day] = f"{time} | {location}"
                else:
                    result[day] = time
    return result


def load_csv_to_semester_info(info_src: str):
    """
    Load semester_info from a single info CSV file and reconstruct the YAML structure.
    
    The CSV should have an "info type" column (or "type"/"role") with values:
    - "Class": One row with Term, Year, Location, Times (class location and times)
    - "Person": Multiple rows with Name, netid, level, Location (first Person is instructor, rest are TAs)
    
    Columns:
    - info type: "Class" or "Person"
    - Term: Semester term (e.g., "Spring")
    - Year: Year (e.g., "2026")
    - Name: Person's name
    - netid: Person's netid (used as key for TAs)
    - level: Person's level (e.g., "Professor", "Graduate", "Senior", "Junior")
    - Location: For Class row = class_location, For Person rows = office location
    - Times: For Class row = class times (format: "Monday 3:30 - 4:45 PM, Wednesday 3:30 - 4:45 PM")
    - github: (optional) GitHub username
    
    Rows can also be identified by column presence:
    - If row has "Term" and "Year", it's course_info
    - If row has "netid" and no "Term", it's instructor or TA (first one is instructor, rest are TAs)
    
    Args:
        info_src: Path or URL to info CSV containing instructor, TAs, and course_info rows
    
    Returns:
        Dictionary matching the semester_info.yaml structure
    """
    # Load info CSV
    info_text = fetch_csv_content(info_src)
    info_reader = csv.DictReader(io.StringIO(info_text))
    info_reader.fieldnames = normalize_headers(info_reader.fieldnames or [])
    
    # Process all rows
    instructor = None
    tas_dict = {}
    course_info_row = None
    
    for row in info_reader:
        info_type = best_of(row, 'info_type', 'type', 'role', 'row_type', 'info type')
        has_term = bool(best_of(row, 'term'))
        has_netid = bool(best_of(row, 'netid', 'id'))
        has_name = bool(best_of(row, 'name'))
        
        # Identify row type based on "info type" column or column presence
        if info_type.lower() in ('class', 'course', 'course_info', 'info'):
            course_info_row = row
        elif info_type.lower() in ('person', 'people', 'staff'):
            # Person row - determine if instructor or TA
            netid = best_of(row, 'netid', 'id')
            name = best_of(row, 'name')
            level = best_of(row, 'level')
            location = best_of(row, 'location')
            times = best_of(row, 'times', 'office_hours', 'oh', 'office hours')
            github = best_of(row, 'github')
            
            if not netid:
                continue
            
            person_data = {
                'name': name,
                'netid': netid,
                'level': level,
            }
            if github:
                person_data['github'] = github
            
            # Parse office hours - if Times column exists, use it; otherwise empty
            if times:
                # Times column has office hours - pass location to include it
                person_data['office_hours'] = parse_office_hours(times, location)
            else:
                # No times provided - empty office hours
                person_data['office_hours'] = {}
            
            if not instructor:
                # First person is instructor
                instructor = person_data
            else:
                # Subsequent people are TAs
                tas_dict[netid] = person_data
        elif has_term:
            # Row has Term/Year, so it's course_info (even without explicit type)
            course_info_row = row
        elif has_netid or has_name:
            # Row has netid/name but no Term, so it's instructor or TA
            netid = best_of(row, 'netid', 'id')
            name = best_of(row, 'name')
            level = best_of(row, 'level')
            location = best_of(row, 'location')
            times = best_of(row, 'times', 'office_hours', 'oh', 'office hours')
            github = best_of(row, 'github')
            
            if not netid:
                continue
            
            person_data = {
                'name': name,
                'netid': netid,
                'level': level,
            }
            if github:
                person_data['github'] = github
            
            if times:
                person_data['office_hours'] = parse_office_hours(times, location)
            else:
                person_data['office_hours'] = {}
            
            if not instructor:
                instructor = person_data
            else:
                tas_dict[netid] = person_data
    
    # Default course_info_row if not found
    if not course_info_row:
        course_info_row = {}
    
    # Parse class_times (format: "Monday 3:30 - 4:45 PM, Wednesday 3:30 - 4:45 PM" or "Monday: 3:30 PM - 4:45 PM\nWednesday: 3:30 PM - 4:45 PM")
    class_times_str = best_of(course_info_row, 'class_times', 'times', 'time')
    class_times = {}
    if class_times_str:
        # Handle comma-separated format: "Monday 3:30 - 4:45 PM, Wednesday 3:30 - 4:45 PM"
        if ',' in class_times_str:
            # Comma-separated format
            for entry in class_times_str.split(','):
                entry = entry.strip()
                if not entry:
                    continue
                # Check if colon is used as day:time separator (must come before first space)
                first_space_idx = entry.find(' ')
                first_colon_idx = entry.find(':')
                
                if first_colon_idx != -1 and (first_space_idx == -1 or first_colon_idx < first_space_idx):
                    # Has colon before space: "Monday: 3:30 PM - 4:45 PM" format
                    day, time = entry.split(':', 1)
                    class_times[day.strip()] = time.strip()
                else:
                    # Space-separated: "Monday 3:30 PM - 4:45 PM" - split on first space
                    parts = entry.split(' ', 1)
                    if len(parts) == 2:
                        day = parts[0].strip()
                        time = parts[1].strip()
                        class_times[day] = time
        else:
            # Handle newline or semicolon-separated format
            for line in class_times_str.replace('\n', ';').split(';'):
                line = line.strip()
                if not line:
                    continue
                # Check if colon is used as day:time separator
                first_space_idx = line.find(' ')
                first_colon_idx = line.find(':')
                
                if first_colon_idx != -1 and (first_space_idx == -1 or first_colon_idx < first_space_idx):
                    # Has colon before space: "Monday: 3:30 PM - 4:45 PM" format
                    day, time = line.split(':', 1)
                    class_times[day.strip()] = time.strip()
                else:
                    # Space-separated: "Monday 3:30 PM - 4:45 PM" - split on first space
                    parts = line.split(' ', 1)
                    if len(parts) == 2:
                        class_times[parts[0].strip()] = parts[1].strip()
    
    # Parse csv_urls (format: "resources: URL1\nschedule: URL2" or JSON-like)
    # These are optional - if not in CSV, they'll be merged from semester_info.yaml
    csv_urls_str = best_of(course_info_row, 'csv_urls', 'csv_url')
    csv_urls = {}
    if csv_urls_str:
        # Try to parse as simple key:value pairs
        for line in csv_urls_str.replace('\n', ';').split(';'):
            line = line.strip()
            if ':' in line:
                key, value = line.split(':', 1)
                csv_urls[key.strip()] = value.strip()
    
    course_info = {
        'Term': best_of(course_info_row, 'term'),
        'Year': best_of(course_info_row, 'year'),
        'class_location': best_of(course_info_row, 'class_location', 'location'),
        'class_times': class_times,
    }
    
    # Only include gh_homework_link if it exists (optional)
    gh_homework_link = best_of(course_info_row, 'gh_homework_link', 'github_homework_link', 'homework_link', 'github_classroom_link')
    if gh_homework_link:
        course_info['gh_homework_link'] = gh_homework_link

    # Reconstruct semester_info structure
    return {
        'Instructor': instructor,
        'TAs': tas_dict,
        **course_info
    }


def load_semester_info_from_yaml_or_csv(yaml_path: str = 'static/yaml/semester_info.yaml'):
    """
    Load semester_info from YAML file, which may contain CSV URLs.
    This function can be used by scripts that need to load semester_info.
    
    Returns the reconstructed semester_info dictionary.
    """
    with open(yaml_path, 'r', encoding='utf-8') as f:
        semester_info_data = yaml.safe_load(f)
    
    csv_urls = semester_info_data.get('csv_urls', {})
    info_url = csv_urls.get('info', '')
    
    # If info URL is present, load from CSV
    if info_url:
        loaded_info = load_csv_to_semester_info(info_url)
        # Merge in resources and schedule URLs from semester_info.yaml
        loaded_info['csv_urls'] = {
            'resources': csv_urls.get('resources', ''),
            'schedule': csv_urls.get('schedule', ''),
            'info': info_url
        }
        # Also include cancelled_days if present in YAML
        if 'cancelled_days' in semester_info_data:
            loaded_info['cancelled_days'] = semester_info_data['cancelled_days']
        return loaded_info
    else:
        # Fall back to YAML structure (backward compatibility)
        return semester_info_data
