// Sandboxed widget page for AI-made interactive demos. Chrome gives sandboxed
// pages a unique origin with no extension APIs, no cookies, and no storage; the
// manifest's sandbox CSP also blocks all network access. It accepts one HTML
// document from its parent frame, replaces itself with it, and then reports the
// content's height so the panel can size the frame to fit (the panel caps it).
window.addEventListener(
  'message',
  (event) => {
    if (event.source !== window.parent) return;
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'loomer-widget' || !('html' in data) || typeof data.html !== 'string') return;
    document.open();
    document.write(data.html);
    document.close();
    // This script's realm outlives document.write, so it can keep watching the new document.
    let last = 0;
    // The content's own height, not scrollHeight (which never drops below the frame), so the frame can shrink too.
    const report = () => {
      const body = document.body;
      const bottom = body ? body.getBoundingClientRect().bottom + parseFloat(getComputedStyle(body).marginBottom) : 0;
      const height = Math.ceil(Math.max(document.documentElement.getBoundingClientRect().height, bottom));
      if (height === last) return;
      last = height;
      window.parent.postMessage({ type: 'loomer-widget-height', height }, '*');
    };
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    report();
  },
  { once: true },
);
window.parent.postMessage({ type: 'loomer-widget-ready' }, '*');
