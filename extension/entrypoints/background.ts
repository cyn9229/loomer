// Service worker. Chrome may stop it at any time, so it keeps no state in memory
// that cannot be rebuilt from storage. Scheduling uses alarms, which survive restarts.
import { collectCanvas } from '../src/adapters/canvas/collect';
import { analyzeRequirements } from '../src/analysis/analyze';
import { db } from '../src/core/db';
import { messageSchema, type Message, type Reply } from '../src/core/messages';
import { aiSettingsItem, loadGateState, settingsItem } from '../src/core/settings';
import { parseSourceUrl } from '../src/core/url';

const REFRESH_ALARM = 'canvas-refresh';
const REFRESH_MINUTES = 15;

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
    case 'session:start':
    case 'session:pause':
    case 'session:resume':
    case 'session:end':
    case 'doc:link':
    case 'source:remove':
    case 'help:ask':
    case 'help:review':
    case 'hint:dismiss':
      return { ok: false, error: 'Not built yet (M3 in progress).' };
  }
}

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  const schedule = () => browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  browser.runtime.onInstalled.addListener(() => {
    void schedule();
    void refresh();
  });
  // Catch up after the browser was closed.
  browser.runtime.onStartup.addListener(() => {
    void schedule();
    void refresh();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) void refresh();
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
