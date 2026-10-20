// Service worker. Chrome may stop it at any time, so it keeps no state in memory
// that cannot be rebuilt from storage. Scheduling uses alarms, which survive restarts.
import { storage } from 'wxt/utils/storage';
import { collectCanvas } from '../src/adapters/canvas/collect';
import { parseDocId } from '../src/adapters/docs/reader';
import { analyzeRequirements } from '../src/analysis/analyze';
import { capturePage, type CaptureOutcome } from '../src/capture/capture';
import { draftScreenshot, saveScreenshot, screenshotAllowed, screenshotDraftItem, type Crop, type ScreenshotRefusal } from '../src/capture/screenshot';
import { notifyDeadlineChanges } from '../src/notify/notify';
import { checkRequirements } from '../src/session/requirements';
import { isStreaming, sendChat, stopChat } from '../src/chat/engine';
import { db } from '../src/core/db';
import { discoveryStateItem, evaluateForeground } from '../src/discovery/discovery';
import { DOCS_ORIGINS, messageSchema, type Message, type Reply } from '../src/core/messages';
import { aiServiceItem, aiSettingsItem, askThreadItem, briefDismissedItem, chatInboxItem, choiceItem, discoveryItem, levelMinutesItem, loadGateState, notifyItem, planSnapshotItem, proactiveItem, settingsItem } from '../src/core/settings';
import { applyChange, dismissChange, editFromItem, proposeChange, undoChange, type PlanSettings } from '../src/analysis/changes';
import { effectiveDue, isOpen } from '../src/analysis/facts';
import { localDay } from '../src/analysis/plan';
import { nextPlanSnapshot } from '../src/analysis/recommend';
import { answerSlip, recordSuggestedStart } from '../src/analysis/slip';
import { addNotes, answerPractice, editTopics, endPractice, nextQuestion, practiceLike, prepEligible, setFormats, setupPrep, startPractice, todayKind, writePractice } from '../src/prep/prep';
import { loadHomeData } from '../src/model/homeData';
import { parseSourceUrl } from '../src/core/url';
import { addExclusion, deleteAssignmentData, removeExclusion } from '../src/privacy/privacy';
import { requestReview } from '../src/session/help';
import { dismissHint, proactiveStep } from '../src/session/proactive';
import { focusStep } from '../src/session/focus';
import { embeddedTopicsStep, findTopic, recordTopicAnswer, setTopicSkipped, topicsStep } from '../src/session/topics';
import { readEmbeddedSheets } from '../src/adapters/docs/sheets';
import { covered, loadNudgeState, muted, nudgeAfter, nudgesItem, saveNudgeState, type NudgeSignal, type NudgeState } from '../src/session/nudge';
import { closeStaleSessions, currentSession, endSession, setPlannedTime, setState, startSession, tickSession, touch } from '../src/session/session';
import { closeSession, nextStepStep } from '../src/session/close';
import { imageAttachment, MAX_ATTACHMENTS } from '../src/chat/attachments';
import type { Attachment } from '../src/model/chat';
import { addAssignment, deleteAddedAssignment, editAssignment } from '../src/session/added';
import { typingAtFor, typingItem } from '../src/session/typing';

const REFRESH_ALARM = 'canvas-refresh';
const REFRESH_MINUTES = 15;
/** Safety net that restarts the session loop if Chrome stopped the worker. */
const SESSION_ALARM = 'session-tick';
const SESSION_LOOP_MS = 5_000;
const CAPTURE_MENU = 'loomer-add-page';
const SCREENSHOT_MENU = 'loomer-screenshot';
const CHAT_SHOT_MENU = 'loomer-chat-screenshot';
/** Session that already got its one research reminder notification. */
const remindedItem = storage.defineItem<number | null>('session:reminded', { fallback: null });

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
    if (more) await Promise.all([runProactive(now), runTopics(now), runFocus(now)]);
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

let focusRunning = false;

/** Picks the writing session's focus once; one request in flight. */
async function runFocus(now: Date) {
  if (focusRunning) return;
  focusRunning = true;
  try {
    await focusStep({ db, ai: () => aiSettingsItem.getValue() }, now);
  } catch (error) {
    console.error('loomer: focus step failed', error);
  } finally {
    focusRunning = false;
  }
}

let topicsRunning = false;

/** Reads the linked sheet's topics for practice or study work; one read in flight. */
async function runTopics(now: Date) {
  if (topicsRunning) return;
  topicsRunning = true;
  try {
    await topicsStep({ db, ai: () => aiSettingsItem.getValue() }, now);
  } catch (error) {
    console.error('loomer: topics step failed', error);
  } finally {
    topicsRunning = false;
  }
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
    // At most one desktop reminder per session, and only if the student turned notifications on.
    if ((await remindedItem.getValue()) !== next.sessionId) {
      await remindedItem.setValue(next.sessionId);
      await notify(`research-${next.sessionId}`, 'Researching for this assignment?', `Add "${next.suggestion.title}" to Loomer from the side panel.`);
    }
  }
}

/** Shows a desktop notification only when the student enabled them and Chrome granted the permission. */
async function notify(id: string, title: string, message: string) {
  if (!(await notifyItem.getValue()).enabled) return;
  if (!(await browser.permissions.contains({ permissions: ['notifications'] }))) return;
  await browser.notifications.create(id, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title, message, priority: 0 });
}

const SCREENSHOT_FEEDBACK: Record<ScreenshotRefusal, string> = {
  paused: 'Loomer is paused. Resume it in settings first',
  'no-session': 'Start a work session in Loomer to capture screenshots',
  excluded: 'Loomer does not capture this kind of page',
  'sign-in-page': 'Loomer does not capture sign-in pages',
  unreadable: 'Loomer could not capture this tab',
};

/** Right-click screenshot: capture the visible tab into a draft for preview and crop in the panel. */
async function screenshotFromTab(tab: { id?: number; windowId?: number; url?: string; title?: string } | undefined) {
  if (!tab?.id) return;
  const result = await draftScreenshot(db, await loadGateState(), tab, new Date(), {
    hasPasswordField: async (tabId) => {
      const [r] = await browser.scripting.executeScript({ target: { tabId }, func: () => document.querySelector('input[type="password"]') !== null });
      return r?.result === true;
    },
    captureVisible: (windowId) => browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 85 }),
    imageSize: async (dataUrl) => {
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    },
  });
  if (!result.ok) {
    await browser.action.setBadgeText({ tabId: tab.id, text: '!' });
    await browser.action.setTitle({ tabId: tab.id, title: SCREENSHOT_FEEDBACK[result.reason] });
    setTimeout(() => {
      void browser.action.setBadgeText({ tabId: tab.id, text: '' });
      void browser.action.setTitle({ tabId: tab.id, title: 'Open Loomer' });
    }, 4_000);
  }
}

/** Crops a JPEG data URL in the worker (no DOM) and returns a smaller JPEG data URL. */
async function cropImage(dataUrl: string, crop: Crop): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob(), crop.x, crop.y, crop.width, crop.height);
  // Keep stored screenshots small: at most 1600 px wide.
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/**
 * Clear all: stop observation, let a running check finish so it cannot write
 * afterwards, empty every table and Loomer's settings, remove the typing script,
 * and give back the site and tab access Loomer was granted. Returns to setup.
 */
/**
 * "Send screenshot to Ask Loomer": the right-click grants this tab once, so the
 * visible part is captured, shrunk, and left in chatInboxItem for the composer.
 * Sign-in pages and sites the student blocked are refused.
 */
async function chatShotFromTab(tab: Browser.tabs.Tab) {
  const inbox = (await chatInboxItem.getValue()) ?? { attachments: [], error: null, at: '' };
  const put = (attachments: Attachment[], error: string | null) => chatInboxItem.setValue({ attachments, error, at: new Date().toISOString() });
  if (!screenshotAllowed(await loadGateState(), tab.url)) return put(inbox.attachments, "Loomer doesn't take screenshots of this page, because it's a sign-in page or a site you blocked.");
  if (inbox.attachments.length >= MAX_ATTACHMENTS) return put(inbox.attachments, 'One message can carry up to 5 things, so send these first.');
  const shot = await browser.tabs.captureVisibleTab(tab.windowId!, { format: 'png' });
  const host = tab.url ? new URL(tab.url).hostname.replace(/^www\./, '') : 'this page';
  await put([...inbox.attachments, await imageAttachment(await (await fetch(shot)).blob(), `Screenshot of ${host}.jpg`)], null);
}

/** Links a Google Doc to an assignment. The page asked Chrome for Docs access first. */
async function linkDoc(assignmentId: string, docUrl: string): Promise<Reply> {
  const docId = parseDocId(docUrl);
  if (!docId) return { ok: false, error: "That isn't a Google Doc link." };
  if (!(await browser.permissions.contains({ origins: DOCS_ORIGINS }))) {
    return { ok: false, error: "Chrome didn't allow Google Docs." };
  }
  await db.docLinks.put({ assignmentId, docId, url: `https://docs.google.com/document/d/${docId}/edit`, linkedAt: new Date().toISOString() });
  await registerTypingSignal().catch((error: unknown) => console.error('loomer: typing signal unavailable', error));
  const s = await currentSession(db);
  if (s?.assignmentId === assignmentId && s.state === 'active') runSessionLoop();
  return { ok: true };
}

/** Recomputes the plan snapshot so Home's top stays steady and can say what moved. */
async function updatePlan() {
  const { snapshot: prev, ...settings } = await planSettings();
  const data = await loadHomeData(db);
  const now = new Date();
  const next = nextPlanSnapshot({ ...data, ...settings, snapshot: prev, briefDismissedOn: null, now }, prev);
  if (JSON.stringify(next) !== JSON.stringify(prev)) await planSnapshotItem.setValue(next);
  // Home's top says "start today": remember it, so a start that doesn't happen can be noticed tomorrow.
  const startBy = next?.topId ? next.entries[next.topId]?.startBy : null;
  if (next?.topId && startBy && localDay(new Date(startBy)) <= localDay(now)) await recordSuggestedStart(db, next.topId, localDay(now));
}

/** Pings the local AI service and records whether it answered. Only while AI is on. */
async function checkAiService() {
  const ai = await aiSettingsItem.getValue();
  if (!ai.enabled) return;
  let up = false;
  try {
    up = (await fetch(`${ai.brokerOrigin}/health`, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    up = false;
  }
  await aiServiceItem.setValue({ up, checkedAt: new Date().toISOString() });
}

async function planSettings(): Promise<PlanSettings> {
  const [settings, ai, choice, snapshot, levelMinutes] = await Promise.all([
    settingsItem.getValue(),
    aiSettingsItem.getValue(),
    choiceItem.getValue(),
    planSnapshotItem.getValue(),
    levelMinutesItem.getValue(),
  ]);
  return { connected: Boolean(settings.canvasOrigin), ai, choice, snapshot, levelMinutes };
}

/** The student's one-tap request about a sheet topic, in their words. */
function topicRequest(topic: { text: string; quote: string }, mode: 'explain' | 'example' | 'check'): string {
  // The bubble names only the topic; the quote is often a problem itself, and the quiz tool refuses copied math.
  const name = /^[A-Z][a-z]/.test(topic.text) ? topic.text.charAt(0).toLowerCase() + topic.text.slice(1) : topic.text;
  if (mode === 'explain') return `Explain ${name} from my sheet.`;
  if (mode === 'example') return `Show me an example like ${name}.`;
  return `Give me a quick check on ${name}.`;
}

/** Starts a chat reply in the background; keeps the worker awake while it streams. `topic`: a sheet topic the student tapped. */
function startChat(threadKey: string, text: string, topic: string | null = null, attachments: Attachment[] = []) {
  const keepAlive = setInterval(() => void browser.runtime.getPlatformInfo(), 15_000);
  void sendChat(
    {
      db,
      ai: () => aiSettingsItem.getValue(),
      settings: planSettings,
    },
    threadKey,
    text,
    { topic, attachments },
  )
    .catch((error: unknown) => console.error('loomer: chat failed', error))
    .finally(() => {
      clearInterval(keepAlive);
      void checkAiService();
    });
}

async function rememberChoice(assignmentId: string) {
  const a = await db.assignments.get(assignmentId);
  if (a) await choiceItem.setValue({ assignmentId, dueAt: a.dueAt, detailHash: a.detail?.hash ?? null, at: new Date().toISOString() });
}

async function clearAll() {
  stopSessionLoop();
  await running?.catch(() => {});
  await db.transaction('rw', db.tables, () => Promise.all(db.tables.map((t) => t.clear())));
  await browser.storage.local.clear();
  await browser.storage.session.clear();
  await browser.scripting.unregisterContentScripts({ ids: ['docs-activity'] }).catch(() => {});
  const granted = await browser.permissions.getAll();
  // Install-time permissions cannot be removed; each optional one is returned separately.
  for (const origin of granted.origins ?? []) await browser.permissions.remove({ origins: [origin] }).catch(() => false);
  if (granted.permissions?.includes('tabs')) await browser.permissions.remove({ permissions: ['tabs'] }).catch(() => false);
  await browser.action.setBadgeText({ text: '' });
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
  if (!docId) return;
  const s = await currentSession(db);
  if (s?.state === 'active' && (await db.docLinks.get(s.assignmentId))?.docId === docId) {
    await typingItem.setValue({ docId, at: Date.now() });
    runSessionLoop();
    return;
  }
  // Typing in a Doc linked to another assignment, or with no active session: maybe suggest a session.
  const link = await db.docLinks.where('docId').equals(docId).first();
  if (link) await recordNudgeSignal('typing', link.assignmentId);
}

/** Feeds one typing or viewing signal to the nudge rules. Never starts or reads anything. */
async function recordNudgeSignal(kind: NudgeSignal['kind'], assignmentId: string) {
  if (!(await nudgesItem.getValue()).enabled) return;
  const a = await db.assignments.get(assignmentId);
  if (!a || !isOpen(a)) return;
  const s = await currentSession(db);
  const prev = await loadNudgeState();
  const next = nudgeAfter(prev, { kind, assignmentId, title: a.title, at: Date.now() }, s ? { assignmentId: s.assignmentId, state: s.state === 'active' ? 'active' : 'paused' } : null);
  if (await saveNudgeState(prev, next)) await badgeIfClosed(NUDGE_BADGE);
}

const NUDGE_BADGE = '•';

/** A quiet badge on the toolbar icon, only when the panel is closed and no other badge shows. */
async function badgeIfClosed(text: string) {
  if ((await browser.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length > 0) return;
  if (await browser.action.getBadgeText({})) return;
  await browser.action.setBadgeBackgroundColor({ color: '#fc4811' });
  await browser.action.setBadgeText({ text });
}

/** Clears the nudge for an assignment the session now covers, or that the student muted. */
async function settleNudge(change: (state: NudgeState) => NudgeState) {
  const prev = await loadNudgeState();
  await saveNudgeState(prev, change(prev));
  if ((await browser.action.getBadgeText({})) === NUDGE_BADGE) await browser.action.setBadgeText({ text: '' });
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
  paused: 'Loomer is paused. Resume it in settings to add pages',
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
    void browser.action.setTitle({ tabId: tab.id, title: 'Open Loomer' });
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
      await closeStaleSessions(db, new Date());
      await runRefresh();
      await readSheets().catch((error: unknown) => console.error('loomer: sheet read failed', error));
      // Analysis failures are stored per assignment; this only catches bugs.
      await analyze().catch((error: unknown) => console.error('loomer: analysis failed', error));
      await sheetTopics().catch((error: unknown) => console.error('loomer: sheet topics failed', error));
      await updatePlan().catch((error: unknown) => console.error('loomer: plan update failed', error));
      await runPrep().catch((error: unknown) => console.error('loomer: test prep failed', error));
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** AI requirement analysis for the decision set. Reads consent fresh on every check. */
/** The current school account's key, from the last Canvas check. */
async function currentSourceKey(): Promise<string | null> {
  return (await db.runs.orderBy('startedAt').last())?.sourceKey ?? null;
}

/** Reads teacher sheets embedded in instructions, so analysis sees them. */
async function readSheets() {
  const sourceKey = await currentSourceKey();
  if (!sourceKey) return;
  await readEmbeddedSheets(db, await loadGateState(), sourceKey, new Date(), { docsAccess: await browser.permissions.contains({ origins: DOCS_ORIGINS }) });
}

/** Topic lists for practice or study work with an embedded sheet, ready before a session starts. */
async function sheetTopics() {
  const sourceKey = await currentSourceKey();
  if (sourceKey) await embeddedTopicsStep({ db, ai: () => aiSettingsItem.getValue() }, sourceKey, new Date());
}

function analyze() {
  return analyzeRequirements({ db, ai: () => aiSettingsItem.getValue() });
}

const prepDeps = () => ({ db, ai: () => aiSettingsItem.getValue() });

/**
 * Test prep for tests due in the next two weeks: find each one's topics once,
 * and write today's practice ahead of time for tests in the next week, so
 * "Start practice" opens at once.
 */
async function runPrep() {
  const now = new Date();
  for (const a of await db.assignments.toArray()) {
    if (!(await prepEligible(db, a, now))) continue;
    await setupPrep(prepDeps(), a);
    const prep = await db.preps.get(a.id);
    const testAt = effectiveDue(a, now).at;
    if (prep?.status !== 'ready' || !testAt || Date.parse(testAt) - now.getTime() > 7 * 86_400_000) continue;
    const kind = await todayKind(db, prep, testAt, now);
    const written = (await db.practices.where('assignmentId').equals(a.id).toArray()).some((p) => p.day === localDay(now) && p.dayKind === kind);
    if (kind && !written) await writePractice(prepDeps(), a.id, kind);
  }
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
    const run = await collectCanvas({ db, origin: canvasOrigin, gate: await loadGateState() });
    if (run.deadlineChanges?.length) await notifyDeadlineChanges(run.deadlineChanges, notify);
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
        return { ok: false, error: "Chrome didn't allow this site." };
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
        return { ok: false, error: "Chrome didn't allow Loomer's AI service." };
      }
      await aiSettingsItem.setValue({ ...ai, enabled: message.enabled });
      if (message.enabled) {
        void analyze();
        await checkAiService();
      } else await aiServiceItem.setValue(null);
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
    case 'plan:apply': {
      const r = await applyChange(db, message.changeId, await planSettings(), new Date());
      if (r.ok) await updatePlan();
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    case 'room:minutes':
      await levelMinutesItem.setValue({ some: message.some, little: message.little });
      await updatePlan();
      return { ok: true };
    case 'plan:dismiss':
      return dismissChange(db, message.changeId);
    case 'plan:undo': {
      const r = await undoChange(db, message.changeId, new Date());
      if (r.ok) await updatePlan();
      return r;
    }
    case 'plan:set': {
      const now = new Date();
      const edits = message.changes.map((c) => editFromItem(c, now));
      const bad = edits.find((e) => typeof e === 'string');
      if (bad) return { ok: false, error: bad };
      const settings = await planSettings();
      const proposed = await proposeChange(db, edits.filter((e) => typeof e !== 'string'), null, settings, now);
      if (!proposed.ok) return proposed;
      const r = await applyChange(db, proposed.change.id, settings, now, false);
      if (r.ok) await updatePlan();
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    case 'presence:viewing':
      await recordNudgeSignal('viewing', message.assignmentId);
      return { ok: true };
    case 'nudge:dismiss':
      await settleNudge((n) => muted(n, message.assignmentId, Date.now()));
      return { ok: true };
    case 'nudge:set':
      await nudgesItem.setValue({ enabled: message.enabled });
      if (!message.enabled) await settleNudge((n) => ({ ...n, nudge: null }));
      return { ok: true };
    case 'topic:skip':
      await setTopicSkipped(db, message.assignmentId, message.topic, message.skipped);
      return { ok: true };
    case 'topic:help': {
      // Only a topic the reader found on this sheet; the request quotes the sheet so the reply stays on it.
      const topic = await findTopic(db, message.assignmentId, message.topic);
      if (!topic) return { ok: false, error: 'That topic is not on this sheet.' };
      if (isStreaming(message.assignmentId)) return { ok: false, error: 'Loomer is still answering.' };
      startChat(message.assignmentId, topicRequest(topic, message.mode), topic.text);
      // The reply lands in this assignment's chat, so Ask Loomer opens there and says why.
      await askThreadItem.setValue({ threadKey: message.assignmentId, at: new Date().toISOString(), reason: 'topic' });
      return { ok: true };
    }
    case 'quiz:answer':
      return (await recordTopicAnswer(db, message.quizId, message.questionIndex, message.correct, new Date())) ? { ok: true } : { ok: false, error: 'Not a quick check on a topic.' };
    case 'item:hide':
      await db.studentContext.put({ ...(await db.studentContext.get(message.assignmentId)), key: message.assignmentId, hidden: message.hidden });
      await updatePlan();
      return { ok: true };
    case 'session:start': {
      if ((await settingsItem.getValue()).paused) return { ok: false, error: 'Loomer is paused. Resume it in settings first.' };
      await startSession(db, message.assignmentId, new Date(), message.minutes);
      await settleNudge((n) => covered(n, message.assignmentId));
      // Starting work on something is a choice; Home keeps it until the evidence changes.
      await rememberChoice(message.assignmentId);
      await openDoc(message.assignmentId);
      runSessionLoop();
      return { ok: true };
    }
    case 'session:pause':
    case 'session:resume': {
      const s = await currentSession(db);
      if (!s) return { ok: false, error: 'No session.' };
      await setState(db, s, message.type === 'session:pause' ? 'paused' : 'active', new Date());
      if (message.type === 'session:resume') await settleNudge((n) => covered(n, s.assignmentId));
      if (message.type === 'session:resume') runSessionLoop();
      else stopSessionLoop();
      await runDiscovery();
      return { ok: true };
    }
    case 'session:time':
      return (await setPlannedTime(db, message.minutes, new Date())) ? { ok: true } : { ok: false, error: 'No session.' };
    case 'session:end':
      await endSession(db, new Date());
      stopSessionLoop();
      await runDiscovery();
      return { ok: true };
    case 'session:next-step':
      return (await nextStepStep({ db, ai: () => aiSettingsItem.getValue() }, new Date())) ? { ok: true } : { ok: false, error: "You don't have a session running right now." };
    case 'session:close':
      if (!(await closeSession(db, message.outcome, message.nextStep, new Date()))) return { ok: false, error: "You don't have a session running right now." };
      stopSessionLoop();
      await updatePlan();
      await runDiscovery();
      return { ok: true };
    case 'discovery:set': {
      if (message.enabled && !(await browser.permissions.contains({ permissions: ['tabs'] }))) {
        return { ok: false, error: "Chrome didn't allow tab access." };
      }
      await discoveryItem.setValue({ enabled: message.enabled });
      // Turning it off also gives the tabs permission back.
      if (!message.enabled) await browser.permissions.remove({ permissions: ['tabs'] }).catch(() => false);
      await runDiscovery();
      return { ok: true };
    }
    case 'suggestion:add': {
      const state = await discoveryStateItem.getValue();
      if (state?.suggestion?.tabId !== message.tabId) return { ok: false, error: "That page isn't open anymore." };
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
    case 'privacy:pause': {
      const settings = await settingsItem.getValue();
      await settingsItem.setValue({ ...settings, paused: message.paused });
      if (message.paused) {
        const s = await currentSession(db);
        if (s?.state === 'active') await setState(db, s, 'paused', new Date());
        stopSessionLoop();
        await discoveryStateItem.setValue(null);
        await browser.action.setBadgeText({ text: '' });
      } else {
        // Canvas checks resume; a work session never resumes without the student.
        void refresh();
      }
      return { ok: true };
    }
    case 'exclusion:add':
    case 'exclusion:remove': {
      const settings = await settingsItem.getValue();
      const exclusions =
        message.type === 'exclusion:add'
          ? await addExclusion(db, settings.exclusions, message.rule, message.deleteSaved)
          : removeExclusion(settings.exclusions, message.rule);
      // Removing a block restarts nothing and grants nothing.
      await settingsItem.setValue({ ...settings, exclusions });
      if (message.type === 'exclusion:add') await runDiscovery();
      return { ok: true };
    }
    case 'data:delete-assignment': {
      const s = await currentSession(db);
      if (s?.assignmentId === message.assignmentId) {
        await endSession(db, new Date());
        stopSessionLoop();
      }
      await deleteAssignmentData(db, message.assignmentId);
      return { ok: true };
    }
    case 'data:clear-all':
      await clearAll();
      return { ok: true };
    case 'requirements:check':
      await checkRequirements({ db, ai: () => aiSettingsItem.getValue() }, message.assignmentId);
      return { ok: true };
    case 'context:set': {
      const ctx = await db.studentContext.get(message.assignmentId);
      await db.studentContext.put({
        ...ctx,
        key: message.assignmentId,
        correction: message.correction ?? undefined,
        note: message.note ?? ctx?.note,
      });
      await updatePlan();
      return { ok: true };
    }
    case 'prep:start': {
      const error = await startPractice(prepDeps(), message.assignmentId);
      return error ? { ok: false, error } : { ok: true };
    }
    case 'prep:answer':
      await answerPractice(prepDeps(), message.practiceId, message.questionId, message);
      return { ok: true };
    case 'prep:like':
      await practiceLike(prepDeps(), message.practiceId, message.questionId);
      return { ok: true };
    case 'prep:next':
      await nextQuestion(db, message.practiceId, new Date());
      await updatePlan();
      return { ok: true };
    case 'prep:end':
      await endPractice(db, message.practiceId, new Date());
      await updatePlan();
      return { ok: true };
    case 'prep:close':
      await db.practices.update(message.practiceId, { closed: true });
      return { ok: true };
    case 'prep:topics-edit':
      await editTopics(db, message.assignmentId, message);
      return { ok: true };
    case 'prep:format-set':
      await setFormats(db, message.assignmentId, message.formats);
      return { ok: true };
    case 'prep:notes': {
      const images = message.attachments.flatMap((a) => (a.kind === 'image' ? [a.dataUrl] : []));
      if (images.length === 0) return { ok: false, error: 'Add photos of your notes, so Loomer can read them.' };
      const error = await addNotes(prepDeps(), message.assignmentId, images);
      return error ? { ok: false, error } : { ok: true };
    }
    case 'slip:answer':
      await answerSlip(db, message.assignmentId, message.missedOn, message.reason, new Date());
      return { ok: true };
    case 'choice:set':
      await rememberChoice(message.assignmentId);
      return { ok: true };
    case 'choice:clear':
      await choiceItem.setValue(null);
      return { ok: true };
    case 'older:reviewed': {
      const at = new Date().toISOString();
      for (const id of message.assignmentIds) {
        const [ctx, a] = await Promise.all([db.studentContext.get(id), db.assignments.get(id)]);
        await db.studentContext.put({ ...ctx, key: id, olderReview: { at, missing: a?.submission?.missing === true } });
      }
      return { ok: true };
    }
    case 'notify:set':
      if (message.enabled && !(await browser.permissions.contains({ permissions: ['notifications'] }))) {
        return { ok: false, error: "Chrome didn't allow notifications." };
      }
      await notifyItem.setValue({ enabled: message.enabled });
      if (!message.enabled) await browser.permissions.remove({ permissions: ['notifications'] }).catch(() => false);
      return { ok: true };
    case 'screenshot:save':
      return saveScreenshot(db, await loadGateState(), message.crop, new Date(), cropImage).then((r) => (r.ok ? { ok: true } : { ok: false, error: r.error ?? 'Not saved.' }));
    case 'chat:send': {
      if (isStreaming(message.threadKey)) return { ok: false, error: 'Loomer is still answering.' };
      // Asking for help in the session's chat counts as working on it.
      const s = await currentSession(db);
      if (s?.assignmentId === message.threadKey) await touch(db, s, new Date());
      startChat(message.threadKey, message.text, null, message.attachments ?? []);
      return { ok: true };
    }
    case 'chat:inbox-clear':
      await chatInboxItem.setValue(null);
      return { ok: true };
    case 'chat:stop':
      stopChat(message.threadKey);
      return { ok: true };
    case 'chat:open':
      await askThreadItem.setValue({ threadKey: message.threadKey, at: new Date().toISOString(), reason: 'student' });
      return { ok: true };
    case 'chat:set-aside': {
      if (isStreaming(message.threadKey)) return { ok: false, error: 'Stop the reply first.' };
      const id = crypto.randomUUID();
      await db.chatTurns.where('threadKey').equals(message.threadKey).filter((t) => !t.setAsideId).modify({ setAsideId: id });
      return { ok: true };
    }
    case 'chat:restore':
      await db.chatTurns.filter((t) => t.setAsideId === message.id).modify((t) => {
        delete t.setAsideId;
      });
      return { ok: true };
    case 'chat:clear':
      if (isStreaming(message.threadKey)) return { ok: false, error: 'Stop the reply first.' };
      await db.chatTurns.where('threadKey').equals(message.threadKey).delete();
      await db.chatFiles.where('threadKey').equals(message.threadKey).delete();
      return { ok: true };
    case 'ai:check':
      await checkAiService();
      return { ok: true };
    case 'brief:dismiss':
      await briefDismissedItem.setValue(localDay(new Date()));
      return { ok: true };
    case 'screenshot:cancel':
      // The raw capture is discarded; nothing was stored.
      await screenshotDraftItem.setValue(null);
      return { ok: true };
    case 'suggestion:dismiss': {
      const state = await discoveryStateItem.getValue();
      if (state) await discoveryStateItem.setValue({ ...state, dismissed: true, candidate: null, suggestion: null });
      await browser.action.setBadgeText({ text: '' });
      return { ok: true };
    }
    case 'doc:link':
      return linkDoc(message.assignmentId, message.docUrl);
    case 'assignment:add': {
      const run = await db.runs.orderBy('startedAt').last();
      if (!run?.sourceKey || !run.origin) return { ok: false, error: 'Connect Canvas first, so Loomer knows which school this belongs to.' };
      if (message.docUrl && !parseDocId(message.docUrl)) return { ok: false, error: "That isn't a Google Doc link." };
      const id = await addAssignment(db, { sourceKey: run.sourceKey, origin: run.origin }, message, message.draftId ?? null, new Date());
      const linked = message.docUrl ? await linkDoc(id, message.docUrl) : { ok: true as const };
      await updatePlan();
      void analyze();
      return linked.ok ? linked : { ok: false, error: "Loomer added this assignment but couldn't link the Doc, so try linking it again." };
    }
    case 'assignment:edit': {
      if (message.docUrl && !parseDocId(message.docUrl)) return { ok: false, error: "That isn't a Google Doc link." };
      if (!(await editAssignment(db, message.assignmentId, message, new Date()))) return { ok: false, error: 'Loomer can only change work you added yourself.' };
      const linked = await db.docLinks.get(message.assignmentId);
      if (!message.docUrl && linked) await db.docLinks.delete(message.assignmentId);
      if (message.docUrl && parseDocId(message.docUrl) !== linked?.docId) await linkDoc(message.assignmentId, message.docUrl);
      await updatePlan();
      void analyze();
      return { ok: true };
    }
    case 'assignment:delete': {
      const s = await currentSession(db);
      if (s?.assignmentId === message.assignmentId) {
        await endSession(db, new Date());
        stopSessionLoop();
      }
      if (!(await deleteAddedAssignment(db, message.assignmentId))) return { ok: false, error: 'Loomer can only delete work you added yourself.' };
      await updatePlan();
      return { ok: true };
    }
    case 'source:remove':
      await db.sources.delete(message.id);
      return { ok: true };
    case 'help:review': {
      const s = await currentSession(db);
      if (s?.assignmentId === message.assignmentId) await touch(db, s, new Date());
      if (isStreaming(message.assignmentId)) return { ok: false, error: 'Loomer is still answering.' };
      await requestReview({ db, ai: () => aiSettingsItem.getValue() }, message.assignmentId);
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
    browser.contextMenus.create({ id: SCREENSHOT_MENU, title: 'Capture screenshot for Loomer', contexts: ['page', 'image'] });
    browser.contextMenus.create({ id: CHAT_SHOT_MENU, title: 'Send screenshot to Ask Loomer', contexts: ['page', 'image'] });
    void registerTypingSignal().catch(() => {});
  });
  // Catch up after the browser was closed. A session never resumes on its own:
  // restored tabs must not restart Doc reads or capture without the student.
  browser.runtime.onStartup.addListener(() => {
    void schedule();
    void refresh();
    void checkAiService();
    void currentSession(db).then((s) => (s?.state === 'active' ? setState(db, s, 'paused', new Date()) : undefined));
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) {
      void refresh();
      void checkAiService();
    }
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
    if (info.menuItemId === SCREENSHOT_MENU && tab?.id) {
      // Open the panel first, inside the click's user gesture, so the preview is ready to show.
      void browser.sidePanel.open({ tabId: tab.id }).catch(() => {});
      void screenshotFromTab(tab);
    }
    if (info.menuItemId === CHAT_SHOT_MENU && tab?.id) {
      void browser.sidePanel.open({ tabId: tab.id }).catch(() => {});
      void chatShotFromTab(tab).catch((error: unknown) => console.error('loomer: chat screenshot failed', error));
    }
  });
  // A notification click brings Chrome forward; opening the panel needs a user gesture Chrome may not grant here.
  browser.notifications?.onClicked.addListener(async () => {
    const win = await browser.windows.getLastFocused();
    if (win.id !== undefined) await browser.windows.update(win.id, { focused: true });
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
