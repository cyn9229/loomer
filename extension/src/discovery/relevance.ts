// Local, conservative matching between a tab's title/address and an assignment.
// No page content, no AI, no network. A match only makes a quiet suggestion
// possible; it never establishes that the page is relevant.

const STOPWORDS = new Set(
  `about above after again against also among another because been before being below between both cannot could does doing down during each
  essay every from further have having here into itself just more most must other over same should some such than that their them then there
  these they this those through under until using very want were what when where which while will with within without would your yours write
  words word page pages source sources assignment assignments student students class course points point include including explain describe
  answer answers question questions read reading make made each draft final paragraph paragraphs least format cite citation citations`
    .split(/\s+/)
    .filter(Boolean),
);

export const tokens = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

/** Crude plural folding so "islands" matches "island". */
export const stem = (w: string) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

export type AssignmentTerms = { words: Set<string>; phrases: Set<string> };

/** Distinctive words and two-word phrases from the assignment's title and instructions. */
export function assignmentTerms(title: string, instructions: string): AssignmentTerms {
  const titleWords = tokens(title).map(stem);
  const body = tokens(instructions).map(stem);
  const counts = new Map<string, number>();
  for (const w of body) counts.set(w, (counts.get(w) ?? 0) + 1);
  // Title words always count; instruction words only when repeated, to stay conservative.
  const words = new Set([...titleWords, ...[...counts].filter(([, n]) => n >= 2).map(([w]) => w)]);
  const phrases = new Set<string>();
  for (const seq of [titleWords, body]) {
    for (let i = 0; i + 1 < seq.length; i++) phrases.add(`${seq[i]} ${seq[i + 1]}`);
  }
  return { words, phrases };
}

/**
 * Assignment terms found in a tab's title and address path. Suggest only with
 * at least two distinct words, or one two-word phrase.
 */
export function matchTab(terms: AssignmentTerms, title: string, url: string): { suggest: boolean; matched: string[] } {
  let path = '';
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return { suggest: false, matched: [] };
  }
  const seq = tokens(`${title} ${path.replace(/[/_.]/g, ' ')}`).map(stem);
  const matchedWords = [...new Set(seq.filter((w) => terms.words.has(w)))];
  const matchedPhrases = new Set<string>();
  for (let i = 0; i + 1 < seq.length; i++) {
    const p = `${seq[i]} ${seq[i + 1]}`;
    if (terms.phrases.has(p)) matchedPhrases.add(p);
  }
  return { suggest: matchedWords.length >= 2 || matchedPhrases.size >= 1, matched: [...matchedPhrases, ...matchedWords].slice(0, 4) };
}
