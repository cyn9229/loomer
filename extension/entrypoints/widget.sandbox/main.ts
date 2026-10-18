// Sandboxed widget page for AI-made interactive demos. Chrome gives sandboxed
// pages a unique origin with no extension APIs, no cookies, and no storage; the
// manifest's sandbox CSP also blocks all network access. It accepts one HTML
// document from its parent frame and replaces itself with it.
window.addEventListener(
  'message',
  (event) => {
    if (event.source !== window.parent) return;
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'loomer-widget' || !('html' in data) || typeof data.html !== 'string') return;
    document.open();
    document.write(data.html);
    document.close();
  },
  { once: true },
);
window.parent.postMessage({ type: 'loomer-widget-ready' }, '*');
