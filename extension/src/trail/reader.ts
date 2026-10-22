// One study trail step for the active session: note which site is in front,
// and read a picked site's visible text (at most every 15 seconds) to match it.
// Runs only while a session is active, only on sites the student picked and
// Chrome granted, and only while the window is in front. Text never leaves
// this function: recordRead keeps the matches and drops it.
import type { LoomerDb, TrailFrontRecord } from '../core/db';
import { checkCollect, type GateState } from '../core/gate';
import { hostMatches } from '../core/url';
import { currentSession } from '../session/session';
import { isQuiz } from '../analysis/workType';
import { titleMatch } from './match';
import { knownSiteFor, recordRead, siteFor, trailTargets } from './trail';

const READ_EVERY_MS = 15_000;
/** Time between reads counts as study, up to this; a longer gap (Chrome slept, the student left) counts as one read. */
const MAX_GAP_MS = 30_000;
const MAX_TEXT = 60_000;

export type PageText = { text: string; asked: string[] };

/** Runs in the page. Self-contained (Chrome serializes it): the visible text, and the student's own ChatGPT messages. */
export function readStudyPage(): PageText {
  const asked = Array.from(document.querySelectorAll('[data-message-author-role="user"]'))
    .map((e) => (e as HTMLElement).innerText.trim().slice(0, 2_000))
    .filter(Boolean)
    .slice(-40);
  return { text: (document.body?.innerText ?? '').slice(0, 60_000), asked };
}

export type TrailStepDeps = {
  db: LoomerDb;
  gate: GateState;
  /** Hosts never read: Google Docs, the school, the AI service. */
  ownHosts: string[];
  tab: { id?: number; url?: string; title?: string } | undefined;
  /** The window is in front, so time on the tab counts. */
  focused: boolean;
  granted: (origin: string) => Promise<boolean>;
  read: (tabId: number) => Promise<PageText | null>;
  /** Last read per origin, kept by the caller between steps. */
  lastRead: Map<string, number>;
  now: Date;
};

export async function trailStep({ db, gate, ownHosts, tab, focused, granted, read, lastRead, now }: TrailStepDeps): Promise<void> {
  const s = await currentSession(db, now);
  if (!s || s.state !== 'active') {
    if (await db.trailFront.get('front')) await db.trailFront.delete('front');
    lastRead.clear();
    return;
  }
  // Never during a quiz: Loomer stays out of graded work.
  const a = await db.assignments.get(s.assignmentId);
  if (!a || isQuiz(a)) return;
  const sites = await db.trailSites.toArray();
  const url = tab?.url;
  let host: string | null = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  // The student's exclusions, the global pause, and Loomer's own hosts come first: those tabs are never classified.
  const allowed =
    host !== null &&
    !ownHosts.some((h) => hostMatches(host!, h)) &&
    checkCollect({ ...gate, grants: [...gate.grants, { purpose: 'research-capture', origin: new URL(url!).origin, version: 0 }] }, 'research-capture', url!).allowed;
  const site = allowed ? siteFor(sites, url) : undefined;
  const known = allowed ? knownSiteFor(url) : undefined;
  const origin = site?.origin ?? known?.origin ?? (allowed && host ? `https://${host.replace(/^www\./, '')}` : null);
  const matched = allowed && !site?.picked && !known && tab?.title ? titleMatch(await trailTargets(db, s.assignmentId), tab.title) : null;
  const front: TrailFrontRecord = { key: 'front', sessionId: s.id, origin, blind: !url, matched };
  if (JSON.stringify(await db.trailFront.get('front')) !== JSON.stringify(front)) await db.trailFront.put(front);

  if (!site?.picked || site.paused || !focused || tab?.id === undefined || !(await granted(site.origin))) return;
  const t = now.getTime();
  const prev = lastRead.get(site.origin);
  if (prev !== undefined && t - prev < READ_EVERY_MS) return;
  const page = await read(tab.id).catch(() => null);
  if (!page) return;
  lastRead.set(site.origin, t);
  const elapsedMs = prev === undefined || t - prev > MAX_GAP_MS ? READ_EVERY_MS : t - prev;
  await recordRead(db, { sessionId: s.id, assignmentId: s.assignmentId, site, text: page.text.slice(0, MAX_TEXT), asked: page.asked, elapsedMs, now });
}
