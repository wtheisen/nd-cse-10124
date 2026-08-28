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
