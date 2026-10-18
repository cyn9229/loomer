// The planner. Pure, inspectable rules (adapted from Xccelerate's bucketed
// next-up order and Plum's explain-every-rank contract), with Loomer's limits:
// no time tracking, no minutes, no grades, no scores shown to the student.
//
// 1. Checkpoints from the instructions become earlier targets.
// 2. Start-by = earliest upcoming checkpoint (or due date) minus lead time by effort.
// 3. Items sort into start-by buckets: today, tomorrow, within 3 days, later.
//    Inside a bucket: earlier due first, then bigger work, then earlier start-by.
// 4. Every ranked item carries a plain-words reason; the top stays put unless
//    the evidence moves it out of its bucket (calm re-ranking).
import type { Milestone } from '../core/db';
import type { Checkpoint, EffortLabel, StartBy } from '../model/home';

const DAY_MS = 86_400_000;
/**
 * Days of lead time per effort label. A starting rule, not a duration estimate.
 * Even quick tasks get a day, so work due tomorrow is started today.
 */
export const LEAD_DAYS: Record<EffortLabel, number> = { Short: 1, Moderate: 2, Substantial: 4, Unknown: 2 };
const SIZE: Record<EffortLabel, number> = { Substantial: 3, Moderate: 2, Unknown: 2, Short: 1 };
/** Two bigger items whose start-by dates fall this close together make a crowded stretch. */
const CROWDED_WINDOW_DAYS = 2;
const CROWDED_LOOKAHEAD_DAYS = 7;

export type PlanBucket = 'today' | 'tomorrow' | 'soon' | 'later';
const BUCKET_ORDER: Record<PlanBucket, number> = { today: 0, tomorrow: 1, soon: 2, later: 3 };

/** What the planner needs to know about one rankable item. */
export type PlanEntry = {
  id: string;
  title: string;
  due: string | null;
  effort: EffortLabel;
  milestones: Milestone[];
  /** The student kept it active: rank it even without a due date. */
  keptActive: boolean;
};

export type Planned = PlanEntry & { checkpoints: Checkpoint[]; nextCheckpoint: Checkpoint | null; startBy: StartBy | null; bucket: PlanBucket };

/** Local calendar day index, so "today" means the student's today, not UTC. */
const dayIndex = (t: number) => {
  const d = new Date(t);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS));
};

/** End of a local calendar day, for date-only checkpoints. */
const endOfLocalDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 23, 59).getTime();
};

/** Checkpoints with real dates: stated dates, or a stated number of days before the due date. */
export function checkpointsFor(e: PlanEntry): Checkpoint[] {
  const due = e.due ? Date.parse(e.due) : null;
  return e.milestones
    .flatMap((m) => {
      const at = m.date ? endOfLocalDay(m.date) : due !== null && m.daysBeforeDue != null ? due - m.daysBeforeDue * DAY_MS : null;
      if (at === null || (due !== null && at > due)) return [];
      return [{ text: m.text, at: new Date(at).toISOString(), quote: m.quote, derived: !m.date }];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function plan(entries: PlanEntry[], now: Date): Planned[] {
  const today = dayIndex(now.getTime());
  const planned = entries.map((e): Planned => {
    const checkpoints = checkpointsFor(e);
    const nextCheckpoint = checkpoints.find((c) => Date.parse(c.at) >= now.getTime()) ?? null;
    const target = nextCheckpoint ? Date.parse(nextCheckpoint.at) : e.due ? Date.parse(e.due) : null;
    if (target === null) return { ...e, checkpoints, nextCheckpoint, startBy: null, bucket: e.keptActive ? 'soon' : 'later' };
    const startAt = target - LEAD_DAYS[e.effort] * DAY_MS;
    const days = dayIndex(startAt) - today;
    const bucket: PlanBucket = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 3 ? 'soon' : 'later';
    return { ...e, checkpoints, nextCheckpoint, startBy: { at: new Date(startAt).toISOString(), basis: nextCheckpoint ? 'checkpoint' : 'due' }, bucket };
  });
  return planned.sort(comparePlanned);
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);

function comparePlanned(a: Planned, b: Planned): number {
  return (
    BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
    time(a.due) - time(b.due) ||
    SIZE[b.effort] - SIZE[a.effort] ||
    time(a.startBy?.at) - time(b.startBy?.at) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Calm re-ranking: if the previous top is still in the top bucket, it stays on
 * top. Only a change that moves it out of that bucket (a new date, new
 * requirements, done or hidden) changes the top.
 */
export function keepPreviousTop(ranked: Planned[], previousTopId: string | null): Planned[] {
  const top = ranked[0];
  const prev = ranked.find((p) => p.id === previousTopId);
  if (!top || !prev || prev === top || prev.bucket !== top.bucket) return ranked;
  return [prev, ...ranked.filter((p) => p !== prev)];
}

const weekday = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
const effortWords: Record<EffortLabel, string> = { Substantial: 'big assignment', Moderate: 'medium assignment', Short: 'quick task', Unknown: 'size not known yet' };

/** "Start today", "Start tomorrow", or "Start by Wed". */
export function startPhrase(p: Planned): string {
  if (!p.startBy) return p.keptActive ? 'You kept this active' : 'No due date found';
  return p.bucket === 'today' ? 'Start today' : p.bucket === 'tomorrow' ? 'Start tomorrow' : `Start by ${weekday(p.startBy.at)}`;
}

/** One plain-words reason per ranked item; the second also says why it is not first. */
export function rankReasons(ranked: Planned[]): Map<string, string> {
  const reasons = new Map<string, string>();
  ranked.forEach((p, i) => {
    const target = p.nextCheckpoint ? `${p.nextCheckpoint.text} by ${weekday(p.nextCheckpoint.at)}` : p.due ? `due ${weekday(p.due)}` : 'no due date';
    const base = `${startPhrase(p)}: ${effortWords[p.effort]}, ${target}.`;
    const runnerUp = ranked[1];
    if (i === 0 && runnerUp?.due && p.due && Date.parse(runnerUp.due) < Date.parse(p.due)) {
      reasons.set(p.id, `${base} ${runnerUp.title} is due sooner, but this needs the earlier start.`);
    } else if (i === 1 && ranked[0]) reasons.set(p.id, `${base} Second because ${ranked[0].title} needs a start ${ranked[0].bucket === 'today' ? 'today' : `by ${ranked[0].startBy ? weekday(ranked[0].startBy.at) : 'soon'}`}.`);
    else reasons.set(p.id, base);
  });
  return reasons;
}

/** Two bigger items needing a start within two days of each other in the coming week. */
export function crowdedWeek(ranked: Planned[], now: Date): { text: string; assignmentIds: string[] } | null {
  const horizon = now.getTime() + CROWDED_LOOKAHEAD_DAYS * DAY_MS;
  const big = ranked
    .filter((p) => (p.effort === 'Substantial' || p.effort === 'Moderate') && p.startBy && Date.parse(p.startBy.at) <= horizon)
    .sort((a, b) => time(a.startBy!.at) - time(b.startBy!.at));
  for (let i = 0; i + 1 < big.length; i++) {
    const a = big[i]!;
    const b = big[i + 1]!;
    if (Math.abs(dayIndex(Date.parse(b.startBy!.at)) - dayIndex(Date.parse(a.startBy!.at))) <= CROWDED_WINDOW_DAYS) {
      const later = time(a.due) > time(b.due) ? a : b;
      return {
        text: `${a.title} and ${b.title} both need a start by ${weekday(b.startBy!.at)}. Starting ${later.title} sooner gives each its own days.`,
        assignmentIds: [a.id, b.id],
      };
    }
  }
  return null;
}

/** The first-open-of-the-day sentence. Facts from the plan only; no AI. */
export function dailyBrief(ranked: Planned[], now: Date): string {
  const today = dayIndex(now.getTime());
  const dueIn = (n: number) => ranked.filter((p) => p.due && dayIndex(Date.parse(p.due)) - today === n).length;
  const startToday = ranked.filter((p) => p.bucket === 'today' && (!p.due || dayIndex(Date.parse(p.due)) - today > 1));
  const parts: string[] = [];
  const dueToday = dueIn(0);
  const dueTomorrow = dueIn(1);
  if (dueToday) parts.push(`${dueToday} due today`);
  if (dueTomorrow) parts.push(`${dueTomorrow} due tomorrow`);
  if (startToday[0]) parts.push(`start ${startToday[0].title} today${startToday.length > 1 ? ` (and ${startToday.length - 1} more)` : ''}`);
  if (parts.length === 0) return 'Nothing needs a start today.';
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Local calendar date as YYYY-MM-DD, used to show the brief once per day. */
export function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
