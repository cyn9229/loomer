// Matches a study page's visible text against what Loomer knows about the
// assignment. Runs on this computer only; the text is dropped after matching.
// Conservative: a page counts only when at least two of the assignment's
// topics or key terms come up, so one shared word ("Hawaii") on an unrelated
// page doesn't count.
import { stem, tokens } from '../discovery/relevance';

/** What a page is matched against: the assignment's topic texts and key terms. */
export type TrailTargets = { topics: string[]; terms: string[] };

export type PageMatch = {
  topics: string[];
  terms: string[];
  /** For each of the student's own messages (ChatGPT): the topics it is about. Same order as the messages. */
  asked: string[][];
};

const MIN_HITS = 2;

const words = (text: string) => new Set(tokens(text).map(stem));
const flat = (text: string) => ` ${text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Same word, or one is the start of the other when both are long enough ("annex", "annexation"). */
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));
const has = (page: Set<string>, w: string) => page.has(w) || [...page].some((p) => sameWord(p, w));

/**
 * A topic's distinctive words. On a page, short topics need all of them and
 * longer ones any two. In one of the student's own messages, on a page that
 * already matched the assignment, one is enough ("Why did the US annex Hawaii?").
 */
function topicHit(topic: string, page: Set<string>, need = 2): boolean {
  const kw = [...words(topic)];
  if (kw.length === 0) return false;
  return kw.filter((w) => has(page, w)).length >= Math.min(kw.length, need);
}

/** A key term counts as a whole phrase ("Monroe Doctrine"), ignoring case and punctuation. */
const termHit = (term: string, page: string) => flat(term).trim().length >= 3 && page.includes(flat(term));

export function matchPage(targets: TrailTargets, text: string, asked: string[]): PageMatch {
  const page = words(text);
  const pageFlat = flat(text);
  const topics = targets.topics.filter((t) => topicHit(t, page));
  const terms = targets.terms.filter((t) => termHit(t, pageFlat));
  if (topics.length + terms.length < MIN_HITS) return { topics: [], terms: [], asked: asked.map(() => []) };
  return { topics, terms, asked: asked.map((m) => targets.topics.filter((t) => topicHit(t, words(m), 1))) };
}

/** The first topic or key term a page title names, for "Read this site too?". */
export function titleMatch(targets: TrailTargets, title: string): string | null {
  const page = words(title);
  return targets.topics.find((t) => topicHit(t, page)) ?? targets.terms.find((t) => termHit(t, flat(title))) ?? null;
}

/** A short, stable hash of a message, so a message re-read on the next pass isn't counted twice. */
export function messageHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
