// Study trail: during a Loomer session, Loomer notices the study sites the
// student picked (ChatGPT, Quizlet, ...). It matches their visible text on this
// computer against the assignment's topics and key terms, and keeps only what
// matched. No page text is stored or sent anywhere.

/** The study sites the picker lists first. The student ticks which ones Loomer may notice. */
export const STUDY_SITES = [
  { origin: 'https://chatgpt.com', name: 'ChatGPT' },
  { origin: 'https://quizlet.com', name: 'Quizlet' },
  { origin: 'https://knowt.com', name: 'Knowt' },
  { origin: 'https://studyfetch.com', name: 'StudyFetch' },
  { origin: 'https://gemini.google.com', name: 'Gemini' },
  { origin: 'https://www.khanacademy.org', name: 'Khan Academy' },
] as const satisfies readonly { origin: string; name: string }[];

/** Host permission patterns for a site: the site and its subdomains. Pass these to permissions.request inside the click. */
export function trailPatterns(origin: string): string[] {
  const host = new URL(origin).hostname.replace(/^www\./, '');
  return [`https://${host}/*`, `https://*.${host}/*`];
}

/**
 * A site the student typed ("brainscape.com", "https://www.brainscape.com"),
 * as an origin and a name. Null when it isn't a plain public domain: a path,
 * an IP address, localhost, or no dot.
 */
export function parseSite(input: string): { origin: string; name: string } | null {
  const raw = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!raw || /[/?#@:\s]/.test(raw)) return null;
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(raw) || /^\d+(\.\d+)+$/.test(raw)) return null;
  const known = STUDY_SITES.find((s) => hostOf(s.origin) === raw.replace(/^www\./, ''));
  return known ? { origin: known.origin, name: known.name } : { origin: `https://${raw}`, name: raw.replace(/^www\./, '') };
}

/** A site's host without www, for matching tabs on it or its subdomains. */
export const hostOf = (origin: string) => new URL(origin).hostname.replace(/^www\./, '');

/** What the session screen shows. Null when no session is running. */
export type TrailView = {
  /** A known study site is the front tab, isn't picked, and wasn't dismissed: show "You're on Quizlet. Pick the study sites ..." */
  ask: { origin: string; name: string } | null;
  /** Loomer can't see which site is in front (no tab access) and nothing is picked yet: offer the picker once, without naming a site. */
  setup: boolean;
  /** An unpicked, undismissed site in front whose title matches the assignment: "Read this site too?" `matched` is the topic or key term. */
  other: { origin: string; matched: string } | null;
  /** The student's list, for the picker's ticks and the noticed list. */
  picked: { origin: string; name: string; paused: boolean }[];
  /** This session, per site. `took` is one sentence: "14 key terms from Unit 5 Test came up." */
  noticed: { origin: string; name: string; minutes: number; took: string; paused: boolean }[];
};

/** A prep topic studied outside Loomer since its last check. Never changes standing or progress. */
export type Elsewhere = { kind: 'site' | 'asked'; text: string };
