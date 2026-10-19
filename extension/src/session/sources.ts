// What saved sources mean for the work, by local word matching only (no AI,
// nothing leaves the computer): how many sources the teacher asks for, and
// whether the student's draft mentions each saved source.
import { studentText } from '../adapters/docs/reader';
import { instructionText, type Assignment, type LoomerDb, type Source } from '../core/db';
import { stem, tokens } from '../discovery/relevance';
import type { SourceItem, SourceNeed } from '../model/session';

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNT = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';
/** A count of sources, with a verb ("use", "cite") or a qualifier ("at least") so "compare how two sources" is not a requirement. */
const NEED = new RegExp(
  `\\b(?:(?:use|cite|include|incorporate|find)\\s+(?:(?:at least|a minimum of|minimum of|no fewer than)\\s+)?|(?:at least|a minimum of|minimum of|no fewer than)\\s+)${COUNT}\\s+(?:[a-z-]+\\s+){0,2}?(?:sources|references|articles|websites|studies)\\b`,
  'gi',
);

/** "Use at least 3 sources" in the instructions, rubric, or sheets: the highest such number and the words that say it. */
export function sourcesNeeded(text: string): { required: number; quote: string } | null {
  let best: { required: number; quote: string } | null = null;
  for (const m of text.matchAll(NEED)) {
    const n = Number(m[1]) || NUMBER_WORDS[m[1]!.toLowerCase()];
    if (n && n <= 20 && (!best || n > best.required)) best = { required: n, quote: m[0] };
  }
  return best;
}

/** Hosting words that never name a source. */
const HOST_NOISE = new Set(['www', 'en', 'm', 'com', 'org', 'gov', 'edu', 'net', 'co', 'uk', 'us', 'io', 'html', 'docs', 'google']);

/** The site's own name from its address: "epa" for www.epa.gov, "wikipedia" for en.wikipedia.org. */
export function siteName(url: string): string | null {
  try {
    const labels = new URL(url).hostname.toLowerCase().split('.').filter((l) => !HOST_NOISE.has(l));
    return labels.sort((a, b) => b.length - a.length)[0] ?? null;
  } catch {
    return null;
  }
}

/** The page title without a trailing site name ("Heat islands | US EPA" gives "Heat islands"). */
const ownTitle = (title: string) => title.split(/\s+[|–—-]\s+/)[0] ?? title;

/**
 * Whether the draft mentions a saved source: its site's name, or two words from
 * its title that are not already assignment words (a heat-island essay always
 * says "heat", so that proves nothing). The matched words are shown, so the
 * student can judge.
 */
export function sourceInDraft(source: { title: string; url: string }, draft: string, assignmentText: string): { used: boolean; matched: string[] } {
  const lower = draft.toLowerCase();
  const site = siteName(source.url);
  const siteHit = site && site.length >= 3 && new RegExp(`\\b${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower) ? [site] : [];
  const common = new Set(tokens(assignmentText).map(stem));
  const drafted = new Set(tokens(draft).map(stem));
  const titleHits = [...new Set(tokens(ownTitle(source.title)).map(stem))].filter((w) => !common.has(w) && drafted.has(w));
  return { used: siteHit.length > 0 || titleHits.length >= 2, matched: [...siteHit, ...titleHits].slice(0, 4) };
}

/** The teacher's text that defines the work: instructions, sheets, and rubric. */
const teacherText = (a: Assignment) => [instructionText(a.detail), ...(a.detail?.rubric ?? []).map((r) => r.description)].join('\n');

/** Saved sources, newest first, each with whether the draft mentions it, plus the teacher's source count. Dexie reads only. */
export async function sourceView(db: LoomerDb, a: Assignment, sources: Source[]): Promise<{ items: SourceItem[]; need: SourceNeed }> {
  const teacher = teacherText(a);
  const link = await db.docLinks.get(a.id);
  const read = link ? (await db.docReads.get(link.docId))?.current : undefined;
  const draft = read ? studentText(read.text, instructionText(a.detail)) : null;
  const items = [...sources]
    .sort((x, y) => y.capturedAt.localeCompare(x.capturedAt))
    .map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      capturedAt: s.capturedAt,
      excerptChars: s.excerpt.length,
      kind: s.kind ?? 'page',
      image: s.image ?? null,
      inDraft: draft ? sourceInDraft(s, draft, `${a.title}\n${teacher}`) : null,
    }));
  const asked = sourcesNeeded(teacher);
  return { items, need: asked ? { required: asked.required, saved: sources.length, quote: asked.quote } : null };
}
