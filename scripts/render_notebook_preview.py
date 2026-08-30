#!/usr/bin/env python3
"""Render a notebook as website-themed light and dark HTML previews."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys


TODO_PATTERN = re.compile(r'(<span class="c[^"]*">[^<]*?)(TODO)(?=[:\s])')
THEMES = {
    "light": ("bluegold.css", "bluegold"),
    "dark": ("gruvbox-dark.css", "gruvbox-dark"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export an .ipynb and apply the course website themes."
    )
    parser.add_argument("notebook", type=Path, help="Notebook to export")
    parser.add_argument(
        "--output-base",
        required=True,
        type=Path,
        help="Output path without -light/-dark.html",
    )
    parser.add_argument(
        "--css-dir",
        default=Path("static/css"),
        type=Path,
        help="Directory containing bluegold.css and gruvbox-dark.css",
    )
    return parser.parse_args()


def add_theme(
    html: str, variant: str, theme_name: str, stylesheet_href: str
) -> str:
    themed = TODO_PATTERN.sub(
        lambda match: (
            f'{match.group(1)}<span class="todo-keyword">{match.group(2)}</span>'
        ),
        html,
    )
    link = (
        f'<link rel="stylesheet" href="{stylesheet_href}" '
        f'data-theme="{variant}">\n'
    )
    if "</head>" not in themed:
        raise ValueError("nbconvert output does not contain a closing </head> tag")
    themed = themed.replace("</head>", f"{link}</head>", 1)
    if "<body" not in themed:
        raise ValueError("nbconvert output does not contain a <body> tag")
    themed = themed.replace("<body", f'<body data-theme="{theme_name}"', 1)
    if variant == "dark":
        themed = themed.replace(
            'data-jp-theme-light="true"', 'data-jp-theme-light="false"', 1
        )
        themed = themed.replace(
            'data-jp-theme-name="JupyterLab Light"',
            'data-jp-theme-name="Gruvbox Dark"',
            1,
        )
    return themed


def main() -> None:
    args = parse_args()
    notebook = args.notebook.resolve()
    output_base = args.output_base.resolve()
    css_dir = args.css_dir.resolve()

    if not notebook.is_file():
        raise SystemExit(f"Notebook not found: {notebook}")
    for stylesheet, _theme_name in THEMES.values():
        if not (css_dir / stylesheet).is_file():
            raise SystemExit(f"Stylesheet not found: {css_dir / stylesheet}")

    output_base.parent.mkdir(parents=True, exist_ok=True)
    raw_path = output_base.with_suffix(".html")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "nbconvert",
            "--to",
            "html",
            "--template",
            "lab",
            "--output",
            raw_path.stem,
            "--output-dir",
            str(raw_path.parent),
            str(notebook),
        ],
        check=True,
    )

    raw_html = raw_path.read_text(encoding="utf-8")
    try:
        for variant, (stylesheet, theme_name) in THEMES.items():
            stylesheet_href = os.path.relpath(
                css_dir / stylesheet, start=output_base.parent
            )
            stylesheet_hash = hashlib.sha256(
                (css_dir / stylesheet).read_bytes()
            ).hexdigest()[:12]
            stylesheet_href = f"{stylesheet_href}?v={stylesheet_hash}"
            destination = output_base.parent / f"{output_base.name}-{variant}.html"
            destination.write_text(
                add_theme(raw_html, variant, theme_name, stylesheet_href),
                encoding="utf-8",
            )
            print(f"Rendered {destination}")
    finally:
        raw_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
