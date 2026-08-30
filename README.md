# CSE 10124 - Building ChatGPT

Course website for CSE 10124 at Notre Dame for Fall 2026.

## Development

```bash
npm install       # Install dependencies
npm run serve     # Dev server with live reload
npm run build     # Build to docs/
```

## Deployment

Push to `main` triggers GitHub Actions to build and deploy to GitHub Pages.

## Themed notebook previews

Notebook previews are exported with `nbconvert`, then post-processed into light
and dark variants that use the same Bluegold and Gruvbox stylesheets as the
course website. From this directory, regenerate Lab 01 with:

```bash
python3 scripts/render_notebook_preview.py \
  "../Assignments/Labs/lab01_fa26.ipynb" \
  --output-base static/labs/lab01/lab01 \
  --css-dir static/css
```

The lab page selects `lab01-light.html` or `lab01-dark.html` when the site theme
changes. Commit both generated files whenever the source notebook changes.
