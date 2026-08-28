/** @OnlyCurrentDoc */

/**
 * CSE 10124 website publisher for Google Sheets.
 *
 * Install this as a container-bound Apps Script project in the Resources,
 * Schedules, and Semester Info spreadsheets. Run setupPublisher() once in each
 * project, then add a GITHUB_TOKEN entry in Project Settings > Script properties.
 */

const PUBLISHER_CONFIG = Object.freeze({
  ownerEmail: 'wtheisen@nd.edu',
  githubOwner: 'wtheisen',
  githubRepository: 'nd-cse-10124',
  githubWorkflow: 'build.yaml',
  githubRef: 'main',
  quietPeriodMs: 10 * 60 * 1000,
  failureRetryMs: 10 * 60 * 1000,
});

const PUBLISHER_KEYS = Object.freeze({
  githubToken: 'GITHUB_TOKEN',
  lastOwnerEditAt: 'LAST_OWNER_EDIT_AT',
  pendingTriggerId: 'PENDING_TRIGGER_ID',
  lastIdentityWarningDate: 'LAST_IDENTITY_WARNING_DATE',
});

/** Adds the owner-only publishing menu when the spreadsheet opens. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Website')
    .addItem('Publish website now', 'publishWebsiteNow')
    .addToUi();
}

/**
 * Installs this project's edit trigger and validates its configuration.
 * Run manually once after copying the script into a spreadsheet.
 */
function setupPublisher() {
  assertOwner_();

  const spreadsheet = SpreadsheetApp.getActive();
  if (!spreadsheet) {
    throw new Error('Open this function from a spreadsheet-bound Apps Script project.');
  }

  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'recordOwnerEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger('recordOwnerEdit')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();

  const token = PropertiesService.getScriptProperties().getProperty(
    PUBLISHER_KEYS.githubToken,
  );
  if (!token) {
    throw new Error(
      'Edit trigger installed. Add GITHUB_TOKEN in Project Settings > Script properties before publishing.',
    );
  }

  console.log(
    'Website publisher installed. Owner edits will publish after ten quiet minutes.',
  );
}

/** Records an owner edit without dispatching a workflow for every cell change. */
function recordOwnerEdit(event) {
  const editorEmail = getEventUserEmail_(event);
  if (!editorEmail) {
    notifyMissingEditorIdentityOncePerDay_();
    return;
  }
  if (normalizeEmail_(editorEmail) !== normalizeEmail_(PUBLISHER_CONFIG.ownerEmail)) {
    return;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty(PUBLISHER_KEYS.lastOwnerEditAt, String(Date.now()));
    ensurePublisherTrigger_(properties, PUBLISHER_CONFIG.quietPeriodMs);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Publishes after ten minutes without another owner edit. If editing continues,
 * the same queue reschedules itself rather than creating GitHub Actions runs.
 */
function processPublishQueue() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    properties.deleteProperty(PUBLISHER_KEYS.pendingTriggerId);

    const lastEditAt = Number(
      properties.getProperty(PUBLISHER_KEYS.lastOwnerEditAt) || 0,
    );
    if (!lastEditAt) return;

    const quietForMs = Date.now() - lastEditAt;
    if (quietForMs < PUBLISHER_CONFIG.quietPeriodMs) {
      ensurePublisherTrigger_(
        properties,
        PUBLISHER_CONFIG.quietPeriodMs - quietForMs,
      );
      return;
    }

    try {
      dispatchWebsiteBuild_('sheet_quiet_period');
      properties.deleteProperty(PUBLISHER_KEYS.lastOwnerEditAt);
    } catch (error) {
      notifyDispatchFailure_(error, 'automatic quiet-period publication');
      ensurePublisherTrigger_(properties, PUBLISHER_CONFIG.failureRetryMs);
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

/** Immediately publishes from the owner-only Website spreadsheet menu. */
function publishWebsiteNow() {
  assertOwner_();

  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    try {
      dispatchWebsiteBuild_('sheet_publish_now');
      properties.deleteProperty(PUBLISHER_KEYS.lastOwnerEditAt);
      deletePendingPublisherTrigger_(properties);
      ui.alert('Website build requested successfully.');
    } catch (error) {
      notifyDispatchFailure_(error, 'manual publication');
      ui.alert(`Website publication failed: ${error.message}`);
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

function dispatchWebsiteBuild_(source) {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty(PUBLISHER_KEYS.githubToken);
  if (!token) {
    throw new Error('GITHUB_TOKEN is not configured in Script properties.');
  }

  const workflow = encodeURIComponent(PUBLISHER_CONFIG.githubWorkflow);
  const url =
    `https://api.github.com/repos/${PUBLISHER_CONFIG.githubOwner}/` +
    `${PUBLISHER_CONFIG.githubRepository}/actions/workflows/${workflow}/dispatches`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cse-10124-sheet-publisher',
    },
    payload: JSON.stringify({
      ref: PUBLISHER_CONFIG.githubRef,
      inputs: { source },
    }),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status !== 200 && status !== 204) {
    const body = response.getContentText().slice(0, 1000);
    throw new Error(`GitHub workflow dispatch returned HTTP ${status}: ${body}`);
  }
}

function ensurePublisherTrigger_(properties, delayMs) {
  if (properties.getProperty(PUBLISHER_KEYS.pendingTriggerId)) return;

  const trigger = ScriptApp.newTrigger('processPublishQueue')
    .timeBased()
    .after(Math.max(delayMs, 60 * 1000))
    .create();
  properties.setProperty(PUBLISHER_KEYS.pendingTriggerId, trigger.getUniqueId());
}

function deletePendingPublisherTrigger_(properties) {
  const pendingId = properties.getProperty(PUBLISHER_KEYS.pendingTriggerId);
  if (!pendingId) return;

  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getUniqueId() === pendingId) {
      ScriptApp.deleteTrigger(trigger);
      break;
    }
  }
  properties.deleteProperty(PUBLISHER_KEYS.pendingTriggerId);
}

function getEventUserEmail_(event) {
  if (event && event.user && typeof event.user.getEmail === 'function') {
    const eventEmail = event.user.getEmail();
    if (eventEmail) return eventEmail;
  }

  // Never fall back to the trigger's executing account for an edit event. That
  // could make a collaborator's edit look like the owner's edit when Google
  // withholds e.user for privacy reasons.
  return event ? '' : Session.getActiveUser().getEmail() || '';
}

function isCurrentUserOwner_() {
  return (
    normalizeEmail_(Session.getActiveUser().getEmail()) ===
    normalizeEmail_(PUBLISHER_CONFIG.ownerEmail)
  );
}

function assertOwner_() {
  if (!isCurrentUserOwner_()) {
    throw new Error('Only the configured course-site owner may publish the website.');
  }
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function notifyMissingEditorIdentityOncePerDay_() {
  const properties = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'America/Indiana/Indianapolis', 'yyyy-MM-dd');
  if (properties.getProperty(PUBLISHER_KEYS.lastIdentityWarningDate) === today) {
    return;
  }

  properties.setProperty(PUBLISHER_KEYS.lastIdentityWarningDate, today);
  MailApp.sendEmail({
    to: PUBLISHER_CONFIG.ownerEmail,
    subject: 'CSE 10124 publisher could not identify a spreadsheet editor',
    body:
      'A spreadsheet edit was ignored because Google did not expose the editor identity. ' +
      'Open the sheet and use Website > Publish website now if the edit was yours.',
  });
}

function notifyDispatchFailure_(error, context) {
  MailApp.sendEmail({
    to: PUBLISHER_CONFIG.ownerEmail,
    subject: 'CSE 10124 website publication failed',
    body:
      `The ${context} failed.\n\n` +
      `${error && error.stack ? error.stack : String(error)}\n\n` +
      'The queued change remains pending and will be retried in ten minutes when applicable.',
  });
}
