// Local AI-policy detection over school text, run before anything is sent to AI.
// It classifies sentences that mention AI and never treats a keyword alone as a
// ban. Detection is a tested limitation, not a guarantee that every rule is found.
import type { PolicyState } from '../model/home';

// Bare "AI" is matched case-sensitively, so lowercase "ai" inside words never counts.
const BARE_AI = /\bA\.?I\.?(?![a-z])/;
const OTHER_TERMS = /\b(?:artificial intelligence|chat ?gpt|generative|chatbots?|copilot|large language models?|LLMs?)\b/i;

const PROHIBIT =
  /\b(do not|don't|must not|mustn't|may not|cannot|can't|should not|shouldn't|not (?:be )?(?:allowed|permitted|acceptable)|prohibited|forbidden|banned|plagiarism|academic dishonesty|cheating)\b|\bno\s+(?:use of\s+)?(?:AI|A\.I\.|artificial intelligence|generative|chat ?gpt)\b/i;
const PERMIT =
  /\b(may use|can use|are allowed to use|(?:is|are) allowed|(?:is|are) permitted|permitted to use|encouraged to use|welcome to use|feel free to use)\b/i;
const QUOTED = /["“][^"”]*\b(?:AI|artificial intelligence|chat ?gpt|generative)\b[^"”]*["”]/i;

export type PolicyVerdict = 'prohibits' | 'permits' | 'mixed' | 'mentions';
export type PolicyFinding = { verdict: PolicyVerdict; quote: string; sourceLabel: string };
export type PolicySource = { label: string; text: string | null };

export type PolicyResult = {
  state: PolicyState;
  /** Why the state is unresolved, when it is. */
  unresolvedBecause: 'unreadable' | 'ambiguous' | null;
  /** The passage behind the state, shown in the restriction notice. */
  finding: PolicyFinding | null;
};

export function scanPolicy(text: string, sourceLabel: string): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.trim();
    if (!BARE_AI.test(sentence) && !OTHER_TERMS.test(sentence)) continue;
    const prohibits = PROHIBIT.test(sentence);
    const permits = PERMIT.test(sentence);
    const verdict: PolicyVerdict = QUOTED.test(sentence)
      ? 'mentions'
      : prohibits && permits
        ? 'mixed'
        : prohibits
          ? 'prohibits'
          : permits
            ? 'permits'
            : 'mentions';
    findings.push({ verdict, quote: sentence, sourceLabel });
  }
  return findings;
}

/**
 * Combines course and assignment sources. Any prohibition wins over permission;
 * prohibition alongside permission is `limited`; a bare mention is `unresolved`.
 * An unreadable source prevents clearance.
 */
export function resolvePolicy(sources: PolicySource[]): PolicyResult {
  const findings = sources.flatMap((s) => (s.text ? scanPolicy(s.text, s.label) : []));
  const first = (v: PolicyVerdict) => findings.find((f) => f.verdict === v) ?? null;
  const prohibits = first('prohibits');
  const permits = first('permits');
  const mixed = first('mixed');
  const mentions = first('mentions');

  if (prohibits && !permits && !mixed) return { state: 'blocked', unresolvedBecause: null, finding: prohibits };
  if (prohibits || mixed) return { state: 'limited', unresolvedBecause: null, finding: mixed ?? prohibits };
  if (sources.some((s) => s.text === null)) return { state: 'unresolved', unresolvedBecause: 'unreadable', finding: null };
  if (mentions) return { state: 'unresolved', unresolvedBecause: 'ambiguous', finding: mentions };
  if (permits) return { state: 'permitted', unresolvedBecause: null, finding: permits };
  return { state: 'none-found', unresolvedBecause: null, finding: null };
}
