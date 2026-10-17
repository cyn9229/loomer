// Manual research capture. A right-click or keyboard shortcut grants Chrome's
// activeTab for that one tab; Loomer then saves one bounded snapshot of the page
// for the active assignment. It never captures again unless asked again.
import type { LoomerDb } from '../core/db';
import { checkCollect, type GateState } from '../core/gate';
import { contentHash } from '../core/hash';
import { canonicalLink } from '../core/url';
import { currentSession, touch } from '../session/session';

const MAX_EXCERPT_CHARS = 20_000;

export type CaptureOutcome =
  | { ok: true; title: string }
  | { ok: false; reason: 'no-session' | 'excluded' | 'sign-in-page' | 'unreadable' | 'duplicate' };

/** What the injected function returns. Runs in the page; must be self-contained. */
type PageSnapshot = { href: string; title: string; hasPassword: boolean; text: string };

function snapshotPage(maxChars: number): PageSnapshot {
  const root = (document.querySelector('article') ?? document.querySelector('main') ?? document.body).cloneNode(true) as HTMLElement;
  root.querySelectorAll('nav, header, footer, aside, script, style, noscript, form, iframe, [aria-hidden="true"]').forEach((el) => el.remove());
  return {
    href: location.href,
    title: document.title,
    hasPassword: document.querySelector('input[type="password"]') !== null,
    text: (root.innerText ?? root.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars),
  };
}

/**
 * Captures the given tab for the active session. The gate runs on the tab URL
 * before reading and again on the page's own URL after, in case it navigated.
 */
export async function capturePage(
  db: LoomerDb,
  gate: GateState,
  tab: { id?: number; url?: string },
  now: Date,
  execute: (tabId: number, fn: typeof snapshotPage, maxChars: number) => Promise<PageSnapshot | undefined>,
): Promise<CaptureOutcome> {
  const session = await currentSession(db);
  if (!session || session.state !== 'active') return { ok: false, reason: 'no-session' };
  if (!tab.id || !tab.url) return { ok: false, reason: 'unreadable' };

  // The click itself is the one-shot grant for this tab's origin.
  const withGrant = (url: string): GateState => {
    const origin = new URL(url).origin;
    return { ...gate, grants: [...gate.grants, { purpose: 'research-capture', origin, version: 0 }] };
  };
  const allowed = (url: string) => {
    try {
      return checkCollect(withGrant(url), 'research-capture', url).allowed;
    } catch {
      return false;
    }
  };
  if (!allowed(tab.url)) return { ok: false, reason: 'excluded' };

  let page: PageSnapshot | undefined;
  try {
    page = await execute(tab.id, snapshotPage, MAX_EXCERPT_CHARS);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!page) return { ok: false, reason: 'unreadable' };
  if (!allowed(page.href)) return { ok: false, reason: 'excluded' };
  if (page.hasPassword) return { ok: false, reason: 'sign-in-page' };
  if (page.text.length === 0) return { ok: false, reason: 'unreadable' };

  const url = canonicalLink(page.href) ?? page.href;
  const hash = await contentHash(page.text);
  const existing = await db.sources.where('assignmentId').equals(session.assignmentId).toArray();
  if (existing.some((s) => s.hash === hash)) return { ok: false, reason: 'duplicate' };

  const title = (page.title || new URL(url).hostname).slice(0, 300);
  const at = now.toISOString();
  await db.sources.add({ id: crypto.randomUUID(), assignmentId: session.assignmentId, sessionId: session.id, url, title, capturedAt: at, excerpt: page.text, hash });
  await db.sessionEvents.add({ sessionId: session.id, assignmentId: session.assignmentId, at, kind: 'source-added', title });
  await touch(db, session, now);
  return { ok: true, title };
}
