// Study trail state: what Loomer took from each picked site in a session, the
// session screen's view of it, the end card's lines, and the mark on prep
// topics studied elsewhere. Outside study steers what Loomer checks next; it
// never changes a topic's standing or progress. Dexie reads only in loaders.
import type { LoomerDb, PracticeRecord, PrepRecord, TopicCheckRecord, TrailNoteRecord, TrailSiteRecord } from '../core/db';
import { topicKey } from '../analysis/topicStanding';
import { activeTopics } from '../prep/plan';
import { hostOf, STUDY_SITES, type Elsewhere, type TrailView } from '../model/trail';
import { matchPage, messageHash, type TrailTargets } from './match';

/** A message seen this many times or more makes a topic "asked about": checked first. */
const ASKED_FIRST = 2;
const MAX_SEEN = 300;
/** Less than this on a site in a session is not worth a recap line. */
const RECAP_MIN_MS = 60_000;

/** The assignment's topics (prep topics, sheet topics) and key terms, for matching. Dexie reads only. */
export async function trailTargets(db: LoomerDb, assignmentId: string): Promise<TrailTargets> {
  const [prep, sheet] = await Promise.all([db.preps.get(assignmentId), db.sheetTopics.get(assignmentId)]);
  const topics = [...(prep ? activeTopics(prep).map((t) => t.text) : []), ...(sheet?.status === 'ok' ? sheet.topics.map((t) => t.text) : [])];
  const unique = [...new Map(topics.map((t) => [topicKey(t), t])).values()];
  return { topics: unique, terms: prep?.terms.map((t) => t.term) ?? [] };
}

/** The picked site a tab is on, if any. Matches the site and its subdomains. */
export function siteFor(sites: TrailSiteRecord[], url: string | undefined): TrailSiteRecord | undefined {
  if (!url) return undefined;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
  return sites.find((s) => host === hostOf(s.origin) || host.endsWith(`.${hostOf(s.origin)}`));
}

/** A known study site a tab is on, picked or not. */
export function knownSiteFor(url: string | undefined): { origin: string; name: string } | undefined {
  const known = STUDY_SITES.map((s) => ({ ...s, picked: false, paused: false, dismissed: false }));
  const s = siteFor(known, url);
  return s && { origin: s.origin, name: s.name };
}

/**
 * Adds one read of a picked site to this session's note: time on it, the
 * topics and key terms that came up, and each new message of the student's
 * that is about a topic. The page text itself is not kept.
 */
export async function recordRead(
  db: LoomerDb,
  read: { sessionId: number; assignmentId: string; site: Pick<TrailSiteRecord, 'origin' | 'name'>; text: string; asked: string[]; elapsedMs: number; now: Date },
): Promise<void> {
  const targets = await trailTargets(db, read.assignmentId);
  const match = matchPage(targets, read.text, read.asked);
  const id = `${read.sessionId}|${read.site.origin}`;
  await db.transaction('rw', db.trailNotes, async () => {
    const prev = await db.trailNotes.get(id);
    const note: TrailNoteRecord = prev ?? {
      id, sessionId: read.sessionId, assignmentId: read.assignmentId, origin: read.site.origin, name: read.site.name, ms: 0, lastAt: read.now.toISOString(), topics: [], terms: [], asked: {}, askedSeen: [],
    };
    const seen = new Set(note.askedSeen);
    const asked = { ...note.asked };
    read.asked.forEach((m, i) => {
      const h = messageHash(m);
      if (seen.has(h)) return;
      seen.add(h);
      for (const t of match.asked[i] ?? []) asked[t] = (asked[t] ?? 0) + 1;
    });
    await db.trailNotes.put({
      ...note,
      ms: note.ms + read.elapsedMs,
      lastAt: read.now.toISOString(),
      topics: [...new Set([...note.topics, ...match.topics])],
      terms: [...new Set([...note.terms, ...match.terms])],
      asked,
      askedSeen: [...seen].slice(-MAX_SEEN),
    });
  });
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const askedTop = (asked: Record<string, number>) => Object.entries(asked).sort((a, b) => b[1] - a[1]);

/** One sentence for the noticed list: what Loomer took from this site in this session. */
export function tookSentence(note: TrailNoteRecord, title: string): string {
  const asked = askedTop(note.asked).slice(0, 2);
  if (asked.length > 0) return `You asked about ${list(asked.map(([t, n]) => `${t} ${times(n)}`))}.`;
  if (note.terms.length >= 3) return `${note.terms.length} key terms from ${title} came up.`;
  if (note.topics.length > 0) return `${list(note.topics.slice(0, 2))} came up${note.topics.length > 2 ? `, plus ${note.topics.length - 2} more` : ''}.`;
  return `Nothing from ${title} came up yet.`;
}

/** The session screen's trail. Dexie reads only. */
export async function loadTrailView(db: LoomerDb, sessionId: number, title: string): Promise<TrailView> {
  const [sites, notes, front] = await Promise.all([db.trailSites.toArray(), db.trailNotes.where('sessionId').equals(sessionId).toArray(), db.trailFront.get('front')]);
  const byOrigin = new Map(sites.map((s) => [s.origin, s]));
  const here = front?.sessionId === sessionId ? front : undefined;
  const known = here?.origin ? STUDY_SITES.find((s) => s.origin === here.origin) : undefined;
  const record = here?.origin ? byOrigin.get(here.origin) : undefined;
  const picked = sites.filter((s) => s.picked);
  return {
    ask: known && !record?.picked && !record?.dismissed ? { origin: known.origin, name: known.name } : null,
    setup: Boolean(here?.blind) && picked.length === 0 && !sites.some((s) => s.dismissed),
    other: here?.origin && !known && here.matched && !record?.picked && !record?.dismissed ? { origin: here.origin, matched: here.matched } : null,
    picked: picked.map((s) => ({ origin: s.origin, name: s.name, paused: s.paused })),
    noticed: notes
      .filter((n) => n.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .map((n) => ({ origin: n.origin, name: n.name, minutes: Math.round(n.ms / 60_000), took: tookSentence(n, title), paused: byOrigin.get(n.origin)?.paused ?? false })),
  };
}

/**
 * The end card's lines: "You studied 25 minutes on ChatGPT and Quizlet,
 * mostly Hawaii and the Congo." and, for a test with prep, "Next time starts
 * with one quick check on both."
 */
export function trailRecap(notes: TrailNoteRecord[], hasPrep: boolean): { trail: string | null; trailNext: string | null } {
  const used = notes.filter((n) => n.ms >= RECAP_MIN_MS).sort((a, b) => b.ms - a.ms);
  if (used.length === 0) return { trail: null, trailNext: null };
  const minutes = Math.round(used.reduce((m, n) => m + n.ms, 0) / 60_000);
  const weight = new Map<string, number>();
  for (const n of used) {
    for (const t of n.topics) weight.set(t, (weight.get(t) ?? 0) + 1);
    for (const [t, c] of Object.entries(n.asked)) weight.set(t, (weight.get(t) ?? 0) + c);
  }
  const top = [...weight].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  const trail = `You studied ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} on ${list(used.map((n) => n.name))}${top.length ? `, mostly ${list(top)}` : ''}.`;
  const trailNext = hasPrep && top.length ? `Next time starts with one quick check on ${top.length === 1 ? 'it' : 'both'}.` : null;
  return { trail, trailNext };
}

/**
 * Prep topics studied outside Loomer since their last check, by topic id. A
 * topic asked about twice or more is checked first; one that only came up gets
 * one quick check. A Loomer check after the outside study clears the mark.
 */
export function elsewhereFor(prep: PrepRecord, notes: TrailNoteRecord[], checks: TopicCheckRecord[], practices: PracticeRecord[]): Map<string, Elsewhere> {
  const out = new Map<string, Elsewhere>();
  for (const t of activeTopics(prep)) {
    const key = topicKey(t.text);
    const about = notes.filter((n) => n.topics.some((x) => topicKey(x) === key) || Object.keys(n.asked).some((x) => topicKey(x) === key));
    if (about.length === 0) continue;
    const last = about.reduce((m, n) => (n.lastAt > m ? n.lastAt : m), '');
    const checkedSince =
      checks.some((c) => c.topic === key && c.at > last) ||
      practices.some((p) => (p.startedAt ?? '') > last && p.questions.some((q) => q.topicId === t.id && p.answers[q.id]));
    if (checkedSince) continue;
    const askedBy = about.map((n) => ({ name: n.name, count: Object.entries(n.asked).filter(([x]) => topicKey(x) === key).reduce((s, [, c]) => s + c, 0) }));
    const total = askedBy.reduce((s, a) => s + a.count, 0);
    if (total >= ASKED_FIRST) {
      const site = askedBy.sort((a, b) => b.count - a.count)[0]!.name;
      out.set(t.id, { kind: 'asked', text: `Asked ${site} ${total} times, so it's checked first` });
    } else {
      out.set(t.id, { kind: 'site', text: `Studied on ${about.sort((a, b) => b.ms - a.ms)[0]!.name} · next: one quick check` });
    }
  }
  return out;
}

/**
 * The student's whole picked list, after Chrome granted those sites. Sites left
 * out are unpicked (what Loomer took from them stays until removed). `granted`
 * checks each one, so a site Chrome refused is never marked picked.
 */
export async function setSites(db: LoomerDb, origins: string[], granted: (origin: string) => Promise<boolean>): Promise<void> {
  const want = new Set<string>();
  for (const o of origins) if (parseOrigin(o) && (await granted(o))) want.add(o);
  const existing = new Map((await db.trailSites.toArray()).map((s) => [s.origin, s]));
  const rows: TrailSiteRecord[] = [...new Set([...existing.keys(), ...want])].map((origin) => {
    const prev = existing.get(origin);
    const name = prev?.name ?? STUDY_SITES.find((s) => s.origin === origin)?.name ?? hostOf(origin);
    return { origin, name, picked: want.has(origin), paused: prev?.paused ?? false, dismissed: (prev?.dismissed ?? false) && !want.has(origin) };
  });
  await db.trailSites.bulkPut(rows);
}

/** "Not now" on the ask, or No on "Read this site too?": never ask about this site again. */
export async function dismissSite(db: LoomerDb, origin: string): Promise<void> {
  if (!parseOrigin(origin)) return;
  const prev = await db.trailSites.get(origin);
  const name = prev?.name ?? STUDY_SITES.find((s) => s.origin === origin)?.name ?? hostOf(origin);
  await db.trailSites.put({ origin, name, picked: prev?.picked ?? false, paused: prev?.paused ?? false, dismissed: true });
}

/** "Not now" on the setup row: don't ask about any of the listed study sites again. The picker stays under Change your study sites. */
export async function dismissSetup(db: LoomerDb): Promise<void> {
  const sites = new Map((await db.trailSites.toArray()).map((s) => [s.origin, s]));
  for (const s of STUDY_SITES) if (!sites.get(s.origin)?.picked) await dismissSite(db, s.origin);
}

export async function pauseSite(db: LoomerDb, origin: string, paused: boolean): Promise<void> {
  await db.trailSites.update(origin, { paused });
}

/** Removes everything Loomer took from one site for this assignment, in every session. */
export async function removeSite(db: LoomerDb, assignmentId: string, origin: string): Promise<void> {
  await db.trailNotes.where('assignmentId').equals(assignmentId).filter((n) => n.origin === origin).delete();
}

/** An https origin with no path, as the panel sends it. */
function parseOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.origin === origin;
  } catch {
    return false;
  }
}
