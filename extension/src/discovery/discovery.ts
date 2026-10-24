// Research discovery: during an active session only, look at the foreground
// tab's title and address, apply exclusions first, match locally, and after a
// dwell offer "Add this page". Only the current candidate is kept, in
// chrome.storage.session (memory only); no browsing history is stored.
import { storage } from 'wxt/utils/storage';
import { studentText } from '../adapters/docs/reader';
import { instructionText, type LoomerDb } from '../core/db';
import { checkCollect, type GateState } from '../core/gate';
import { canonicalLink, hostMatches } from '../core/url';
import { currentSession } from '../session/session';
import { assignmentTerms, matchTab } from './relevance';

/** Seconds on a matching tab before suggesting. */
export const DWELL_MS = 30_000;

type Candidate = { tabId: number; url: string; title: string; matched: string[]; since: number };

export type DiscoveryState = {
  sessionId: number;
  candidate: Candidate | null;
  suggestion: Omit<Candidate, 'since'> | null;
  /** The student dismissed a suggestion; none for the rest of this session. */
  dismissed: boolean;
} | null;

export const discoveryStateItem = storage.defineItem<DiscoveryState>('session:discovery', { fallback: null });

export type ForegroundTab = { id?: number; url?: string; title?: string } | undefined;

/**
 * Re-evaluates the foreground tab. Never reads page content. Returns the new
 * state, which the caller stores. Clears everything when discovery is off or no
 * session is active.
 */
export async function evaluateForeground(input: {
  db: LoomerDb;
  enabled: boolean;
  gate: GateState;
  /** Hosts never suggested: the school origin, Google Docs, the local replay. */
  ownHosts: string[];
  tab: ForegroundTab;
  prev: DiscoveryState;
  now: number;
}): Promise<DiscoveryState> {
  const { db, enabled, gate, ownHosts, tab, prev, now } = input;
  const s = await currentSession(db, new Date(now));
  if (!enabled || gate.paused || !s || s.state !== 'active') return null;
  const base: NonNullable<DiscoveryState> =
    prev && prev.sessionId === s.id ? prev : { sessionId: s.id, candidate: null, suggestion: null, dismissed: false };
  if (base.dismissed) return { ...base, candidate: null, suggestion: null };

  const none = { ...base, candidate: null, suggestion: null };
  if (!tab?.id || !tab.url || !tab.title) return none;

  // Exclusions run before any matching: excluded hosts and routes are never classified.
  let host: string;
  try {
    host = new URL(tab.url).hostname;
  } catch {
    return none;
  }
  if (ownHosts.some((h) => hostMatches(host, h))) return none;
  const trial: GateState = { ...gate, grants: [...gate.grants, { purpose: 'research-capture', origin: new URL(tab.url).origin, version: 0 }] };
  if (!checkCollect(trial, 'research-capture', tab.url).allowed) return none;

  const url = canonicalLink(tab.url) ?? tab.url;
  const saved = await db.sources.where('assignmentId').equals(s.assignmentId).toArray();
  if (saved.some((src) => src.url === url)) return none;

  const a = await db.assignments.get(s.assignmentId);
  if (!a) return none;
  // What the student is actually working on: the teacher's text and sheets, their own part of the linked
  // draft, and the titles of pages they already saved. Words in that text count when they repeat.
  const instructions = instructionText(a.detail);
  const link = await db.docLinks.get(a.id);
  const draft = link ? (await db.docReads.get(link.docId))?.current?.text : undefined;
  const savedTitles = saved.map((src) => src.title.split(/\s+[|–—-]\s+/)[0] ?? src.title).join('\n');
  const terms = assignmentTerms(
    a.title,
    [instructions, ...(a.detail?.rubric ?? []).map((r) => r.description), draft ? studentText(draft, instructions) : '', savedTitles].join('\n'),
  );
  const { suggest, matched } = matchTab(terms, tab.title, tab.url);
  if (!suggest) return none;

  const same = base.candidate?.tabId === tab.id && base.candidate.url === url;
  const candidate: Candidate = same ? base.candidate! : { tabId: tab.id, url, title: tab.title.slice(0, 200), matched, since: now };
  const ready = now - candidate.since >= DWELL_MS;
  return { ...base, candidate, suggestion: ready ? { tabId: candidate.tabId, url: candidate.url, title: candidate.title, matched: candidate.matched } : null };
}
