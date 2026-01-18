#!/usr/bin/env python3
"""
Generate assignment page YAML files from schedule.yaml based on templates.

This script:
1. Reads schedule.yaml to find all "Homework XX" and "Lab XX" assignments
2. Generates homework_XX.yaml and lab_XX.yaml files from templates
3. Replaces template variables with actual assignment numbers
4. Generates reading_XX.yaml files with auto-detected topic coverage
"""

import os
import re
import yaml
import sys
from pathlib import Path

# Get the project root directory (parent of scripts/)
PROJECT_ROOT = Path(__file__).parent.parent
SEMESTER_INFO_FILE = PROJECT_ROOT / "static" / "yaml" / "semester_info.yaml"
SCHEDULE_FILE = PROJECT_ROOT / "static" / "yaml" / "schedule.yaml"  # Fallback
HOMEWORK_TEMPLATE_FILE = PROJECT_ROOT / "templates" / "homework.yaml"
LAB_TEMPLATE_FILE = PROJECT_ROOT / "templates" / "lab.yaml"
READING_TEMPLATE_FILE = PROJECT_ROOT / "templates" / "reading.yaml"
PAGES_DIR = PROJECT_ROOT / "pages"


def load_schedule():
    """Load schedule from CSV (via semester_info.yaml) or fallback to YAML file."""
    # Try to load from CSV first
    try:
        # Add scripts directory to path for imports
        scripts_dir = Path(__file__).parent
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        from csv_loaders import load_csv_to_schedule, load_semester_info_from_yaml_or_csv
        
        semester_info = load_semester_info_from_yaml_or_csv(str(SEMESTER_INFO_FILE))
        csv_urls = semester_info.get('csv_urls', {})
        schedule_url = csv_urls.get('schedule', '')
        
        if schedule_url:
            return load_csv_to_schedule(schedule_url)
    except Exception as e:
        print(f"Warning: Could not load schedule from CSV: {e}", file=sys.stderr)
        print("Falling back to schedule.yaml file...", file=sys.stderr)
    
    # Fallback to YAML file
    if SCHEDULE_FILE.exists():
        with open(SCHEDULE_FILE, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    else:
        raise FileNotFoundError(f"Schedule file not found: {SCHEDULE_FILE}")


def extract_assignment_numbers(schedule, assignment_type):
    """Extract assignment numbers from schedule assignments.
    
    Args:
        schedule: Schedule data structure (from CSV or YAML)
        assignment_type: 'homework' or 'lab'
    
    Returns:
        Sorted list of assignment numbers
    """
    assignment_numbers = set()
    
    # Pattern to match "Homework XX" or "Lab XX"
    if assignment_type == 'homework':
        pattern = r'^Homework\s+(\d+)$'
    elif assignment_type == 'lab':
        pattern = r'^Lab\s+(\d+)$'
    else:
        return []
    
    # Recursively search through the schedule structure
    def find_assignments(obj):
        if isinstance(obj, dict):
            # Check if this dict has an 'assignments' key
            if 'assignments' in obj:
                for assignment in obj['assignments']:
                    match = re.match(pattern, assignment, re.IGNORECASE)
                    if match:
                        assignment_numbers.add(int(match.group(1)))
            # Recursively search nested structures
            for value in obj.values():
                find_assignments(value)
        elif isinstance(obj, list):
            for item in obj:
                find_assignments(item)
    
    find_assignments(schedule)
    return sorted(assignment_numbers)


def generate_assignment_page(number, template_file, output_dir, assignment_type):
    """Generate an assignment page YAML file from template.
    
    Args:
        number: Assignment number (int)
        template_file: Path to template file
        output_dir: Directory to write output files
        assignment_type: 'homework' or 'lab'
    
    Returns:
        Path to generated file
    """
    with open(template_file, 'r', encoding='utf-8') as f:
        template_content = f.read()
    
    # Format the number and assignment name
    number_str = str(number).zfill(2)
    assignment_name = f"{assignment_type}{number_str}"
    
    # Replace template placeholders in the YAML template
    # These are simple string replacements since we're generating the YAML file itself
    content = template_content
    content = content.replace('{{ number_str }}', number_str)
    content = content.replace('{{ assignment_name }}', assignment_name)
    
    # Write the output file
    output_file = output_dir / f"{assignment_type}_{number_str}.yaml"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return output_file


def flatten_schedule(schedule, cancelled_days=None):
    """Flatten schedule structure to ordered list of days with topics and assignments.
    
    Args:
        schedule: Schedule YAML structure
        cancelled_days: List of topic names/patterns to skip (from semester_info)
    
    Returns:
        List of dicts with keys: date, topics, assignments, unit
    """
    if cancelled_days is None:
        cancelled_days = []
    
    # Normalize cancelled_days to lowercase for comparison
    cancelled_patterns = [pattern.lower() for pattern in cancelled_days]
    
    flattened = []
    
    for section in schedule:
        if not isinstance(section, dict):
            continue
        
        unit_name = section.get('name', '')
        days = section.get('days', [])
        
        for day in days:
            if not isinstance(day, dict):
                continue
            
            # Skip days without topics (unit headers, breaks, etc.)
            topics = day.get('topics', '').strip()
            if not topics:
                continue
            
            # Skip non-lecture days
            topics_lower = topics.lower()
            if any(skip in topics_lower for skip in ['exam', 'review', 'cancelled', 'break', 'final']):
                continue
            
            # Skip days that match cancelled_days patterns
            if cancelled_patterns:
                if any(pattern in topics_lower or topics_lower in pattern for pattern in cancelled_patterns):
                    continue
            
            flattened.append({
                'date': day.get('date', ''),
                'topics': topics,
                'assignments': day.get('assignments', []),
                'unit': unit_name
            })
    
    return flattened


def extract_reading_assignments(schedule, cancelled_days=None):
    """Extract reading assignments and their positions from schedule.
    
    Args:
        schedule: Schedule data structure (from CSV or YAML)
        cancelled_days: List of topic names/patterns to skip (from semester_info)
    
    Returns:
        Dict mapping reading number to index in flattened schedule
    """
    flattened = flatten_schedule(schedule, cancelled_days)
    reading_positions = {}
    
    for idx, day in enumerate(flattened):
        for assignment in day.get('assignments', []):
            match = re.match(r'^Reading\s+(\d+)$', assignment, re.IGNORECASE)
            if match:
                reading_num = int(match.group(1))
                reading_positions[reading_num] = idx
    
    return reading_positions, flattened


def get_lectures_for_reading(reading_num, reading_positions, flattened_schedule):
    """Get list of topics covered by a reading.
    
    A reading covers:
    - The lecture it's assigned on
    - All subsequent lectures until the next reading (or end of schedule)
    
    Args:
        reading_num: Reading number (int)
        reading_positions: Dict mapping reading numbers to schedule indices
        flattened_schedule: Flattened schedule list
    
    Returns:
        List of topic names (strings)
    """
    if reading_num not in reading_positions:
        return []
    
    start_idx = reading_positions[reading_num]
    
    # Find the next reading's position (or end of schedule)
    end_idx = len(flattened_schedule)
    for other_reading_num, other_idx in reading_positions.items():
        if other_reading_num > reading_num and other_idx > start_idx:
            end_idx = min(end_idx, other_idx)
    
    # Collect topics from start_idx to end_idx (exclusive)
    topics = []
    for i in range(start_idx, end_idx):
        topic = flattened_schedule[i].get('topics', '').strip()
        if topic:
            topics.append(topic)
    
    return topics


def generate_topic_sections(topics):
    """Generate Jinja2 template code for topic sections.
    
    Args:
        topics: List of topic names
    
    Returns:
        String containing Jinja2 template code for all topic sections
    """
    sections = []
    
    for topic in topics:
        # Escape any special characters in topic name for the template
        section = f"""    ## {topic}

    <table>
        <tr>
            <td colspan="3">
                {{% set resources =  page.external.get('resources', {{}}).get(lecture_id_for('{topic}'), [])%}}
                {{% include "resource_sections.tmpl" %}}
            </td>
        </tr>
    </table>

"""
        sections.append(section)
    
    return '\n'.join(sections)


def format_reading_title(reading_num, topics):
    """Format reading title from topics.
    
    Args:
        reading_num: Reading number (int)
        topics: List of topic names
    
    Returns:
        Formatted title string
    """
    number_str = str(reading_num).zfill(2)
    
    if not topics:
        return f"Reading {number_str}"
    
    if len(topics) == 1:
        return f"Reading {number_str}: {topics[0]}"
    elif len(topics) == 2:
        return f"Reading {number_str}: {topics[0]} and {topics[1]}"
    else:
        # Format: "Topic1, Topic2, and Topic3"
        all_but_last = ', '.join(topics[:-1])
        return f"Reading {number_str}: {all_but_last}, and {topics[-1]}"


def generate_reading_page(reading_num, topics, template_file, output_dir):
    """Generate a reading page YAML file from template.
    
    Args:
        reading_num: Reading number (int)
        topics: List of topic names covered by this reading
        template_file: Path to template file
        output_dir: Directory to write output files
    
    Returns:
        Path to generated file
    """
    with open(template_file, 'r', encoding='utf-8') as f:
        template_content = f.read()
    
    # Generate topic sections
    topic_sections = generate_topic_sections(topics)
    
    # Generate title
    title = format_reading_title(reading_num, topics)
    
    # Format reading number
    reading_number = str(reading_num).zfill(2)
    
    # Replace template placeholders
    # Note: We don't replace {{ reading_number }} - it will be handled by Tornado template in yasb.py
    # The template uses {% if reading_number == "01" %} which needs reading_number as a variable
    content = template_content
    content = content.replace('{{ title }}', title)
    content = content.replace('{{ topic_sections }}', topic_sections)
    
    # Write the output file
    output_file = output_dir / f"reading_{reading_number}.yaml"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return output_file


def main():
    """Main function to generate all assignment pages."""
    # Load schedule (from CSV or YAML)
    try:
        schedule = load_schedule()
    except Exception as e:
        print(f"Error: Could not load schedule: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Load semester_info to get cancelled_days
    cancelled_days = []
    try:
        scripts_dir = Path(__file__).parent
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        from csv_loaders import load_semester_info_from_yaml_or_csv
        semester_info = load_semester_info_from_yaml_or_csv(str(SEMESTER_INFO_FILE))
        cancelled_days = semester_info.get('cancelled_days', [])
    except Exception as e:
        print(f"Warning: Could not load cancelled_days from semester_info: {e}", file=sys.stderr)
    
    # Ensure pages directory exists
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    
    total_generated = 0
    
    # Generate homework pages
    if not HOMEWORK_TEMPLATE_FILE.exists():
        print(f"Warning: Homework template file not found: {HOMEWORK_TEMPLATE_FILE}", file=sys.stderr)
    else:
        homework_numbers = extract_assignment_numbers(schedule, 'homework')
        
        if homework_numbers:
            print(f"Found {len(homework_numbers)} homework assignment(s): {homework_numbers}")
            generated = []
            for number in homework_numbers:
                output_file = generate_assignment_page(number, HOMEWORK_TEMPLATE_FILE, PAGES_DIR, 'homework')
                generated.append(output_file)
                print(f"Generated: {output_file}")
            total_generated += len(generated)
            print(f"Successfully generated {len(generated)} homework page(s)\n")
        else:
            print("No homework assignments found in schedule.yaml")
    
    # Generate lab pages
    if not LAB_TEMPLATE_FILE.exists():
        print(f"Warning: Lab template file not found: {LAB_TEMPLATE_FILE}", file=sys.stderr)
    else:
        lab_numbers = extract_assignment_numbers(schedule, 'lab')
        
        if lab_numbers:
            print(f"Found {len(lab_numbers)} lab assignment(s): {lab_numbers}")
            generated = []
            for number in lab_numbers:
                output_file = generate_assignment_page(number, LAB_TEMPLATE_FILE, PAGES_DIR, 'lab')
                generated.append(output_file)
                print(f"Generated: {output_file}")
            total_generated += len(generated)
            print(f"Successfully generated {len(generated)} lab page(s)\n")
        else:
            print("No lab assignments found in schedule.yaml")
    
    # Generate reading pages
    if not READING_TEMPLATE_FILE.exists():
        print(f"Warning: Reading template file not found: {READING_TEMPLATE_FILE}", file=sys.stderr)
    else:
        reading_positions, flattened_schedule = extract_reading_assignments(schedule, cancelled_days)
        
        if reading_positions:
            # Include all readings (Reading 01 is now auto-generated with special content)
            reading_numbers = sorted(reading_positions.keys())
            
            if reading_numbers:
                print(f"Found {len(reading_numbers)} reading assignment(s) to generate: {reading_numbers}")
                generated = []
                for reading_num in reading_numbers:
                    topics = get_lectures_for_reading(reading_num, reading_positions, flattened_schedule)
                    if topics:
                        output_file = generate_reading_page(reading_num, topics, READING_TEMPLATE_FILE, PAGES_DIR)
                        generated.append(output_file)
                        print(f"Generated: {output_file} (covers: {', '.join(topics)})")
                    else:
                        print(f"Warning: Reading {reading_num:02d} has no topics", file=sys.stderr)
                total_generated += len(generated)
                print(f"Successfully generated {len(generated)} reading page(s)\n")
            else:
                print("No reading assignments found to generate")
        else:
            print("No reading assignments found in schedule.yaml")
    
    print(f"Total: Generated {total_generated} assignment page(s)")


if __name__ == '__main__':
    main()
