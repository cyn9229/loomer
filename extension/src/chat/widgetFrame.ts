// How the panel shows an interactive widget. Never insert model HTML into the
// panel itself: render an <iframe sandbox="allow-scripts"> whose src is
// widgetPageUrl(), then call sendWidgetHtml(frame, html). The page is an
// extension sandbox page (unique origin, no extension APIs, no network).
export const WIDGET_PAGE = '/widget.html';

export function widgetPageUrl(): string {
  return browser.runtime.getURL(WIDGET_PAGE);
}

/** Sends the HTML once the frame says it is ready. Returns a cleanup function. */
export function sendWidgetHtml(frame: HTMLIFrameElement, html: string): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data: unknown = event.data;
    if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'loomer-widget-ready') {
      frame.contentWindow?.postMessage({ type: 'loomer-widget', html }, '*');
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
