/**
 * CSE 10124 notebooks from the BaLLM book (2026-11-13). Install in the CSE 10124 - Resources spreadsheet only,
 * next to Code.js (see README.md, "Notebook sync").
 *
 * The Book Editor's "Make notebook" button builds a chapter's two notebooks from its Lecture (student and Solutions)
 * and lists them in ai-landing-page's ballm/notebooks.json. Every ten minutes (or Website > Sync notebooks now) this:
 *   1. copies each new or changed notebook into the CSE 10124 Notebooks folder in Drive, overwriting the file of the
 *      same name in place, so its file id and every share link to it stay the same (a new one is created only the
 *      first time; nothing is ever trashed),
 *   2. shares the student copy as anyone-with-the-link can view, and puts its Colab link in the chapter's tab
 *      (the tab named like the chapter) in a row of its own, "Book Notebook" (columns D:F only; column B is the
 *      sheet's own formula). Every other row, the tab's existing "Notebook" link included, is left as it is
 *      (Eric, 2026-11-13: don't replace the old notebooks),
 *   3. rebuilds the course website when a link changed.
 * The Solutions copy goes into the folder but isn't linked anywhere.
 */

const NOTEBOOK_CONFIG = Object.freeze({
  manifestUrl: 'https://raw.githubusercontent.com/wtheisen/ai-landing-page/main/ballm/notebooks.json',
  rawBase: 'https://raw.githubusercontent.com/wtheisen/ai-landing-page/main/',
  folderId: '12NkDRl_8M_X5n6SNcwObGrq3LikcezGL',   // CSE 10124 > Notebooks (where Programming_Day_NN_*.ipynb live)
  mimeType: 'application/vnd.google.colaboratory',
  everyMinutes: 10,
  rowName: 'Book Notebook',   // its own row: the tab's existing "Notebook" row (older notebooks) is never touched
});

const NOTEBOOK_KEYS = Object.freeze({
  shas: 'NOTEBOOK_SHAS',   // file name -> the manifest sha last copied
  ids: 'NOTEBOOK_IDS',     // file name -> Drive file id
});

/** Run once (Extensions > Apps Script > Run): installs the ten-minute sync and runs it now. */
function setupNotebookSync() {
  assertOwner_();
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'syncNotebooks') ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('syncNotebooks').timeBased().everyMinutes(NOTEBOOK_CONFIG.everyMinutes).create();
  DriveApp.getFolderById(NOTEBOOK_CONFIG.folderId);   // fails here, not later, if the folder isn't reachable
  return syncNotebooks();
}

/** Website > Sync notebooks now */
function syncNotebooksNow() {
  assertOwner_();
  const done = syncNotebooks();
  SpreadsheetApp.getUi().alert(done.length ? 'Updated in Drive: ' + done.join(', ') : 'Every notebook is up to date.');
}

/** The sync itself (time trigger). Returns the file names it copied. */
function syncNotebooks() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return [];
  try {
    const res = UrlFetchApp.fetch(NOTEBOOK_CONFIG.manifestUrl + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() === 404) return [];   // no notebooks made yet
    if (res.getResponseCode() !== 200) throw new Error('notebooks.json: HTTP ' + res.getResponseCode());
    const manifest = JSON.parse(res.getContentText());
    const props = PropertiesService.getScriptProperties();
    const shas = JSON.parse(props.getProperty(NOTEBOOK_KEYS.shas) || '{}');
    const ids = JSON.parse(props.getProperty(NOTEBOOK_KEYS.ids) || '{}');
    const done = [], problems = [];
    let linked = false;
    for (const slug of Object.keys(manifest)) {
      const entry = manifest[slug];
      if (slug.charAt(0) === '_' || !entry || !entry.files) continue;
      for (const f of entry.files) {
        const known = ids[f.name] && shas[f.name] === f.sha;
        if (known && f.role !== 'student') continue;
        let file;
        if (known) {
          file = DriveApp.getFileById(ids[f.name]);
        } else {
          const body = UrlFetchApp.fetch(NOTEBOOK_CONFIG.rawBase + f.path + '?t=' + Date.now(), { muteHttpExceptions: true });
          if (body.getResponseCode() !== 200) { problems.push(f.name + ': HTTP ' + body.getResponseCode()); continue; }
          const text = body.getContentText('UTF-8');
          if (sha1_(text) !== f.sha) continue;   // the site hasn't caught up with the manifest yet: next time
          file = upsertNotebook_(f.name, text, ids);
          shas[f.name] = f.sha; done.push(f.name);
        }
        if (f.role === 'student') {
          if (!known) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          const r = linkNotebook_(entry.tab, file.getId());
          if (r === null) problems.push('no tab named "' + entry.tab + '" for ' + f.name);
          linked = linked || r === true;
        }
      }
    }
    props.setProperty(NOTEBOOK_KEYS.shas, JSON.stringify(shas));
    props.setProperty(NOTEBOOK_KEYS.ids, JSON.stringify(ids));
    if (linked) dispatchWebsiteBuild_('notebooks');
    if (problems.length) notifyNotebookProblems_(problems);
    return done;
  } finally {
    lock.releaseLock();
  }
}

/** Writes a notebook into the folder: the same file again if there is one (content replaced, id kept), else a new one. */
function upsertNotebook_(name, text, ids) {
  const folder = DriveApp.getFolderById(NOTEBOOK_CONFIG.folderId);
  let file = null;
  if (ids[name]) {
    try { file = DriveApp.getFileById(ids[name]); if (file.isTrashed()) file = null; } catch (e) { file = null; }
  }
  if (!file) {
    const same = folder.getFilesByName(name);
    while (same.hasNext()) { const f = same.next(); if (!f.isTrashed()) { file = f; break; } }
  }
  if (file) file.setContent(text);
  else file = folder.createFile(name, text, NOTEBOOK_CONFIG.mimeType);
  ids[name] = file.getId();
  return file;
}

/**
 * Puts the Colab link in the chapter tab's "Book Notebook" row (columns D:F), adding the row if there is none.
 * Returns true if the link changed, false if it was already there, null if there is no such tab.
 */
function linkNotebook_(tab, fileId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(tab);
  if (!sheet) return null;
  const url = 'https://colab.research.google.com/drive/' + fileId + '?usp=sharing';
  const last = sheet.getLastRow();
  const rows = last >= 3 ? sheet.getRange(3, 4, last - 2, 3).getValues() : [];   // D:F from row 3 (row 2 is the header)
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === NOTEBOOK_CONFIG.rowName) {
      if (rows[i][2] === url) return false;
      sheet.getRange(3 + i, 6).setValue(url);
      return true;
    }
  }
  let at = 3;
  while (at <= last && sheet.getRange(at, 4).getValue() !== '') at++;
  sheet.getRange(at, 4, 1, 3).setValues([[NOTEBOOK_CONFIG.rowName, 'notebook', url]]);
  return true;
}

function sha1_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, text, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function notifyNotebookProblems_(problems) {
  const props = PropertiesService.getScriptProperties();
  const key = 'NOTEBOOK_PROBLEMS', said = problems.join('\n');
  if (props.getProperty(key) === said) return;   // once per distinct problem, not every ten minutes
  props.setProperty(key, said);
  MailApp.sendEmail({
    to: PUBLISHER_CONFIG.ownerEmail,
    subject: 'CSE 10124 notebook sync needs a look',
    body: 'The notebook sync in CSE 10124 - Resources could not finish:\n\n' + said +
      '\n\nA missing tab: rename the tab to the chapter\'s title, or set "sheetTab" in the chapter\'s book-meta.',
  });
}
