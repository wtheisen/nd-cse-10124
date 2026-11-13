# Sheet-driven website publisher

This Apps Script publishes the CSE 10124 website after ten quiet minutes of
owner edits. Install the same source as a container-bound script in:

- CSE 10124 - Resources
- CSE 10124 - Schedules
- CSE 10124 - Semester Info

## Installation

1. In the spreadsheet, open **Extensions > Apps Script**.
2. Replace `Code.gs` with the contents of `Code.js` in this directory.
3. Enable the manifest in **Project Settings**, then replace it with
   `appsscript.json` from this directory.
4. In **Project Settings > Script properties**, add `GITHUB_TOKEN` with a
   fine-grained token restricted to the `wtheisen/nd-cse-10124` repository and
   **Actions: write** permission.
5. Run `setupPublisher` once and approve the requested Google permissions.
6. Reload the spreadsheet. The owner will see **Website > Publish website now**.

Install and authorize the script separately in all three spreadsheets. Each project
maintains its own quiet-period queue; GitHub Actions concurrency collapses the
rare case where multiple sheets request builds at nearly the same time.

## Behavior

- Only edits attributed by Google to `wtheisen@nd.edu` enter the queue.
- Repeated edits postpone publication until ten quiet minutes have elapsed.
- Collaborator edits are ignored.
- Dispatch failures email the owner immediately and remain queued for retry.
- The manual menu command publishes immediately and clears that sheet's queue.

## Notebook sync (CSE 10124 - Resources only)

`Notebooks.js` takes the notebooks the Book Editor makes (its **Make notebook** button on a BaLLM chapter) into Drive
and onto this site. Every ten minutes it reads `ballm/notebooks.json` from `wtheisen/ai-landing-page` and, for each
notebook that is new or changed:

- writes it into the CSE 10124 **Notebooks** folder, replacing the content of the file with the same name, so the
  file id and its share links stay the same (a file is only created the first time; nothing is trashed),
- shares the student copy (anyone with the link can view) and puts its Colab link in the chapter's tab, in a row of
  its own, **Book Notebook** (columns D:F only), added the first time; the tab's existing **Notebook** row and every
  other row stay as they are,
- dispatches a website build when a link changed.

The Solutions copy goes into the folder but isn't linked. A chapter whose title doesn't match a tab name is reported
by email (rename the tab, or set `"sheetTab"` in the chapter's book-meta).

Installation, in **CSE 10124 - Resources** only:

1. **Extensions > Apps Script**: add a script file `Notebooks.gs` with the contents of `Notebooks.js`, and update
   `Code.gs` from `Code.js` (its menu gains **Sync notebooks now**).
2. **Project Settings**: replace the manifest with `appsscript.json` from this directory (it adds the Drive scope).
3. Run `setupNotebookSync` once and approve the Drive permission. It installs the ten-minute trigger and syncs once.

The other two spreadsheets don't need `Notebooks.js` or the Drive scope.
