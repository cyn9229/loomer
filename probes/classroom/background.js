// Service worker. All network probes run here so they test the real background transport.
import { runClassroom } from './probes.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only this extension's own pages may drive probes.
  if (sender.id !== chrome.runtime.id || sender.tab || msg?.type !== 'classroom') return false;
  runClassroom(msg.options).then(
    (data) => sendResponse({ data }),
    (error) => sendResponse({ error: String(error) }),
  );
  return true;
});
