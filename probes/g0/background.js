// Service worker. All network probes run here so they test the real background transport.
import { readDoc, runCanvas, runDocs } from './probes.js';

const BG_ALARM = 'g0-background-run';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Capture path without the tabs permission: a context-menu click grants activeTab for that tab.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'g0-capture', title: 'Loomer probe: read this page', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'g0-capture' || !tab?.id) return;
  let row;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ titleChars: document.title.length, textChars: document.body?.innerText.length ?? 0 }),
    });
    row = { name: 'capture.contextMenu', result: 'PASS', evidence: result };
  } catch (error) {
    row = { name: 'capture.contextMenu', result: 'FAIL', evidence: { error: String(error) } };
  }
  await chrome.storage.local.set({ ctxResult: { at: new Date().toISOString(), ...row } });
});

async function handle(msg) {
  switch (msg.type) {
    case 'canvas':
      return runCanvas(msg.origin);
    case 'docs':
      return runDocs(msg.docId, msg.authuser);
    case 'docs-hash': {
      const r = await readDoc(msg.docId, msg.authuser, 'txt');
      return { ok: r.ok, evidence: r.evidence };
    }
    case 'schedule-background':
      await chrome.storage.local.set({ bgConfig: msg.config, bgResult: null });
      await chrome.alarms.create(BG_ALARM, { delayInMinutes: 1 });
      return { scheduledFor: new Date(Date.now() + 60_000).toISOString() };
    default:
      throw new Error(`unknown message ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only this extension's own pages may drive probes.
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  handle(msg).then(
    (data) => sendResponse({ data }),
    (error) => sendResponse({ error: String(error) }),
  );
  return true;
});

// Runs with the panel closed, to prove collection does not depend on an open extension page.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== BG_ALARM) return;
  const { bgConfig } = await chrome.storage.local.get('bgConfig');
  const results = [];
  if (bgConfig?.origin) results.push(...(await runCanvas(bgConfig.origin).catch((e) => [{ name: 'canvas', result: 'FAIL', evidence: { error: String(e) } }])));
  if (bgConfig?.docId) results.push(...(await runDocs(bgConfig.docId, bgConfig.authuser).catch((e) => [{ name: 'docs', result: 'FAIL', evidence: { error: String(e) } }])));
  const panelOpen = (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length > 0;
  await chrome.storage.local.set({
    bgResult: {
      ranAt: new Date().toISOString(),
      panelOpenAtRun: panelOpen,
      results: results.map(({ localPreview, ...row }) => row),
    },
  });
});
