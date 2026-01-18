import requests
from bs4 import BeautifulSoup
import re
import yaml
import csv
import io
import os
from datetime import datetime, timedelta

def parse_date_or_range(date_str, year):
    """
    Parse a date or date range string into a list of datetime objects.

    Args:
        date_str (str): Date string to parse (e.g., "Jan. 13", "Feb. 14-16").
        year (int): The year for the dates.

    Returns:
        list: A list of datetime objects.
    """
    months = {
        "Jan.": 1, "Feb.": 2, "Mar.": 3, "Apr.": 4, "May": 5, "Jun.": 6,
        "Jul.": 7, "Aug.": 8, "Sept.": 9, "Oct.": 10, "Nov.": 11, "Dec.": 12
    }
    dates = []

    # Match single dates (e.g., "Jan. 13")
    single_date_match = re.match(r"([A-Za-z.]+)\s(\d+)$", date_str)
    if single_date_match:
        month_str, day = single_date_match.groups()
        month = months.get(month_str)
        if month:
            dates.append(datetime(year, month, int(day)))
        return dates

    # Match date ranges (e.g., "Feb. 14-16")
    range_match = re.match(r"([A-Za-z.]+)\s(\d+)-(\d+)$", date_str)
    if range_match:
        month_str, start_day, end_day = range_match.groups()
        month = months.get(month_str)
        if month:
            for day in range(int(start_day), int(end_day) + 1):
                dates.append(datetime(year, month, day))
        return dates

    # Catch-all for invalid formats
    print(f"Skipping invalid date format: {date_str}")
    return dates

def scrape_academic_calendar(url, term, year):
    """
    Scrape the academic calendar and extract dates for the specified term.

    Args:
        url (str): The URL of the academic calendar page.
        term (str): The academic term (e.g., "Spring", "Fall").
        year (int): The academic year (e.g., 2025).

    Returns:
        tuple: (semester_start, break_dates) where break_dates is a set of holidays and breaks.
    """
    response = requests.get(url)
    if response.status_code != 200:
        raise Exception(f"Failed to fetch the webpage. Status code: {response.status_code}")

    soup = BeautifulSoup(response.text, 'html.parser')
    break_dates = set()
    semester_start = None

    # Locate term sections and find the specified term
    term_headers = soup.find_all('h3')
    for header in term_headers:
        if term in header.text and str(year) in header.text:
            # Get the table of dates following this term
            table = header.find_next_sibling('table')
            if not table:
                raise Exception(f"No table found for the term {term} {year}.")
            rows = table.find_all('tr')
            for row in rows:
                cols = row.find_all('td')
                if len(cols) == 2:
                    date_str = cols[0].get_text(strip=True)
                    description = cols[1].get_text(strip=True)

                    # Parse the date(s)
                    parsed_dates = parse_date_or_range(date_str, year)
                    for date in parsed_dates:
                        if "Classes begin" in description:
                            semester_start = date
                        elif "no classes" in description.lower() or "holiday" in description.lower() or "break" in description.lower():
                            break_dates.add(date)

    if not semester_start:
        raise Exception(f"Could not find the semester start date for {term} {year}.")

    return semester_start, break_dates

def adjust_schedule(schedule, semester_start, break_dates, class_days):
    """
    Adjust the schedule dates based on the academic calendar.

    Args:
        schedule (list): The original schedule loaded from YAML.
        semester_start (datetime): The start date of the semester.
        break_dates (set): Dates of holidays and breaks.
        class_days (list): List of valid class days (e.g., ['Monday', 'Wednesday']).

    Returns:
        list: The adjusted schedule.
    """
    adjusted_schedule = []
    current_date = semester_start

    for section in schedule:
        new_section = section.copy()
        if 'days' in section:
            new_days = []
            for day in section['days']:
                # Find the next valid class day
                while current_date.strftime("%A") not in class_days or current_date in break_dates:
                    current_date += timedelta(days=1)
                new_day = day.copy()
                new_day['date'] = current_date.strftime("%a %m/%d")
                new_days.append(new_day)
                current_date += timedelta(days=1)
            new_section['days'] = new_days
        adjusted_schedule.append(new_section)

    return adjusted_schedule

def load_schedule_from_csv(csv_path):
    """
    Load schedule from CSV file and convert to YAML-like structure.
    This uses similar logic to yasb.py's _load_csv_to_schedule().
    """
    def normalize_headers(headers):
        return [h.strip().lower().replace(' ', '_') for h in headers]

    def best_of(row, *cands):
        for c in cands:
            if c in row and row[c]:
                return str(row[c]).strip()
        return ''

    # Read CSV file
    with open(csv_path, 'r', encoding='utf-8') as f:
        text = f.read()

    reader = csv.DictReader(io.StringIO(text))
    reader.fieldnames = normalize_headers(reader.fieldnames or [])

    # Group rows by (Date, Unit, Topic) to collect assignments
    day_groups = {}
    all_rows = []

    for raw in reader:
        row = {k: (v or '').strip() for k, v in raw.items()}
        all_rows.append(row)
        
        date = best_of(row, 'date')
        unit = best_of(row, 'unit')
        topic = best_of(row, 'topic')
        assignment = best_of(row, 'assignments', 'assignment')
        topic_slug = best_of(row, 'topic_slug', 'topic_slug')

        # Header rows: Unit but no Date/Topic - skip for now
        if unit and not date and not topic:
            continue

        # Skip rows without date and topic
        if not date or not topic:
            continue

        # Group by (date, unit, topic) to collect assignments
        key = (date, unit, topic)
        if key not in day_groups:
            day_groups[key] = {
                'date': date,
                'unit': unit,
                'topic': topic,
                'assignments': [],
                'topic_slug': topic_slug
            }
        
        if assignment:
            day_groups[key]['assignments'].append(assignment)

    # Convert to hierarchical structure
    result = []
    current_section = None
    current_unit = None
    seen_units = set()
    seen_days = set()  # Track which (date, unit, topic) combinations we've already added
    
    for row in all_rows:
        date = best_of(row, 'date')
        unit = best_of(row, 'unit')
        topic = best_of(row, 'topic')
        
        # Header row: Unit but no Date/Topic
        if unit and not date and not topic:
            if current_section:
                result.append(current_section)
                current_section = None
                current_unit = None
                seen_days.clear()
            
            if unit not in seen_units:
                result.append({'name': unit})
                seen_units.add(unit)
            continue
        
        # Day row: has Date and Topic
        if date and topic:
            key = (date, unit, topic)
            if key not in day_groups:
                continue
            
            # Skip if we've already added this day
            if key in seen_days:
                continue
            
            day_data = day_groups[key]
            
            if unit != current_unit:
                if current_section:
                    result.append(current_section)
                
                current_unit = unit
                current_section = {
                    'name': unit,
                    'days': []
                }
                seen_units.add(unit)
                seen_days.clear()
            
            day_entry = {
                'date': day_data['date'],
                'topics': day_data['topic']
            }
            if day_data['assignments']:
                day_entry['assignments'] = day_data['assignments']
            if day_data.get('topic_slug'):
                day_entry['topic_slug'] = day_data['topic_slug']
            
            current_section['days'].append(day_entry)
            seen_days.add(key)
    
    if current_section:
        result.append(current_section)

    return result

def main():
    # File paths and configuration
    calendar_url = "https://registrar.nd.edu/calendars/"
    schedule_file = "static/yaml/schedule.yaml"
    semester_info_file = "static/yaml/semester_info.yaml"
    output_file = "static/yaml/adjusted_schedule.yaml"
    class_days = ['Monday', 'Wednesday']

    # Load semester info from YAML (which may contain CSV URLs)
    try:
        # Try to import the helper function from yasb
        import sys
        import os
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from yasb import load_semester_info_from_yaml_or_csv
        semester_info = load_semester_info_from_yaml_or_csv(semester_info_file)
    except ImportError:
        # Fallback: load directly from YAML
        with open(semester_info_file, 'r') as f:
            semester_info = yaml.safe_load(f)
    term = semester_info.get("Term")
    year = int(semester_info.get("Year"))

    # Load the existing schedule (support both YAML and CSV)
    if schedule_file.endswith('.csv'):
        schedule = load_schedule_from_csv(schedule_file)
    else:
        with open(schedule_file, 'r') as f:
            schedule = yaml.safe_load(f)

    # Scrape the academic calendar
    semester_start, break_dates = scrape_academic_calendar(calendar_url, term, year)
    print(f"Semester Start Date: {semester_start.strftime('%A, %B %d, %Y')}")
    print("Break Dates:")
    for break_date in sorted(break_dates):
        print(f"  {break_date.strftime('%A, %B %d, %Y')}")

    # Adjust the schedule
    adjusted_schedule = adjust_schedule(schedule, semester_start, break_dates, class_days)

    # Save the adjusted schedule
    with open(output_file, 'w') as f:
        yaml.dump(adjusted_schedule, f, sort_keys=False)

    print(f"Adjusted schedule saved to {output_file}.")

if __name__ == "__main__":
    main()