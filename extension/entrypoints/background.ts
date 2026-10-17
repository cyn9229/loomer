// Service worker. Chrome may stop it at any time, so it keeps no state in memory
// that cannot be rebuilt from storage. Scheduling uses alarms, which survive restarts.
import { collectCanvas } from '../src/adapters/canvas/collect';
import { parseDocId } from '../src/adapters/docs/reader';
import { analyzeRequirements } from '../src/analysis/analyze';
import { capturePage, type CaptureOutcome } from '../src/capture/capture';
import { db } from '../src/core/db';
import { DOCS_ORIGINS, messageSchema, type Message, type Reply } from '../src/core/messages';
import { aiSettingsItem, loadGateState, settingsItem } from '../src/core/settings';
import { parseSourceUrl } from '../src/core/url';
import { askHelp, requestReview } from '../src/session/help';
import { currentSession, endSession, setState, startSession, tickSession, touch } from '../src/session/session';

const REFRESH_ALARM = 'canvas-refresh';
const REFRESH_MINUTES = 15;
/** Safety net that restarts the session loop if Chrome stopped the worker. */
const SESSION_ALARM = 'session-tick';
const SESSION_LOOP_MS = 5_000;
const CAPTURE_MENU = 'loomer-add-page';

let sessionLoop: ReturnType<typeof setTimeout> | null = null;

/**
 * Ticks the active session every few seconds. Doc reads are paced inside
 * tickSession (15 s minimum, backoff on 429). Each tick reads chrome.storage,
 * which keeps the worker alive only while a session is active.
 */
function runSessionLoop() {
  if (sessionLoop) return;
  const step = async () => {
    const more = await tickSession(db, await loadGateState(), new Date()).catch((error: unknown) => {
      console.error('loomer: session tick failed', error);
      return true;
    });
    sessionLoop = more ? setTimeout(step, SESSION_LOOP_MS) : null;
    if (!more) await browser.alarms.clear(SESSION_ALARM);
  };
  sessionLoop = setTimeout(step, 0);
  void browser.alarms.create(SESSION_ALARM, { periodInMinutes: 0.5 });
}

function stopSessionLoop() {
  if (sessionLoop) clearTimeout(sessionLoop);
  sessionLoop = null;
  void browser.alarms.clear(SESSION_ALARM);
}

/** Opens the linked Doc, focusing an existing tab when there is one. */
async function openDoc(assignmentId: string) {
  const link = await db.docLinks.get(assignmentId);
  if (!link) return;
  const [existing] = await browser.tabs.query({ url: `https://docs.google.com/document/d/${link.docId}/*` }).catch(() => []);
  if (existing?.id) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await browser.windows.update(existing.windowId, { focused: true });
  } else {
    await browser.tabs.create({ url: link.url });
  }
}

const CAPTURE_FEEDBACK: Record<'ok' | Extract<CaptureOutcome, { ok: false }>['reason'], string> = {
  ok: 'Added to Loomer',
  'no-session': 'Start a work session in Loomer to add pages',
  excluded: 'Loomer does not read this kind of page',
  'sign-in-page': 'Loomer does not read sign-in pages',
  unreadable: 'Loomer could not read this page',
  duplicate: 'Already saved for this assignment',
};

/** Right-click or shortcut: one snapshot of this tab, with quiet badge feedback. */
async function captureFromTab(tab: { id?: number; url?: string } | undefined) {
  if (!tab?.id) return;
  const outcome = await capturePage(db, await loadGateState(), tab, new Date(), async (tabId, func, maxChars) => {
    const [result] = await browser.scripting.executeScript({ target: { tabId }, func, args: [maxChars] });
    return result?.result;
  });
  const key = outcome.ok ? 'ok' : outcome.reason;
  await browser.action.setBadgeText({ tabId: tab.id, text: outcome.ok ? '✓' : '!' });
  await browser.action.setTitle({ tabId: tab.id, title: CAPTURE_FEEDBACK[key] });
  setTimeout(() => {
    void browser.action.setBadgeText({ tabId: tab.id, text: '' });
    void browser.action.setTitle({ tabId: tab.id, title: 'Open loomer' });
  }, 4_000);
}

let running: Promise<void> | null = null;
let rerun = false;

/**
 * One collection at a time. A request that arrives during a run (for example
 * Connect while the install-time check is still going) schedules one more run,
 * so it is never answered by a check that started with older settings.
 */
function refresh(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await runRefresh();
      // Analysis failures are stored per assignment; this only catches bugs.
      await analyze().catch((error: unknown) => console.error('loomer: analysis failed', error));
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** AI requirement analysis for the decision set. Reads consent fresh on every check. */
function analyze() {
  return analyzeRequirements({ db, ai: () => aiSettingsItem.getValue() });
}

async function runRefresh() {
  const { canvasOrigin } = await settingsItem.getValue();
  if (!canvasOrigin) return;
  // Chrome's grant is the technical maximum; the student can revoke it outside Loomer.
  if (!(await browser.permissions.contains({ origins: [`${canvasOrigin}/*`] }))) {
    await recordRun(canvasOrigin, 'no-permission', null);
    return;
  }
  try {
    await collectCanvas({ db, origin: canvasOrigin, gate: await loadGateState() });
  } catch (error) {
    // A bug must surface as a failed check, never as a silent "still checking".
    await recordRun(canvasOrigin, 'failed', error instanceof Error ? error.message : String(error));
  }
}

async function recordRun(origin: string, outcome: 'no-permission' | 'failed', error: string | null) {
  const at = new Date().toISOString();
  await db.runs.add({
    sourceKey: null,
    origin,
    startedAt: at,
    finishedAt: at,
    outcome,
    coverage: { courses: 0, plannerItems: 0, plannerTruncated: false, undatedCoursesChecked: 0, detailsFetched: 0, detailFailures: 0 },
    error,
  });
}

async function handle(message: Message): Promise<Reply> {
  switch (message.type) {
    case 'canvas:connect': {
      const url = parseSourceUrl(message.origin);
      if (!url) return { ok: false, error: 'Use an https Canvas address.' };
      if (!(await browser.permissions.contains({ origins: [`${url.origin}/*`] }))) {
        return { ok: false, error: 'Chrome access to this site was not granted.' };
      }
      const settings = await settingsItem.getValue();
      await settingsItem.setValue({ ...settings, canvasOrigin: url.origin, grantVersion: settings.grantVersion + 1 });
      void refresh();
      return { ok: true };
    }
    case 'canvas:refresh':
      await refresh();
      return { ok: true };
    case 'ai:set': {
      const ai = await aiSettingsItem.getValue();
      if (message.enabled && !(await browser.permissions.contains({ origins: [`${ai.brokerOrigin}/*`] }))) {
        return { ok: false, error: 'Chrome access to the local AI service was not granted.' };
      }
      await aiSettingsItem.setValue({ ...ai, enabled: message.enabled });
      if (message.enabled) void analyze();
      return { ok: true };
    }
    case 'policy:answer':
      await db.studentContext.put({
        ...(await db.studentContext.get(message.key)),
        key: message.key,
        policyAnswer: { value: message.value, answeredAt: new Date().toISOString() },
      });
      void analyze();
      return { ok: true };
    case 'item:hide':
      await db.studentContext.put({ ...(await db.studentContext.get(message.assignmentId)), key: message.assignmentId, hidden: message.hidden });
      return { ok: true };
    case 'session:start': {
      await startSession(db, message.assignmentId, new Date());
      await openDoc(message.assignmentId);
      runSessionLoop();
      return { ok: true };
    }
    case 'session:pause':
    case 'session:resume': {
      const s = await currentSession(db);
      if (!s) return { ok: false, error: 'No session.' };
      await setState(db, s, message.type === 'session:pause' ? 'paused' : 'active', new Date());
      if (message.type === 'session:resume') runSessionLoop();
      else stopSessionLoop();
      return { ok: true };
    }
    case 'session:end':
      await endSession(db, new Date());
      stopSessionLoop();
      return { ok: true };
    case 'doc:link': {
      const docId = parseDocId(message.docUrl);
      if (!docId) return { ok: false, error: 'That is not a Google Docs document link.' };
      if (!(await browser.permissions.contains({ origins: DOCS_ORIGINS }))) {
        return { ok: false, error: 'Chrome access to Google Docs was not granted.' };
      }
      await db.docLinks.put({ assignmentId: message.assignmentId, docId, url: `https://docs.google.com/document/d/${docId}/edit`, linkedAt: new Date().toISOString() });
      const s = await currentSession(db);
      if (s?.assignmentId === message.assignmentId && s.state === 'active') runSessionLoop();
      return { ok: true };
    }
    case 'source:remove':
      await db.sources.delete(message.id);
      return { ok: true };
    case 'help:ask':
    case 'help:review': {
      const s = await currentSession(db);
      if (s?.assignmentId === message.assignmentId) await touch(db, s, new Date());
      const deps = { db, ai: () => aiSettingsItem.getValue() };
      await (message.type === 'help:ask' ? askHelp(deps, message.assignmentId, message.text) : requestReview(deps, message.assignmentId));
      return { ok: true };
    }
    case 'hint:dismiss':
      return { ok: false, error: 'Proactive hints arrive in M4.' };
  }
}

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  const schedule = () => browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  browser.runtime.onInstalled.addListener(() => {
    void schedule();
    void refresh();
    browser.contextMenus.create({ id: CAPTURE_MENU, title: 'Add page to Loomer', contexts: ['page'] });
  });
  // Catch up after the browser was closed. A session never resumes on its own:
  // restored tabs must not restart Doc reads or capture without the student.
  browser.runtime.onStartup.addListener(() => {
    void schedule();
    void refresh();
    void currentSession(db).then((s) => (s?.state === 'active' ? setState(db, s, 'paused', new Date()) : undefined));
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) void refresh();
    if (alarm.name === SESSION_ALARM) runSessionLoop();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CAPTURE_MENU) void captureFromTab(tab);
  });
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'add-page') void captureFromTab(tab);
  });

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    // Only this extension's own pages. Content scripts share the extension id but
    // report the web page URL, and pages opened in a tab also carry sender.tab.
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/'))) return false;
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) return false;
    handle(parsed.data).then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: String(error) } satisfies Reply));
    return true;
  });
});
