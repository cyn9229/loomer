// Test prep rules, pure: where each topic stands from the student's own
// practice answers, the plan of days back from the test, the readiness line,
// the mistakes list, and what each day's practice asks. Never a grade.
import type { PracticeRecord, PrepRecord, TopicCheckRecord } from '../core/db';
import type { PracticeKind, PrepDay, PrepDayKind, PrepMistake, PrepTopic, Standing } from '../model/prep';
import { lastCheck, standingOf, topicKey } from '../analysis/topicStanding';
import { dayIndex, localDay } from '../analysis/plan';

/** A topic answered right comes back after this many days, so it sticks. */
const COMEBACK_DAYS = 2;
const FOCUS_TOPICS = 2;
export const DAY_MINUTES: Record<PrepDayKind | 'comeback', number> = { 'check-all': 10, focus: 10, 'practice-test': 25, 'warm-up': 5, comeback: 5 };

type Active = PrepRecord['topics'][number];
export const activeTopics = (prep: PrepRecord) => prep.topics.filter((t) => !t.removed);

/** Each active topic with its standing from the latest practice that covered it. */
export function topicStandings(prep: PrepRecord, checks: TopicCheckRecord[]): PrepTopic[] {
  return activeTopics(prep).map((t) => {
    const check = lastCheck(checks.filter((c) => c.topic === topicKey(t.text)));
    return { id: t.id, text: t.text, standing: standingOf(check), lastCheck: check && { correct: check.correct, total: check.total }, source: t.source, new: t.new };
  });
}

export function counts(topics: PrepTopic[]): Record<Standing, number> {
  return { solid: topics.filter((t) => t.standing === 'solid').length, shaky: topics.filter((t) => t.standing === 'shaky').length, unchecked: topics.filter((t) => t.standing === 'unchecked').length };
}

const ratio = (t: PrepTopic) => (t.lastCheck && t.lastCheck.total ? t.lastCheck.correct / t.lastCheck.total : 0);

/** Shakiest first (lowest share right), then unchecked, then the oldest solid. */
export function weakest(topics: PrepTopic[], checks: TopicCheckRecord[], n: number): PrepTopic[] {
  const lastAt = (t: PrepTopic) => checks.filter((c) => c.topic === topicKey(t.text)).reduce((max, c) => (c.at > max ? c.at : max), '');
  const shaky = topics.filter((t) => t.standing === 'shaky').sort((a, b) => ratio(a) - ratio(b));
  const unchecked = topics.filter((t) => t.standing === 'unchecked');
  const solid = topics.filter((t) => t.standing === 'solid').sort((a, b) => lastAt(a).localeCompare(lastAt(b)));
  return [...shaky, ...unchecked, ...solid].slice(0, n);
}

/** Solid topics last checked at least two days ago: a quick check today helps them stick. */
export function comebacks(topics: PrepTopic[], checks: TopicCheckRecord[], now: Date): PrepTopic[] {
  const today = dayIndex(now.getTime());
  return topics.filter((t) => {
    if (t.standing !== 'solid') return false;
    const at = checks.filter((c) => c.topic === topicKey(t.text)).reduce((max, c) => (c.at > max ? c.at : max), '');
    return at !== '' && today - dayIndex(Date.parse(at)) >= COMEBACK_DAYS;
  });
}

/** "the Congo and Latin America", "Hawaii, the Congo, and Panama". */
export function names(items: { text: string }[]): string {
  const t = items.map((i) => i.text);
  if (t.length <= 1) return t[0] ?? '';
  if (t.length === 2) return `${t[0]} and ${t[1]}`;
  return `${t.slice(0, -1).join(', ')}, and ${t.at(-1)}`;
}

/** "1 topic", "8 topics". */
export const topicCount = (n: number) => `${n} ${n === 1 ? 'topic' : 'topics'}`;

/** "5 of 8 topics on this test are solid, and Latin America still needs work." */
export function readiness(topics: PrepTopic[], checks: TopicCheckRecord[]): string {
  const c = counts(topics);
  const n = topics.length;
  if (n === 0) return "Loomer hasn't found the topics on this test yet, so add your notes or a topic to start.";
  if (c.unchecked === n) return `Loomer found ${topicCount(n)} on this test and hasn't checked any yet, so start with the quick check.`;
  if (c.solid === n) return n === 1 ? "The one topic on this test is solid, so a warm-up is all that's left." : `All ${n} topics on this test are solid, so a warm-up is all that's left.`;
  const weak = weakest(topics, checks, 1)[0]!;
  return `${c.solid} of ${topicCount(n)} on this test ${c.solid === 1 ? 'is' : 'are'} solid, and ${weak.text} still needs work.`;
}

const dayOf = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const weekday = (ymd: string, style: 'short' | 'long' = 'short') => dayOf(ymd).toLocaleDateString(undefined, { weekday: style });

/** The plan's day kinds back from the test: a quick check first, focus days, a practice test the day before, a warm-up the morning of. */
export function dayKinds(count: number): PrepDayKind[] {
  if (count <= 1) return ['warm-up'];
  if (count === 2) return ['practice-test', 'warm-up'];
  return ['check-all', ...Array<PrepDayKind>(count - 3).fill('focus'), 'practice-test', 'warm-up'];
}

/** What a day's practice covers and asks, from the test's formats and where each topic stands. */
export function practiceFor(kind: PrepDayKind | 'comeback', prep: PrepRecord, topics: PrepTopic[], checks: TopicCheckRecord[], now: Date): { topics: PrepTopic[]; kinds: { kind: PracticeKind; count: number }[] } {
  const f = new Set(prep.formats.selected);
  const terms = prep.terms.length > 0 && f.has('vocab');
  const extra = (counts: Partial<Record<PracticeKind, number>>) =>
    Object.entries(counts).flatMap(([kind, count]) => (count ? [{ kind: kind as PracticeKind, count }] : []));
  switch (kind) {
    case 'check-all': {
      const all = topics.slice(0, 12);
      return { topics: all, kinds: [{ kind: 'mcq', count: Math.min(Math.max(all.length, 3), 10) }] };
    }
    case 'focus': {
      const focus = weakest(topics, checks, FOCUS_TOPICS);
      const back = comebacks(topics, checks, now).filter((t) => !focus.includes(t)).slice(0, 2);
      return {
        topics: [...focus, ...back],
        kinds: extra({ mcq: focus.length * 2 + back.length, short: f.has('frq') || f.has('short') ? 1 : 0, vocab: terms ? 2 : 0, math: f.has('math') ? 2 : 0 }),
      };
    }
    case 'comeback': {
      const back = comebacks(topics, checks, now).slice(0, 3);
      return { topics: back.length ? back : weakest(topics, checks, 2), kinds: [{ kind: 'mcq', count: Math.max(back.length, 2) }] };
    }
    case 'practice-test':
      return {
        topics: topics.slice(0, 12),
        kinds: extra({ mcq: 8, frq: f.has('frq') ? 1 : 0, short: f.has('short') ? 2 : 0, vocab: terms ? 3 : 0, math: f.has('math') ? 3 : 0 }),
      };
    case 'warm-up': {
      const weak = weakest(topics, checks, 2);
      return { topics: weak, kinds: extra({ mcq: 3, vocab: terms ? 2 : 0 }) };
    }
  }
}

/** The plan, one row per day from the first prep day to the test day. */
export function planDays(prep: PrepRecord, testAt: string, topics: PrepTopic[], practices: PracticeRecord[], checks: TopicCheckRecord[], now: Date): PrepDay[] {
  const today = localDay(now);
  const testDay = localDay(new Date(testAt));
  const start = prep.startDay < today ? prep.startDay : today;
  const dates: string[] = [];
  for (let d = dayOf(start); localDay(d) <= testDay && dates.length < 21; d = new Date(d.getTime() + 86_400_000)) dates.push(localDay(d));
  const kinds = dayKinds(dates.length);
  const solid = counts(topics).solid;
  const back = comebacks(topics, checks, now).length;
  return dates.map((date, i) => {
    const kind = kinds[i]!;
    const ended = practices.filter((p) => p.endedAt && p.day === date);
    const done = date < today ? ended.length > 0 : ended.some((p) => p.dayKind === kind);
    const status: PrepDay['status'] = done ? 'done' : date < today ? 'missed' : date === today ? 'today' : 'later';
    const step = stepText(kind, topics, checks);
    const sub =
      status === 'done' ? `Done, ${solid} solid`
      : status === 'missed' ? 'Skipped'
      : status === 'today' ? (kind === 'focus' && back > 0 ? `Today · ${back} ${back === 1 ? 'topic comes' : 'topics come'} back so ${back === 1 ? 'it sticks' : 'they stick'}` : 'Today')
      : kind === 'practice-test' ? 'The day before'
      : kind === 'warm-up' ? 'Morning of'
      : weekday(date, 'long');
    return { date, kind, step, sub, status };
  });
}

/** "10 minutes on the Congo and Latin America". */
export function stepText(kind: PrepDayKind | 'comeback', topics: PrepTopic[], checks: TopicCheckRecord[]): string {
  switch (kind) {
    case 'check-all':
      return topics.length === 1 ? 'Quick check on the one topic' : `Quick check on all ${topics.length} topics`;
    case 'focus':
      return `10 minutes on ${names(weakest(topics, checks, FOCUS_TOPICS))}`;
    case 'comeback':
      return `Quick check: ${names(weakest(topics.filter((t) => t.standing === 'solid'), checks, 2))}, so it sticks`;
    case 'practice-test':
      return "A practice test in this test's formats";
    case 'warm-up':
      return `5-minute warm-up on ${names(weakest(topics, checks, 2))}`;
  }
}

/** Was this answer right? Written answers count when at least two thirds of what they needed was there. */
export function answerRight(a: PracticeRecord['answers'][string]): boolean | null {
  switch (a.kind) {
    case 'mcq':
    case 'math':
      return a.right;
    case 'vocab':
      return a.knew;
    case 'short':
    case 'explain':
      return a.status === 'ready' ? a.met.length * 3 >= (a.met.length + a.missing.length) * 2 : null;
    case 'frq':
      return a.status === 'ready' ? a.needs.filter((n) => n.met).length * 3 >= a.needs.length * 2 : null;
  }
}

/** Wrong answers, newest first; "then right" once a later answer on the same topic was right. */
export function mistakes(practices: PracticeRecord[]): PrepMistake[] {
  const answered = practices
    .slice()
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
    .flatMap((p) => p.questions.flatMap((q) => (p.answers[q.id] ? [{ p, q, right: answerRight(p.answers[q.id]!) }] : [])));
  return answered
    .flatMap(({ p, q, right }, i) => {
      if (right !== false) return [];
      const later = answered.slice(i + 1).some((x) => x.q.topicId === q.topicId && x.right === true);
      return [{ id: q.id, topicId: q.topicId, topic: q.topic, label: q.label, sub: `Missed ${weekday(p.day)}${later ? ', then right' : ''}` }];
    })
    .reverse()
    .slice(0, 10);
}

/** Matches the AI's topic name to one of the test's topics. */
export function matchTopic(name: string, topics: Active[]): Active {
  const key = topicKey(name);
  return topics.find((t) => topicKey(t.text) === key) ?? topics.find((t) => key.includes(topicKey(t.text)) || topicKey(t.text).includes(key)) ?? topics[0]!;
}
