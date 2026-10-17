// Local deadline extraction from instruction text. Conservative on purpose: only
// explicit month/day dates in sentences about due dates count. Weekday-only
// phrases ("due Friday") are ambiguous and ignored.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DUE_WORDS = /\b(due|deadline|submit(?:ted)? by|turn(?:ed)? in by)\b/i;
const MONTH_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g;
const DAY_MS = 86_400_000;

/** A date named in the instructions, as a local calendar date (YYYY-MM-DD), with its sentence. */
export type InstructionDeadline = { date: string; quote: string };

export function findInstructionDeadlines(text: string, reference: Date): InstructionDeadline[] {
  const found: InstructionDeadline[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!DUE_WORDS.test(sentence)) continue;
    for (const m of sentence.matchAll(MONTH_DATE)) {
      const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
      push(found, toDate(month, Number(m[2]), m[3] ? Number(m[3]) : null, reference), sentence);
    }
    for (const m of sentence.matchAll(NUMERIC_DATE)) {
      const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : null;
      push(found, toDate(Number(m[1]) - 1, Number(m[2]), year, reference), sentence);
    }
  }
  return found;
}

function push(found: InstructionDeadline[], date: string | null, sentence: string) {
  if (date && !found.some((f) => f.date === date)) found.push({ date, quote: sentence.trim() });
}

/** Without a year, pick the one that puts the date nearest after (reference - 60 days). */
function toDate(month: number, day: number, year: number | null, reference: Date): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let y = year ?? reference.getFullYear();
  if (year === null && new Date(y, month, day).getTime() < reference.getTime() - 60 * DAY_MS) y += 1;
  const d = new Date(y, month, day);
  if (d.getMonth() !== month) return null; // e.g. Feb 31
  return `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Local calendar date of an ISO timestamp, for comparing with instruction dates. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
