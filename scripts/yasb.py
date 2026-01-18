#!/usr/bin/env python3

# Copyright (c) 2022 Peter Bui <pbui@nd.edu>

# Permission to use, copy, modify, and/or distribute this software for any
# purpose with or without fee is hereby granted, provided that the above
# copyright notice and this permission notice appear in all copies.

# THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
# REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
# AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
# INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
# LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
# OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
# PERFORMANCE OF THIS SOFTWARE.

""" Yet Another Static Blogger """

import collections
import os
import itertools
import sys

import dateutil.parser
import dateutil.relativedelta
import tornado.template
import markdown
import markdown.extensions.codehilite
import markdown.extensions.toc
import markdown.extensions.footnotes
import yaml
import re

# Import CSV loaders from separate module
from csv_loaders import (
    load_csv_to_resources_map,
    load_csv_to_schedule,
    load_csv_to_semester_info,
    load_semester_info_from_yaml_or_csv
)

# Page

PageFields = 'title prefix icon navigation internal external body'.split()
Page       = collections.namedtuple('Page', PageFields)


def load_page_from_yaml(path):
    data     = yaml.safe_load(open(path))
    external = data.get('external', {}) or {}

    for k, v in external.items():
        if isinstance(v, str) and v.startswith('csv:'):
            src = v[len('csv:'):]
            # Use schedule loader for schedule, resources loader for resources
            if k == 'schedule':
                data['external'][k] = load_csv_to_schedule(src)
            else:
                data['external'][k] = load_csv_to_resources_map(src)
        else:
            # Check if this is semester_info.yaml and it contains CSV URLs
            if k in ('semester_info', 'tas') and 'semester_info.yaml' in v:
                try:
                    semester_info_data = yaml.safe_load(open(v))
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
                        data['external'][k] = loaded_info
                    else:
                        # Fall back to YAML structure
                        data['external'][k] = semester_info_data
                except Exception:
                    # Fall back to YAML loading if anything fails
                    data['external'][k] = yaml.safe_load(open(v))
            else:
                data['external'][k] = yaml.safe_load(open(v))

    if 'prefix' not in data:
        data['prefix'] = ''

    return Page(**data)

def render_page(page):
    hilite = markdown.extensions.codehilite.CodeHiliteExtension(noclasses=True)
    toc    = markdown.extensions.toc.TocExtension(permalink=True)
    footnotes = markdown.extensions.footnotes.FootnoteExtension()
    loader = tornado.template.Loader('templates')
    def slugify(s: str) -> str:
        s = (s or '').lower()
        s = re.sub(r"[^a-z0-9]+", "-", s)
        s = s.strip('-')
        return s

    # Known aliases where the topic text doesn't match the desired slug
    LECTURE_ALIASES = {
        'syllabus, history of ai': 'introduction',
        'intro to ai': 'introduction',
    }

    def lecture_id_for(topic: str) -> str:
        key = (topic or '').strip().lower()
        slug = LECTURE_ALIASES.get(key, slugify(topic))
        return f"lec-{slug}" if slug else ''

    def resources_for(resources_map, topic_or_id: str):
        if not isinstance(resources_map, dict):
            return []
        key = (topic_or_id or '').strip()
        # If caller passed a full id like 'lec-...'
        if key.startswith('lec-'):
            return resources_map.get(key, [])
        # Otherwise compute from topic text
        lid = lecture_id_for(key)
        return resources_map.get(lid, [])

    def _normalized(value: str) -> str:
        return (value or '').strip().lower()

    def _search_resources(resources_map, ids_iter, target_name, keywords=None):
        for lid in ids_iter:
            if not lid:
                continue
            for resource in resources_map.get(lid, []):
                if _normalized(resource.get('name')) != target_name:
                    continue
                rtype = _normalized(resource.get('type'))
                if keywords:
                    if not rtype:
                        continue
                    if not any(keyword in rtype for keyword in keywords):
                        continue
                return resource
        return None

    def find_assignment_resource(resources_map, assignment_name: str, lecture_id: str = ''):
        if not isinstance(resources_map, dict):
            return None

        target_name = _normalized(assignment_name)
        if not target_name:
            return None

        preferred_keywords = (
            'assignment',
            'homework',
            'project',
            'exam',
            'quiz',
            'practice',
            'solution',
        )

        candidate_ids = []
        if lecture_id:
            candidate_ids.append(lecture_id)
        slug = lecture_id_for(assignment_name)
        if slug and slug not in candidate_ids:
            candidate_ids.append(slug)
        
        # Also search in "lec-assignments" where assignments are stored
        if 'lec-assignments' not in candidate_ids:
            candidate_ids.append('lec-assignments')

        resource = _search_resources(resources_map, candidate_ids, target_name, preferred_keywords)
        if resource:
            return resource

        resource = _search_resources(resources_map, candidate_ids, target_name)
        if resource:
            return resource

        # Fallback: search all resources including lec-assignments
        all_keys = list(resources_map.keys())
        if 'lec-assignments' not in all_keys:
            all_keys.append('lec-assignments')
        
        resource = _search_resources(resources_map, all_keys, target_name, preferred_keywords)
        if resource:
            return resource

        return _search_resources(resources_map, all_keys, target_name)

    # Extract reading number from page title if it's a reading page
    reading_number = None
    if page.title and 'Reading' in page.title:
        match = re.search(r'Reading\s+(\d+)', page.title)
        if match:
            reading_number = match.group(1).zfill(2)  # Pad with zero: "01", "02", etc.

    settings = {
        'page'      : page,
        'dateutil'  : dateutil,
        'itertools' : itertools,
        'slugify'   : slugify,
        'lecture_id_for': lecture_id_for,
        'resources_for': resources_for,
        'find_assignment_resource': find_assignment_resource,
        'reading_number': reading_number,  # Add reading_number to template context
    }
    
    # Protect ALL tornado template syntax from markdown processing
    # Use HTML comments as placeholders so markdown doesn't wrap them in <p> tags
    template_patterns = []
    template_index = 0

    def protect_template(match):
        nonlocal template_index
        # Use HTML comment as placeholder - markdown won't wrap these
        placeholder = f'<!--__TEMPLATE_{template_index}__-->'
        template_patterns.append((placeholder, match.group(0)))
        template_index += 1
        return placeholder

    # Protect {% ... %} and {{ ... }} blocks
    body_protected = re.sub(r'\{%.*?%\}', protect_template, page.body, flags=re.DOTALL)
    body_protected = re.sub(r'\{\{.*?\}\}', protect_template, body_protected, flags=re.DOTALL)

    # Process through markdown (with template syntax protected)
    markdown_output = markdown.markdown(body_protected, extensions=['extra', toc, hilite, footnotes], output_format='html5')

    # Restore template syntax after markdown processing
    for placeholder, original in template_patterns:
        markdown_output = markdown_output.replace(placeholder, original)

    # Build layout that extends base template
    layout = '''{% extends "base.tmpl" %}

{% block body %}
''' + markdown_output + '''
{% end %}
'''

    template = tornado.template.Template(layout, loader=loader)
    print(template.generate(**settings).decode())

# Main Execution
def main():
    for path in sys.argv[1:]:
        page = load_page_from_yaml(path)
        render_page(page)

if __name__ == '__main__':
    main()

# vim: set sts=4 sw=4 ts=8 expandtab ft=python:
