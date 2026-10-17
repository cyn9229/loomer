// Google Docs reader: the plain-text export of one linked Doc, with the
// student's own Google session. G0 showed Google returns 429 after about ten
// quick reads, so reads are paced and back off, and that state is persisted.
import type { DocRead, LoomerDb } from '../../core/db';
import { checkCollect, type GateState } from '../../core/gate';
import { contentHash } from '../../core/hash';

export const DOC_MIN_INTERVAL_MS = 15_000;
const BACKOFF_START_MS = 30_000;
const BACKOFF_MAX_MS = 120_000;
const FAILURE_RETRY_MS = 60_000;
const MAX_DOC_CHARS = 100_000;

export function parseDocId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'docs.google.com') return null;
    return u.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export type DocFetch =
  | { kind: 'ok'; text: string }
  | { kind: 'rate-limited' }
  | { kind: 'no-access' }
  | { kind: 'unreadable'; detail: string };

/** One gated export read. Only Google's export host is accepted as a redirect target. */
export async function fetchDocText(gate: GateState, docId: string, fetchImpl: typeof fetch = fetch): Promise<DocFetch> {
  const decision = checkCollect(gate, 'work-doc', `https://docs.google.com/document/d/${docId}/export?format=txt`);
  if (!decision.allowed) return { kind: 'unreadable', detail: `denied: ${decision.reason}` };
  let res: Response;
  try {
    res = await fetchImpl(decision.url, { credentials: 'include', redirect: 'follow' });
  } catch (error) {
    return { kind: 'unreadable', detail: error instanceof Error ? error.message : 'network' };
  }
  const final = new URL(res.url || decision.url.toString());
  if (final.hostname === 'accounts.google.com') return { kind: 'no-access' };
  if (final.hostname !== 'docs.google.com' && !final.hostname.endsWith('-docstext.googleusercontent.com')) {
    return { kind: 'unreadable', detail: `unexpected host ${final.hostname}` };
  }
  if (res.status === 429) return { kind: 'rate-limited' };
  if (res.status === 401 || res.status === 403 || res.status === 404) return { kind: 'no-access' };
  if (!res.ok) return { kind: 'unreadable', detail: `status ${res.status}` };
  // A login or permission page arrives as HTML with status 200.
  if (!(res.headers.get('content-type') ?? '').startsWith('text/plain')) return { kind: 'no-access' };
  return { kind: 'ok', text: (await res.text()).slice(0, MAX_DOC_CHARS) };
}

export type PacedRead = { read: DocRead; changed: boolean };

/**
 * Reads the Doc if pacing allows, updates its persisted read state, and reports
 * whether the text changed. Returns null when it is too early to read again.
 * A failed read never counts as "changed" or "unchanged".
 */
export async function readDocPaced(db: LoomerDb, gate: GateState, docId: string, now: Date, fetchImpl?: typeof fetch): Promise<PacedRead | null> {
  const prior: DocRead = (await db.docReads.get(docId)) ?? {
    docId,
    readState: 'waiting',
    lastAttemptAt: null,
    nextReadAt: new Date(0).toISOString(),
    backoffMs: 0,
    current: null,
    previous: null,
  };
  if (now.getTime() < Date.parse(prior.nextReadAt)) return null;

  const result = await fetchDocText(gate, docId, fetchImpl);
  const at = now.toISOString();
  const later = (ms: number) => new Date(now.getTime() + ms).toISOString();
  let read: DocRead;
  let changed = false;

  switch (result.kind) {
    case 'ok': {
      const hash = await contentHash(result.text);
      changed = prior.current !== null && prior.current.hash !== hash;
      read = {
        ...prior,
        readState: 'ok',
        lastAttemptAt: at,
        nextReadAt: later(DOC_MIN_INTERVAL_MS),
        backoffMs: 0,
        previous: changed ? prior.current : prior.previous,
        current: { observedAt: at, hash, text: result.text },
      };
      break;
    }
    case 'rate-limited': {
      const backoffMs = Math.min(Math.max(BACKOFF_START_MS, prior.backoffMs * 2), BACKOFF_MAX_MS);
      read = { ...prior, readState: 'rate-limited', lastAttemptAt: at, nextReadAt: later(backoffMs), backoffMs };
      break;
    }
    case 'no-access':
    case 'unreadable':
      read = { ...prior, readState: result.kind, lastAttemptAt: at, nextReadAt: later(FAILURE_RETRY_MS) };
      break;
  }
  await db.docReads.put(read);
  return { read, changed };
}

/**
 * The student's part of a Doc: drops lines that also appear in the assignment
 * instructions (teacher prompts, headings, templates). A heuristic; callers
 * must treat the result as partial scope.
 */
export function studentText(docText: string, instructions: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const teacher = norm(instructions);
  return docText
    .split(/\r?\n/)
    .filter((line) => {
      const n = norm(line);
      return n.length > 0 && !(n.length >= 12 && teacher.includes(n));
    })
    .join('\n');
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
