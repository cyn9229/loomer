// Service worker. Chrome may stop it at any time, so it keeps no state in memory
// that cannot be rebuilt from storage. Scheduling uses alarms, which survive restarts.
import { collectCanvas } from '../src/adapters/canvas/collect';
import { db } from '../src/core/db';
import { messageSchema, type Message, type Reply } from '../src/core/messages';
import { loadGateState, settingsItem } from '../src/core/settings';
import { parseSourceUrl } from '../src/core/url';

const REFRESH_ALARM = 'canvas-refresh';
const REFRESH_MINUTES = 15;

let running: Promise<void> | null = null;

/** One collection at a time; concurrent triggers share the running one. */
function refresh(): Promise<void> {
  running ??= runRefresh().finally(() => {
    running = null;
  });
  return running;
}

async function runRefresh() {
  const { canvasOrigin } = await settingsItem.getValue();
  if (!canvasOrigin) return;
  // Chrome's grant is the technical maximum; the student can revoke it outside Loomer.
  if (!(await browser.permissions.contains({ origins: [`${canvasOrigin}/*`] }))) {
    const at = new Date().toISOString();
    await db.runs.add({
      sourceKey: null,
      origin: canvasOrigin,
      startedAt: at,
      finishedAt: at,
      outcome: 'no-permission',
      coverage: { courses: 0, plannerItems: 0, plannerTruncated: false, undatedCoursesChecked: 0, detailsFetched: 0, detailFailures: 0 },
      error: null,
    });
    return;
  }
  await collectCanvas({ db, origin: canvasOrigin, gate: await loadGateState() });
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
