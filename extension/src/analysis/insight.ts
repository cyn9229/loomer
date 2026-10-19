// The insight under Home's next step: the best thing Loomer found, as one
// sentence that names the assignment and gives the concrete fact (a date, the
// days left, what the teacher asked). Pure; facts from the plan and the student.
import type { Assignment } from '../core/db';
import type { Insight } from '../model/home';
import type { TopicItem } from '../model/session';
import type { EffectiveDue } from './facts';
import { dayIndex, dayName, dayWords, lowerFirst, roomWords, startClause, startReason, type Planned } from './plan';

/** Title words that name the kind of work, most specific first. */
const NOUNS = [
  'lab report', 'research paper', 'problem set', 'study guide', 'worksheet', 'essay', 'reflection', 'report', 'project',
  'presentation', 'discussion', 'journal', 'lab', 'quiz', 'test', 'exam', 'review', 'reading', 'paper', 'outline',
  'draft', 'homework', 'poem', 'letter', 'response', 'summary', 'analysis',
];
const KIND_NOUN: Record<Assignment['kind'], string> = { quiz: 'quiz', discussion_topic: 'discussion', assignment: 'assignment' };

/** "this essay", from the title's words, else the Canvas kind. */
export function assignmentNoun(a: Pick<Assignment, 'title' | 'kind'>): string {
  const title = a.title.toLowerCase();
  const noun = NOUNS.find((n) => new RegExp(`\\b${n}s?\\b`).test(title)) ?? KIND_NOUN[a.kind];
  return `this ${noun}`;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const daysFrom = (iso: string, now: Date) => dayIndex(Date.parse(iso)) - dayIndex(now.getTime());

/** Verbs that open a checkpoint written as a step ("Submit a full draft"). */
const STEP_VERB = /^(submit|turn in|hand in|write|finish|complete|bring|post|share|upload|choose|pick|meet|present|read|send|sign up|email)\b/i;
const HAS_ARTICLE = /^(a|an|the|your|one|two|three|four|five|\d+|each|all|both|some)\b/i;

/** "ask you to submit a full draft" or "ask for a draft for peer review". */
function askFor(step: string): string {
  const t = lowerFirst(step.trim().replace(/[.]+$/, ''));
  if (STEP_VERB.test(t)) return `ask you to ${t}`;
  if (HAS_ARTICLE.test(t)) return `ask for ${t}`;
  return `ask for ${/^[aeiou]/i.test(t) ? 'an' : 'a'} ${t}`;
}

type InsightInput = {
  a: Pick<Assignment, 'title' | 'kind'>;
  planned: Planned | null;
  due: EffectiveDue;
  /** The "what moved" line, when the top of the plan moved. */
  change: string | null;
  now: Date;
};

/** Change, then hidden deadline, then busy day, then the countdown. Weak topics come from weakTopicInsight. */
export function insightFor({ a, planned: p, due, change, now }: InsightInput): Insight {
  if (change) return { kind: 'change', text: change, aiFound: false };
  const noun = assignmentNoun(a);
  const cp = p?.nextCheckpoint;
  if (p && cp && due.at && daysFrom(cp.at, now) < daysFrom(due.at, now)) {
    const says = due.source === 'instructions' ? 'The instructions say' : 'Canvas says';
    const they = due.source === 'instructions' ? 'they' : 'the instructions';
    return { kind: 'hidden-deadline', text: `${says} ${noun} is due ${dayWords(due.at, now)}, but ${they} ${askFor(cp.text)} by ${dayWords(cp.at, now)}, ${startClause(p)}.`, aiFound: true };
  }
  if (p?.placement?.kind === 'moved' && p.startBy) {
    const busy = `you said ${dayName(p.placement.from)} ${roomWords[p.placement.level]}`;
    const to = dayWords(p.startBy.at, now);
    const text = due.at
      ? `${cap(noun)} is due ${dayWords(due.at, now)}, and since ${busy}, Loomer moved its start up to ${to}.`
      : `Since ${busy}, Loomer moved the start of ${noun} up to ${to}.`;
    return { kind: 'busy-day', text, aiFound: false };
  }
  return { kind: 'countdown', text: countdown(noun, p, due, now), aiFound: false };
}

/** The plan's own reason when the item is planned; otherwise the due date alone. */
function countdown(noun: string, p: Planned | null, due: EffectiveDue, now: Date): string {
  if (p) return startReason(p, now);
  if (!due.at) return `Loomer didn't find a due date for ${noun}, so check the instructions for one.`;
  return `${cap(noun)} is due ${dayWords(due.at, now)}.`;
}

/** For practice or study work: the shaky topic from the student's last quick check. Null when no topic is shaky. */
export function weakTopicInsight(a: Pick<Assignment, 'title' | 'kind'>, topic: TopicItem, due: EffectiveDue, now: Date): Insight | null {
  const check = topic.lastCheck;
  if (topic.standing !== 'shaky' || !check) return null;
  const missed = `You missed ${check.total - check.correct} of ${check.total} on ${lowerFirst(topic.text)} last time`;
  const noun = assignmentNoun(a);
  const text = due.at ? `${missed}, and ${noun} is due ${dayWords(due.at, now)}, so start with that topic.` : `${missed}, so start ${noun} with that topic.`;
  return { kind: 'weak-topic', text, aiFound: false };
}
