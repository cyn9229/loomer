// How the panel shows an interactive widget. Never insert model HTML into the
// panel itself: render an <iframe sandbox="allow-scripts"> whose src is
// widgetPageUrl(), then call sendWidgetHtml(frame, html, onHeight). The page is
// an extension sandbox page (unique origin, no extension APIs, no network).
export const WIDGET_PAGE = '/widget.html';

export function widgetPageUrl(): string {
  return browser.runtime.getURL(WIDGET_PAGE);
}

/** The frame grows to fit the demo, within these bounds. */
export const WIDGET_MIN_HEIGHT = 120;
export const WIDGET_MAX_HEIGHT = 600;

/**
 * Sends the HTML once the frame says it is ready, and passes on the content
 * height the frame reports, clamped to the bounds. The demo's own script could
 * send a false height; the clamp keeps that harmless. Returns a cleanup function.
 */
export function sendWidgetHtml(frame: HTMLIFrameElement, html: string, onHeight: (height: number) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null || !('type' in data)) return;
    if (data.type === 'loomer-widget-ready') frame.contentWindow?.postMessage({ type: 'loomer-widget', html }, '*');
    if (data.type === 'loomer-widget-height' && 'height' in data && typeof data.height === 'number' && Number.isFinite(data.height)) {
      onHeight(Math.min(WIDGET_MAX_HEIGHT, Math.max(WIDGET_MIN_HEIGHT, Math.ceil(data.height))));
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
