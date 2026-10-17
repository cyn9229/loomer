// Typing signal for the linked Google Doc. Registered at runtime only after the
// student grants Docs access. It reports THAT a key was pressed, at most every
// 2 s, and never which key or any document text. Docs routes keystrokes through
// a hidden same-origin frame, so it runs in all frames, including about:blank.
export default defineContentScript({
  matches: ['https://docs.google.com/*'],
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  registration: 'runtime',
  main() {
    const docPath = /^\/document\/(?:u\/\d+\/)?d\/[\w-]{20,}/;
    let path = location.pathname;
    try {
      path = window.top?.location.pathname ?? path;
    } catch {
      return; // Cross-origin frame: not part of the editor.
    }
    if (!docPath.test(path)) return;

    let last = 0;
    const ping = () => {
      const now = Date.now();
      if (now - last < 2_000) return;
      last = now;
      browser.runtime.sendMessage({ type: 'docs:activity' }).catch(() => {});
    };
    for (const type of ['keydown', 'beforeinput', 'paste', 'cut'] as const) {
      window.addEventListener(type, ping, { capture: true, passive: true });
    }
  },
});
