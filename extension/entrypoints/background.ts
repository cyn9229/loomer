// Service worker. Chrome may stop it at any time, so it keeps no state in memory
// that cannot be rebuilt from storage. Scheduling uses alarms, which survive restarts.
import { collectCanvas } from '../src/adapters/canvas/collect';
import { parseDocId } from '../src/adapters/docs/reader';
import { analyzeRequirements } from '../src/analysis/analyze';
import { capturePage, type CaptureOutcome } from '../src/capture/capture';
import { db } from '../src/core/db';
import { discoveryStateItem, evaluateForeground } from '../src/discovery/discovery';
import { DOCS_ORIGINS, messageSchema, type Message, type Reply } from '../src/core/messages';
import { aiSettingsItem, discoveryItem, loadGateState, proactiveItem, settingsItem } from '../src/core/settings';
import { parseSourceUrl } from '../src/core/url';
import { askHelp, requestReview } from '../src/session/help';
import { dismissHint, proactiveStep } from '../src/session/proactive';
import { currentSession, endSession, setState, startSession, tickSession, touch } from '../src/session/session';
import { typingAtFor, typingItem } from '../src/session/typing';

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
    const now = new Date();
    const more = await tickSession(db, await loadGateState(), now, typingAtFor).catch((error: unknown) => {
      console.error('loomer: session tick failed', error);
      return true;
    });
    if (more) await runProactive(now);
    await runDiscovery();
    sessionLoop = more ? setTimeout(step, SESSION_LOOP_MS) : null;
    if (!more) await browser.alarms.clear(SESSION_ALARM);
  };
  sessionLoop = setTimeout(step, 0);
  void browser.alarms.create(SESSION_ALARM, { periodInMinutes: 0.5 });
}

/** Last keystroke in the active session's linked Doc, or null. */
async function linkedTypingAt(): Promise<number | null> {
  const s = await currentSession(db);
  const link = s ? await db.docLinks.get(s.assignmentId) : undefined;
  return typingAtFor(link?.docId);
}

let hintRunning = false;

/** One proactive step; at most one hint evaluation in flight. Badge only when the panel is closed. */
async function runProactive(now: Date) {
  if (hintRunning) return;
  hintRunning = true;
  try {
    const created = await proactiveStep(
      {
        db,
        ai: () => aiSettingsItem.getValue(),
        proactive: () => proactiveItem.getValue(),
        typingAt: linkedTypingAt,
      },
      now,
    );
    if (created !== null) {
      const panelOpen = (await browser.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length > 0;
      if (!panelOpen) {
        await browser.action.setBadgeBackgroundColor({ color: '#4f4dfd' });
        await browser.action.setBadgeText({ text: '1' });
      }
    }
  } catch (error) {
    console.error('loomer: proactive step failed', error);
  } finally {
    hintRunning = false;
  }
}

/** Hosts discovery never suggests: Google Docs, the school origin (or replay), the AI service. */
async function ownHosts(): Promise<string[]> {
  const [{ canvasOrigin }, ai] = await Promise.all([settingsItem.getValue(), aiSettingsItem.getValue()]);
  return ['docs.google.com', canvasOrigin, ai.brokerOrigin].flatMap((o) => (o ? [o.includes('://') ? new URL(o).hostname : o] : []));
}

/** Re-evaluates the foreground tab for research discovery. Cheap no-op when discovery is off. */
async function runDiscovery() {
  const prev = await discoveryStateItem.getValue();
  const enabled = (await discoveryItem.getValue()).enabled && (await browser.permissions.contains({ permissions: ['tabs'] }));
  if (!enabled && prev === null) return;
  const [tab] = enabled ? await browser.tabs.query({ active: true, lastFocusedWindow: true }) : [];
  const next = await evaluateForeground({ db, enabled, gate: await loadGateState(), ownHosts: await ownHosts(), tab, prev, now: Date.now() });
  if (JSON.stringify(next) === JSON.stringify(prev)) return;
  await discoveryStateItem.setValue(next);
  if (next?.suggestion && !prev?.suggestion && (await browser.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length === 0) {
    await browser.action.setBadgeBackgroundColor({ color: '#4f4dfd' });
    await browser.action.setBadgeText({ text: '+' });
  }
}

/** Registers the typing signal once Docs access exists. Safe to call repeatedly. */
async function registerTypingSignal() {
  if (!(await browser.permissions.contains({ origins: DOCS_ORIGINS }))) return;
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: ['docs-activity'] });
  if (existing.length > 0) return;
  await browser.scripting.registerContentScripts([
    {
      id: 'docs-activity',
      matches: ['https://docs.google.com/*'],
      js: ['content-scripts/docs-activity.js'],
      allFrames: true,
      matchOriginAsFallback: true,
      runAt: 'document_start',
      persistAcrossSessions: true,
    },
  ]);
}

/** A keystroke ping from the content script; trusted only for the linked Doc of the active session. */
async function onTyping(tabUrl: string | undefined) {
  const docId = tabUrl ? parseDocId(tabUrl) : null;
  const s = await currentSession(db);
  if (!docId || !s || s.state !== 'active') return;
  if ((await db.docLinks.get(s.assignmentId))?.docId !== docId) return;
  await typingItem.setValue({ docId, at: Date.now() });
  runSessionLoop();
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
      await runDiscovery();
      return { ok: true };
    }
    case 'session:end':
      await endSession(db, new Date());
      stopSessionLoop();
      await runDiscovery();
      return { ok: true };
    case 'discovery:set': {
      if (message.enabled && !(await browser.permissions.contains({ permissions: ['tabs'] }))) {
        return { ok: false, error: 'Chrome did not grant tab access.' };
      }
      await discoveryItem.setValue({ enabled: message.enabled });
      // Turning it off also gives the tabs permission back.
      if (!message.enabled) await browser.permissions.remove({ permissions: ['tabs'] }).catch(() => false);
      await runDiscovery();
      return { ok: true };
    }
    case 'suggestion:add': {
      const state = await discoveryStateItem.getValue();
      if (state?.suggestion?.tabId !== message.tabId) return { ok: false, error: 'That suggestion is no longer current.' };
      const tab = await browser.tabs.get(message.tabId);
      await captureFromTab(tab);
      // The site permission was for this one snapshot; give it back unless Loomer needs it anyway.
      if (tab.url) {
        const origin = new URL(tab.url).origin;
        if (!(await ownHosts()).includes(new URL(origin).hostname)) await browser.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
      }
      await discoveryStateItem.setValue({ ...state, candidate: null, suggestion: null });
      return { ok: true };
    }
    case 'suggestion:dismiss': {
      const state = await discoveryStateItem.getValue();
      if (state) await discoveryStateItem.setValue({ ...state, dismissed: true, candidate: null, suggestion: null });
      await browser.action.setBadgeText({ text: '' });
      return { ok: true };
    }
    case 'doc:link': {
      const docId = parseDocId(message.docUrl);
      if (!docId) return { ok: false, error: 'That is not a Google Docs document link.' };
      if (!(await browser.permissions.contains({ origins: DOCS_ORIGINS }))) {
        return { ok: false, error: 'Chrome access to Google Docs was not granted.' };
      }
      await db.docLinks.put({ assignmentId: message.assignmentId, docId, url: `https://docs.google.com/document/d/${docId}/edit`, linkedAt: new Date().toISOString() });
      await registerTypingSignal().catch((error: unknown) => console.error('loomer: typing signal unavailable', error));
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
      await dismissHint(db, message.id);
      await browser.action.setBadgeText({ text: '' });
      return { ok: true };
    case 'hint:seen':
      await browser.action.setBadgeText({ text: '' });
      return { ok: true };
    case 'proactive:set':
      await proactiveItem.setValue({ enabled: message.enabled, delaySec: message.delaySec });
      return { ok: true };
    case 'resume:dismiss': {
      const packet = await db.resumePackets.get(message.assignmentId);
      if (packet) await db.resumePackets.put({ ...packet, dismissed: true });
      return { ok: true };
    }
  }
}

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  const schedule = () => browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  browser.runtime.onInstalled.addListener(() => {
    void schedule();
    void refresh();
    browser.contextMenus.create({ id: CAPTURE_MENU, title: 'Add page to Loomer', contexts: ['page'] });
    void registerTypingSignal().catch(() => {});
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

  // Discovery watches only the foreground tab, and only while a session is active.
  browser.tabs.onActivated.addListener(() => void runDiscovery());
  browser.tabs.onUpdated.addListener((_id, change, tab) => {
    if (tab.active && (change.url || change.title || change.status === 'complete')) void runDiscovery();
  });
  browser.windows.onFocusChanged.addListener(() => void runDiscovery());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CAPTURE_MENU) void captureFromTab(tab);
  });
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'add-page') void captureFromTab(tab);
  });

  // Typing pings from the docs-activity content script carry no content; see onTyping.
  browser.runtime.onMessage.addListener((raw, sender) => {
    if (sender.id === browser.runtime.id && sender.tab && typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'docs:activity') {
      void onTyping(sender.tab.url);
    }
    return false;
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
