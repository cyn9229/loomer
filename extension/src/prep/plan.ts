// Test prep rules, pure: where each topic stands from the student's own
// practice answers, study sessions that fit the time left before the test,
// the readiness line, the diagnosis, the mistakes list, and what each session
// asks. Never a grade, and never a guess at how long the student needs.
import type { Elsewhere } from '../model/trail';
import type { PracticeRecord, PrepRecord, TopicCheckRecord } from '../core/db';
import type { Confidence, Outcome, PracticeKind, PrepMistake, PrepSession, PrepSessionKind, PrepTopic, Standing } from '../model/prep';
import { lastCheck, topicKey } from '../analysis/topicStanding';
import { dayIndex, localDay } from '../analysis/plan';
import { answerRight, climb, observationsFor, type Ladder, type Strictness } from './ladder';
export { answerRight, answerSolid } from './ladder';

export const SESSION_MINUTES: Record<PrepSessionKind, number> = { diagnostic: 15, focus: 20, 'mixed-check': 10, 'practice-test': 25, review: 10, 'warm-up': 5, rescue: 10 };
/** A later-today check opens at 7 PM; after 9:30 PM Loomer plans nothing, because sleep helps memory more. */
const EVENING_HOUR = 19;
const LAST_HOUR = 21.5;
const FOCUS_TOPICS = 2;

type Active = PrepRecord['topics'][number];
export const activeTopics = (prep: PrepRecord) => prep.topics.filter((t) => !t.removed);

/** Multiple choice: right and sure is solid, right but a guess is shaky, wrong but sure is a mix-up, wrong and a guess is a gap. No confidence counts as sure. */
export function outcomeOf(right: boolean, confidence: Confidence | null): Outcome {
  if (right) return confidence === 'guessing' ? 'shaky' : 'solid';
  return confidence === 'guessing' ? 'gap' : 'mixup';
}


/**
 * A topic's last two practices together (the last answer per question in each).
 * Solid needs at least 2 sure, right answers there and 80% or better, so one
 * lucky answer never makes a topic look ready.
 */
export function recentCheck(checks: TopicCheckRecord[]): { correct: number; total: number } | null {
  const quizzes = [...new Set(checks.slice().sort((a, b) => b.at.localeCompare(a.at)).map((c) => c.quizId))].slice(0, 2);
  if (quizzes.length === 0) return null;
  return quizzes
    .map((q) => lastCheck(checks.filter((c) => c.quizId === q))!)
    .reduce((sum, c) => ({ correct: sum.correct + c.correct, total: sum.total + c.total }), { correct: 0, total: 0 });
}

/** Each active topic's ladder (see ladder.ts): what to ask next and whether it is ready. */
export function ladders(prep: PrepRecord, practices: PracticeRecord[], strict: Strictness): Map<string, Ladder> {
  return new Map(activeTopics(prep).map((t) => [t.id, climb(observationsFor(t.id, practices), strict)]));
}

/**
 * Each active topic as the panel shows it. Solid means ready on the ladder
 * (the right rung held, no open mix-up, and a later sitting), shown only as a
 * simple bar (`progress`) and the standing, never as rungs.
 */
/** `elsewhere`: topics studied outside Loomer, by id (from elsewhereFor). It orders checks, never standing. */
export function topicStandings(prep: PrepRecord, checks: TopicCheckRecord[], practices: PracticeRecord[], strict: Strictness, elsewhere: Map<string, Elsewhere>): PrepTopic[] {
  const climbed = ladders(prep, practices, strict);
  return activeTopics(prep).map((t) => {
    const ladder = climbed.get(t.id)!;
    const check = recentCheck(checks.filter((c) => c.topic === topicKey(t.text)));
    const standing: Standing = !ladder.seen ? 'unchecked' : ladder.ready ? 'solid' : 'shaky';
    return { id: t.id, text: t.text, standing, lastCheck: check, source: t.source, new: t.new, mixup: ladder.mixupOpen, progress: Math.round(ladder.progress * 100) / 100, elsewhere: elsewhere.get(t.id) ?? null };
  });
}

export function counts(topics: PrepTopic[]): Record<Standing, number> {
  return { solid: topics.filter((t) => t.standing === 'solid').length, shaky: topics.filter((t) => t.standing === 'shaky').length, unchecked: topics.filter((t) => t.standing === 'unchecked').length };
}

const lastAt = (t: PrepTopic, checks: TopicCheckRecord[]) => checks.filter((c) => c.topic === topicKey(t.text)).reduce((max, c) => (c.at > max ? c.at : max), '');

/**
 * Mix-ups first, then topics the student kept asking about elsewhere, then the
 * shakiest (least progress on the ladder), then topics studied elsewhere (one
 * quick check to see if it stuck), then unchecked, then the oldest solid.
 */
export function weakest(topics: PrepTopic[], checks: TopicCheckRecord[], n: number): PrepTopic[] {
  const mixups = topics.filter((t) => t.mixup);
  const rest = topics.filter((t) => !t.mixup);
  const asked = rest.filter((t) => t.elsewhere?.kind === 'asked');
  const plain = rest.filter((t) => t.elsewhere?.kind !== 'asked');
  const shaky = plain.filter((t) => t.standing === 'shaky').sort((a, b) => a.progress - b.progress);
  const studied = plain.filter((t) => t.standing !== 'shaky' && t.elsewhere?.kind === 'site');
  const unchecked = plain.filter((t) => t.standing === 'unchecked' && !t.elsewhere);
  const solid = plain.filter((t) => t.standing === 'solid' && !t.elsewhere).sort((a, b) => lastAt(a, checks).localeCompare(lastAt(b, checks)));
  return [...mixups, ...asked, ...shaky, ...studied, ...unchecked, ...solid].slice(0, n);
}

/** Solid topics last checked at least `days` days ago: a quick check helps them stick. */
export function comebacks(topics: PrepTopic[], checks: TopicCheckRecord[], now: Date, days = 1): PrepTopic[] {
  const today = dayIndex(now.getTime());
  return topics.filter((t) => t.standing === 'solid' && !t.mixup && lastAt(t, checks) !== '' && today - dayIndex(Date.parse(lastAt(t, checks))) >= days);
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
  if (c.unchecked === n) return `Loomer found ${topicCount(n)} on this test and hasn't checked any yet, so start with the diagnostic.`;
  const weak = weakest(topics, checks, 1)[0]!;
  if (c.solid === n && !weak.mixup) return n === 1 ? "The one topic on this test is ready, so a warm-up is all that's left." : `All ${n} topics on this test are ready, so a warm-up is all that's left.`;
  return `${c.solid} of ${topicCount(n)} on this test ${c.solid === 1 ? 'is' : 'are'} ready, and ${weak.mixup ? `the ${weak.text} mix-up` : weak.text} still needs work.`;
}

const dayOf = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const addDays = (ymd: string, n: number) => localDay(new Date(dayOf(ymd).getTime() + n * 86_400_000));
const weekdayLong = (ymd: string) => dayOf(ymd).toLocaleDateString(undefined, { weekday: 'long' });
const weekdayShort = (ymd: string) => dayOf(ymd).toLocaleDateString(undefined, { weekday: 'short' });
const daysBetween = (a: string, b: string) => Math.round((dayOf(b).getTime() - dayOf(a).getTime()) / 86_400_000);
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });

type Slot = { date: string; kind: PrepSessionKind; when: PrepSession['when'] };

/**
 * The sessions from the first prep day to the test, by the days between them:
 * - test today: a 10-minute rescue;
 * - tomorrow: the diagnostic now, teaching and practice next, a mixed check after dinner, a warm-up in the morning;
 * - 2 days: the diagnostic and focus, a practice test the day before, the warm-up;
 * - 3 to 6 days: the diagnostic, focus days where topics come back the next day, a practice test the day before;
 * - a week or more: focus days about 1, 3, and 6 days in, a practice test 2 days before, a light review the day before.
 */
export function sessionSlots(startDay: string, testDay: string): Slot[] {
  const span = daysBetween(startDay, testDay);
  if (span <= 0) return [{ date: startDay, kind: 'rescue', when: 'now' }];
  const morning: Slot = { date: testDay, kind: 'warm-up', when: 'morning' };
  if (span === 1) return [{ date: startDay, kind: 'diagnostic', when: 'now' }, { date: startDay, kind: 'focus', when: 'next' }, { date: startDay, kind: 'mixed-check', when: 'later-today' }, morning];
  const first: Slot[] = [{ date: startDay, kind: 'diagnostic', when: 'now' }, { date: startDay, kind: 'focus', when: 'next' }];
  if (span === 2) return [...first, { date: addDays(startDay, 1), kind: 'practice-test', when: 'day' }, morning];
  if (span <= 6) {
    const focus = Array.from({ length: span - 2 }, (_, i): Slot => ({ date: addDays(startDay, i + 1), kind: 'focus', when: 'day' }));
    return [...first, ...focus, { date: addDays(testDay, -1), kind: 'practice-test', when: 'day' }, morning];
  }
  // Topics come back after about 1, 3, and 6 days, then every few days.
  const offsets = [1, 3, 6];
  for (let o = 9; o < span - 2; o += 3) offsets.push(o);
  const focus = offsets.filter((o) => o < span - 2).map((o): Slot => ({ date: addDays(startDay, o), kind: 'focus', when: 'day' }));
  return [...first, ...focus, { date: addDays(testDay, -2), kind: 'practice-test', when: 'day' }, { date: addDays(testDay, -1), kind: 'review', when: 'day' }, morning];
}

/**
 * A session's title: a few words, never a list of topics (those go in the line
 * under it), so the page stays easy to scan: "10-minute mixed check".
 */
export function stepText(kind: PrepSessionKind, topics: PrepTopic[], minutes = SESSION_MINUTES[kind]): string {
  switch (kind) {
    case 'diagnostic':
      return topics.length === 1 ? 'Diagnostic on 1 topic' : `Diagnostic on ${topics.length} topics`;
    case 'focus':
      return stillWeak(topics).length ? `${minutes} minutes on weak spots` : `${minutes}-minute review`;
    case 'mixed-check':
      return `${minutes}-minute mixed check`;
    case 'practice-test':
      return 'Practice test';
    case 'review':
      return 'Light review';
    case 'warm-up':
      return `${minutes}-minute warm-up`;
    case 'rescue':
      return `${minutes}-minute rescue`;
  }
}

const FORMAT_WORDS: Record<PrepRecord['formats']['selected'][number], string> = { mcq: 'multiple choice', frq: 'free response', vocab: 'vocabulary', short: 'short answer', math: 'math problems' };

/** The specifics under a session's title: which topics it covers, or for a practice test, its formats. */
export function sessionDetail(kind: PrepSessionKind, prep: PrepRecord, topics: PrepTopic[], checks: TopicCheckRecord[]): string {
  const on = (n: number) => {
    const weak = stillWeak(topics);
    return `On ${fewNames((weak.length ? weakest(weak, checks, n) : weakest(topics, checks, n)))}`;
  };
  switch (kind) {
    case 'diagnostic':
      return `All ${topicCount(topics.length)}, ${topics.length <= 4 ? 3 : 2} questions each`;
    case 'practice-test': {
      const formats = prep.formats.selected.map((f) => FORMAT_WORDS[f]);
      const list = formats.length <= 1 ? (formats[0] ?? 'multiple choice') : `${formats.slice(0, -1).join(', ')} and ${formats.at(-1)}`;
      return `${list.charAt(0).toUpperCase()}${list.slice(1)}, like the real test`;
    }
    case 'focus':
    case 'warm-up':
    case 'rescue':
      return on(2);
    case 'mixed-check':
    case 'review':
      return on(3);
  }
}

/** Topics that really need work: mix-ups, shaky, or unchecked. */
export const stillWeak = (topics: PrepTopic[]) => topics.filter((t) => t.mixup || t.standing !== 'solid');

/** At most two names, then "and 3 more": "Hawaii and the Congo", "Hawaii, the Congo, and 3 more". */
export function fewNames(items: { text: string }[]): string {
  if (items.length <= 2) return names(items);
  return `${items[0]!.text}, ${items[1]!.text}, and ${items.length - 2} more`;
}

const MINUTE_WORDS: Record<number, string> = { 15: '15 minutes', 30: '30 minutes', 60: '1 hour' };

/**
 * The plan: every session with its status. Today's sessions fit the minutes
 * the student gave (the first always stays), a later-today session opens at
 * 7 PM, and nothing is planned after 9:30 PM.
 */
export function planSessions(
  prep: PrepRecord,
  testAt: string,
  topics: PrepTopic[],
  practices: PracticeRecord[],
  checks: TopicCheckRecord[],
  now: Date,
): { sessions: PrepSession[]; fits: string | null; note: string | null } {
  const today = localDay(now);
  const testDay = localDay(new Date(testAt));
  const start = prep.startDay < today ? prep.startDay : today;
  const slots = sessionSlots(start, testDay);
  const hour = now.getHours() + now.getMinutes() / 60;
  const minutesToday = prep.today?.day === today ? prep.today.minutes : null;
  const solid = counts(topics).solid;

  let left = minutesToday ?? Number.POSITIVE_INFINITY;
  let current = false;
  const sessions: PrepSession[] = [];
  slots.forEach((slot, i) => {
    const id = `${slot.date}:${slot.kind}:${i}`;
    const done = practices.some((p) => p.sessionId === id && p.endedAt);
    const isToday = slot.date === today;
    if (isToday && slot.when === 'later-today' && !done && hour >= LAST_HOUR) return;
    let minutes = SESSION_MINUTES[slot.kind];
    if (isToday && !done && current) {
      // Fit today's remaining sessions into the student's time; a focus session can shrink to 10 minutes.
      if (slot.kind === 'focus' && minutes > left) minutes = Math.max(10, Math.min(minutes, left));
      if (minutes > left) return;
    }
    const status: PrepSession['status'] = done ? 'done' : slot.date < today ? 'missed' : isToday && !current ? 'today' : 'later';
    if (status === 'today') current = true;
    if (isToday && !done) left -= minutes;
    const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), EVENING_HOUR);
    const remindAt = slot.when === 'later-today' ? (hour >= EVENING_HOUR ? now : evening).toISOString() : null;
    const prev = slots.slice(0, i).filter((s) => s.kind === 'focus' || s.kind === 'diagnostic').at(-1);
    const gap = slot.kind === 'focus' && prev && prev.date < slot.date ? daysBetween(prev.date, slot.date) : 0;
    sessions.push({
      id,
      date: slot.date,
      when: slot.when === 'now' && !isToday ? 'day' : slot.when === 'next' && !isToday ? 'day' : slot.when,
      label: labelOf(slot, today, testDay, remindAt),
      kind: slot.kind,
      minutes,
      step: stepText(slot.kind, topics, minutes),
      detail: sessionDetail(slot.kind, prep, topics, checks),
      sub: done ? `Done, ${solid} ready` : status === 'missed' ? 'Skipped' : '',
      status,
      back: gap ? `Back after ${gap} ${gap === 1 ? 'day' : 'days'}` : null,
      remindAt,
      reminder: (prep.reminders ?? []).includes(id),
    });
  });
  const tomorrow = daysBetween(today, testDay) === 1;
  return {
    sessions,
    fits: minutesToday && MINUTE_WORDS[minutesToday] ? `Fits your ${MINUTE_WORDS[minutesToday]}` : null,
    note: tomorrow ? "Loomer won't plan anything late tonight, because sleep helps you remember more than another hour of studying." : null,
  };
}

function labelOf(slot: Slot, today: string, testDay: string, remindAt: string | null): string {
  if (slot.date === today) {
    if (slot.when === 'later-today' && remindAt) return new Date(remindAt).getHours() === EVENING_HOUR ? `After dinner, around ${clock(new Date(remindAt))}` : 'Later today';
    return slot.when === 'next' ? 'Next' : 'Now';
  }
  if (slot.date === testDay) return daysBetween(today, testDay) === 1 ? 'Tomorrow morning' : `${weekdayLong(slot.date)} morning`;
  if (daysBetween(today, slot.date) === 1) return 'Tomorrow';
  return weekdayLong(slot.date);
}

/** What a session covers and asks, from the test's formats and where each topic stands. */
export function practiceFor(kind: PrepSessionKind, prep: PrepRecord, topics: PrepTopic[], checks: TopicCheckRecord[], now: Date, practicedToday: string[] = []): { topics: PrepTopic[]; kinds: { kind: PracticeKind; count: number }[]; perTopic: number | null } {
  const f = new Set(prep.formats.selected);
  const terms = prep.terms.length > 0 && f.has('vocab');
  const extra = (counts: Partial<Record<PracticeKind, number>>) => Object.entries(counts).flatMap(([kind, count]) => (count ? [{ kind: kind as PracticeKind, count }] : []));
  switch (kind) {
    case 'diagnostic': {
      const all = topics.slice(0, 10);
      const perTopic = all.length <= 4 ? 3 : 2;
      return { topics: all, kinds: [{ kind: 'mcq', count: Math.min(all.length * perTopic, 12) }], perTopic: all.length * perTopic <= 12 ? perTopic : null };
    }
    case 'focus': {
      const focus = weakest(topics, checks, FOCUS_TOPICS);
      const back = comebacks(topics, checks, now).filter((t) => !focus.includes(t)).slice(0, 2);
      return { topics: [...focus, ...back], kinds: extra({ mcq: focus.length * 2 + back.length, short: f.has('frq') || f.has('short') ? 1 : 0, vocab: terms ? 2 : 0, math: f.has('math') ? 2 : 0 }), perTopic: null };
    }
    case 'mixed-check': {
      const today = topics.filter((t) => practicedToday.includes(t.id));
      const mix = (today.length ? today : weakest(topics, checks, 3)).slice(0, 4);
      return { topics: mix, kinds: extra({ mcq: Math.max(mix.length + 2, 4), vocab: terms ? 1 : 0 }), perTopic: null };
    }
    case 'practice-test':
      return { topics: topics.slice(0, 12), kinds: extra({ mcq: 8, frq: f.has('frq') ? 1 : 0, short: f.has('short') ? 2 : 0, vocab: terms ? 3 : 0, math: f.has('math') ? 3 : 0 }), perTopic: null };
    case 'review': {
      const weak = weakest(topics, checks, 3);
      return { topics: weak, kinds: extra({ mcq: 4, vocab: terms ? 2 : 0 }), perTopic: null };
    }
    case 'warm-up': {
      const weak = weakest(topics, checks, 2);
      return { topics: weak, kinds: extra({ mcq: 3, vocab: terms ? 2 : 0 }), perTopic: null };
    }
    case 'rescue': {
      const weak = weakest(topics, checks, 2);
      return { topics: weak, kinds: [{ kind: 'mcq', count: 4 }], perTopic: null };
    }
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
      return [{ id: q.id, topicId: q.topicId, topic: q.topic, label: q.label, sub: `Missed ${weekdayShort(p.day)}${later ? ', then right' : ''}` }];
    })
    .reverse()
    .slice(0, 10);
}

const ORDER: Record<Outcome, number> = { mixup: 0, gap: 1, shaky: 2, solid: 3 };
const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** After a diagnostic: one calm line per topic, from its answers and their skills. Mix-ups and gaps first. */
export function diagnosis(p: PracticeRecord, laterToday: boolean): { topicId: string; topic: string; outcome: Outcome; line: string }[] {
  const byTopic = new Map<string, { topic: string; answers: { skill: string; outcome: Outcome }[] }>();
  for (const q of p.questions) {
    const a = p.answers[q.id];
    if (a?.kind !== 'mcq') continue;
    const entry = byTopic.get(q.topicId) ?? { topic: q.topic, answers: [] };
    entry.answers.push({ skill: q.skill, outcome: a.outcome });
    byTopic.set(q.topicId, entry);
  }
  const back = laterToday ? 'comes back later today' : 'comes back soon';
  return [...byTopic.entries()]
    .map(([topicId, { topic, answers }]) => {
      const has = (o: Outcome) => answers.some((a) => a.outcome === o);
      const outcome: Outcome = has('mixup') ? 'mixup' : has('gap') && !has('solid') ? 'gap' : has('gap') || has('shaky') ? 'shaky' : 'solid';
      const solidSkill = (s: string) => answers.some((a) => a.skill === s && a.outcome === 'solid');
      const weakSkill = (s: string) => answers.some((a) => a.skill === s && a.outcome !== 'solid');
      const line =
        outcome === 'mixup' ? `You were sure about a wrong answer on ${topic}, so Loomer fixes that first.`
        : outcome === 'gap' ? `${capFirst(topic)} isn't learned yet, so Loomer teaches it next.`
        : outcome === 'solid' ? `${capFirst(topic)} looks strong so far.`
        : solidSkill('remember') && weakSkill('understand') ? `You know the facts of ${topic}, but its causes are shaky, so Loomer starts with why it happened.`
        : solidSkill('remember') && weakSkill('apply') ? `You know ${topic}, but using it on a new case is shaky, so Loomer practices that next.`
        : `You got ${topic} partly right or guessed, so it ${back}.`;
      return { topicId, topic, outcome, line };
    })
    .sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome]);
}

/** Matches the AI's topic name to one of the test's topics. */
export function matchTopic(name: string, topics: Active[]): Active {
  const key = topicKey(name);
  return topics.find((t) => topicKey(t.text) === key) ?? topics.find((t) => key.includes(topicKey(t.text)) || topicKey(t.text).includes(key)) ?? topics[0]!;
}
