// The insight under Home's next step: the best thing Loomer found, as one
// sentence that names the assignment and gives the concrete fact (a date, the
// days left, what the teacher asked). Pure; facts from the plan and the student.
import type { Assignment } from '../core/db';
import type { Insight } from '../model/home';
import type { TopicItem } from '../model/session';
import type { EffectiveDue } from './facts';
import { dayIndex, dayName, lowerFirst, minutesLong, roomWords, weekdayLong, type Planned } from './plan';

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

/** "today", "tomorrow", "Thursday" in the coming week, else "Thursday, Oct 29". */
function dayWords(iso: string, now: Date): string {
  const n = daysFrom(iso, now);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n <= 6) return weekdayLong(iso);
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** "so today is a good day to start", from the planned start day. */
function startClause(p: Planned): string {
  const pl = p.placement;
  if (pl?.kind === 'student' && p.startBy) return `and you picked ${p.bucket === 'today' ? 'today' : weekdayLong(p.startBy.at)} to start`;
  const when = !p.startBy || p.bucket === 'today' ? 'today' : p.bucket === 'tomorrow' ? 'tomorrow' : null;
  if (pl?.kind === 'guess') {
    const start = when ? `starting ${when}` : `starting by ${weekdayLong(p.startBy!.at)}`;
    return pl.short
      ? `so ${start} helps, though your guess of about ${minutesLong(pl.minutes)} is more than the days before it have`
      : `so ${start} leaves time for your guess of about ${minutesLong(pl.minutes)}`;
  }
  return when ? `so ${when} is a good day to start` : `so start by ${weekdayLong(p.startBy!.at)}`;
}

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

function countdown(noun: string, p: Planned | null, due: EffectiveDue, now: Date): string {
  if (!due.at) {
    return p?.keptActive ? `You kept ${noun} active, so it stays on your plan.` : `Loomer didn't find a due date for ${noun}, so check the instructions for one.`;
  }
  const n = daysFrom(due.at, now);
  if (n < 0) return `${cap(noun)} was due ${dayWords(due.at, now)}, so it's worth finishing soon.`;
  const at = new Date(due.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (n === 0) return `${cap(noun)} is due today at ${at}, so it's the one to finish first.`;
  const when = n === 1 ? 'tomorrow' : `${dayWords(due.at, now)}, ${n} days from now`;
  return `${cap(noun)} is due ${when}, ${p ? startClause(p) : 'so today is a good day to start'}.`;
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
