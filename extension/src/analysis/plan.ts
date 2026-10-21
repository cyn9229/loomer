// The planner. Pure, inspectable rules (adapted from Xccelerate's bucketed
// next-up order and Plum's explain-every-rank contract), with Loomer's limits:
// no time tracking, no grades, no scores shown to the student. Loomer never
// estimates how long a task takes; it may use and repeat the student's OWN
// numbers (their guess for a task, the time they have on a day).
//
// 1. Checkpoints from the instructions become earlier targets.
// 2. Start-by = earliest upcoming checkpoint (or due date) minus lead time by
//    workload. A start day the student picked (startOn) is used as given. With
//    the student's own time guess, start-by counts back from the target through
//    each day's free minutes until the guess is covered.
// 3. Placement: each day holds starts up to the room the student gave it
//    (workload dots). Too many: the start with the latest due date moves one
//    day earlier, repeated. Never later, never before today.
// 4. Items sort into start-by buckets: today, tomorrow, within 3 days, later.
//    Inside a bucket: earlier due first, then bigger work, then earlier start-by.
// 5. Every ranked item carries a one-sentence reason with the concrete fact; the top stays put unless
//    the evidence moves it out of its bucket (calm re-ranking).
import type { Milestone } from '../core/db';
import type { Checkpoint, DayRoom, EffortLabel, RoomLevel, StartBy } from '../model/home';

const DAY_MS = 86_400_000;
/**
 * Days of lead time per effort label. A starting rule, not a duration estimate.
 * Even quick tasks get a day, so work due tomorrow is started today.
 */
export const LEAD_DAYS: Record<EffortLabel, number> = { Short: 1, Moderate: 2, Substantial: 4, Unknown: 2 };
/** Workload dots: Light 1, Medium 2, Heavy 3, unknown 2. Orders bigger work first and fills a day's room. */
const SIZE: Record<EffortLabel, number> = { Substantial: 3, Moderate: 2, Unknown: 2, Short: 1 };
/** Minutes a day gives guessed work when the student gave no number for it. Editable in settings. */
export type LevelMinutes = { some: number; little: number };
export const DEFAULT_LEVEL_MINUTES: LevelMinutes = { some: 120, little: 30 };
/** A free day's minutes until the student says what a normal day has. */
const FREE_DAY_FALLBACK_MINUTES = 120;
/** Dots of starts a day holds. One start always fits on a day that is not busy. */
const ROOM_DOTS: Record<RoomLevel, number> = { free: Number.POSITIVE_INFINITY, some: 2, little: 1, busy: 0 };
/** Two bigger items whose start-by dates fall this close together make a crowded stretch. */
const CROWDED_WINDOW_DAYS = 2;
const CROWDED_LOOKAHEAD_DAYS = 7;

export type PlanBucket = 'today' | 'tomorrow' | 'soon' | 'later';
const BUCKET_ORDER: Record<PlanBucket, number> = { today: 0, tomorrow: 1, soon: 2, later: 3 };
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);

/** What the planner needs to know about one rankable item. */
export type PlanEntry = {
  id: string;
  title: string;
  /** How sentences name it: "this essay". */
  noun: string;
  due: string | null;
  effort: EffortLabel;
  milestones: Milestone[];
  /** The student kept it active: rank it even without a due date. */
  keptActive: boolean;
  /** Local date (YYYY-MM-DD) the student picked to start. Used as given, never moved. */
  startOn: string | null;
  /** The student's own guess for the whole task, in minutes. */
  guessMinutes: number | null;
};

/** Why a start is not on the day the lead-time rule gave it. */
export type Placement =
  /** Moved earlier because the student said `from` had too little room. */
  | { kind: 'moved'; from: string; level: RoomLevel }
  /** The student picked the day; `daysLeft` is set only when it is later than Loomer's start-by. */
  | { kind: 'student'; daysLeft: number | null }
  /** Counted back from the student's guess. `short`: the days before the target have less time than the guess. */
  | { kind: 'guess'; minutes: number; short: boolean };

export type Planned = PlanEntry & {
  checkpoints: Checkpoint[];
  nextCheckpoint: Checkpoint | null;
  startBy: StartBy | null;
  bucket: PlanBucket;
  placement: Placement | null;
  /** The start day is over the room the student gave it and nothing could move (today, or only fixed starts). */
  overFull: { date: string; level: RoomLevel } | null;
};

/** The room for one local date. Days without an entry are free. */
export type RoomFor = (date: string) => DayRoom;
export const freeRoom: RoomFor = (date) => ({ date, level: 'free', minutes: null, repeating: false });

/** Local calendar day index, so "today" means the student's today, not UTC. */
export const dayIndex = (t: number) => {
  const d = new Date(t);
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS));
};

/** Local YYYY-MM-DD for a day index, and back. */
export const dateOfDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const dayOfDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
};
/** Local noon of a day: a start time that stays on that day across DST changes. */
const noonOf = (day: number) => {
  const [y, m, d] = dateOfDay(day).split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12).getTime();
};
const bucketOf = (days: number): PlanBucket => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 3 ? 'soon' : 'later');

/** End of a local calendar day, for date-only checkpoints. */
const endOfLocalDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 23, 59).getTime();
};

/** A tile label for a checkpoint from an older analysis: "Draft due", "Outline due", or "Step due". */
function checkpointLabel(text: string): string {
  const noun = /\b(draft|outline|proposal|thesis|bibliography|presentation|peer review)\b/i.exec(text)?.[1];
  return noun ? `${noun.charAt(0).toUpperCase()}${noun.slice(1).toLowerCase()} due` : 'Step due';
}

/** Checkpoints with real dates: stated dates, or a stated number of days before the due date. */
export function checkpointsFor(e: PlanEntry): Checkpoint[] {
  const due = e.due ? Date.parse(e.due) : null;
  return e.milestones
    .flatMap((m) => {
      const at = m.date ? endOfLocalDay(m.date) : due !== null && m.daysBeforeDue != null ? due - m.daysBeforeDue * DAY_MS : null;
      if (at === null || (due !== null && at > due)) return [];
      return [{ text: m.text, label: m.label ?? checkpointLabel(m.text), at: new Date(at).toISOString(), quote: m.quote, derived: !m.date }];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function plan(entries: PlanEntry[], now: Date, roomFor: RoomFor = freeRoom, levelMinutes: LevelMinutes = DEFAULT_LEVEL_MINUTES): Planned[] {
  const today = dayIndex(now.getTime());
  const targets = new Map(
    entries.map((e) => {
      const checkpoints = checkpointsFor(e);
      const nextCheckpoint = checkpoints.find((c) => Date.parse(c.at) >= now.getTime()) ?? null;
      const target = nextCheckpoint ? Date.parse(nextCheckpoint.at) : e.due ? Date.parse(e.due) : null;
      return [e.id, { checkpoints, nextCheckpoint, target }] as const;
    }),
  );
  const guessed = guessStarts(entries, targets, today, roomFor, levelMinutes);

  const planned = entries.map((e): Planned => {
    const { checkpoints, nextCheckpoint, target } = targets.get(e.id)!;
    const leadAt = target === null ? null : target - LEAD_DAYS[e.effort] * DAY_MS;
    const base = { ...e, checkpoints, nextCheckpoint, overFull: null };
    if (e.startOn) {
      const day = dayOfDate(e.startOn);
      const later = leadAt !== null && day > dayIndex(leadAt);
      const daysLeft = later && e.due ? dayIndex(Date.parse(e.due)) - day : null;
      return { ...base, startBy: { at: new Date(noonOf(day)).toISOString(), basis: 'student' }, bucket: bucketOf(day - today), placement: { kind: 'student', daysLeft } };
    }
    if (leadAt === null) return { ...base, startBy: null, bucket: e.keptActive ? 'soon' : 'later', placement: null };
    const basis = nextCheckpoint ? 'checkpoint' : 'due';
    const guess = guessed.get(e.id);
    if (guess) return { ...base, startBy: { at: new Date(noonOf(guess.day)).toISOString(), basis }, bucket: bucketOf(guess.day - today), placement: guess.placement };
    return { ...base, startBy: { at: new Date(leadAt).toISOString(), basis }, bucket: bucketOf(dayIndex(leadAt) - today), placement: null };
  });
  return place(planned, today, roomFor).sort(comparePlanned);
}

/** A day's minutes for guessed work: the student's own number, else the level's time. */
function dayMinutes(room: DayRoom, levelMinutes: LevelMinutes): number {
  if (room.level === 'busy') return 0;
  if (room.minutes !== null) return room.minutes;
  return room.level === 'free' ? FREE_DAY_FALLBACK_MINUTES : levelMinutes[room.level];
}

/**
 * Start days for work with the student's own guess. Counts back from the day
 * before the target, adding each day's minutes until the guess is covered.
 * When guessed tasks share days, the earlier target takes the time first.
 */
function guessStarts(
  entries: PlanEntry[],
  targets: Map<string, { target: number | null }>,
  today: number,
  roomFor: RoomFor,
  levelMinutes: LevelMinutes,
): Map<string, { day: number; placement: Placement }> {
  const left = new Map<number, number>();
  const minutesOn = (d: number) => left.get(d) ?? dayMinutes(roomFor(dateOfDay(d)), levelMinutes);
  const out = new Map<string, { day: number; placement: Placement }>();
  const withGuess = entries
    .flatMap((e) => {
      const target = targets.get(e.id)?.target;
      return e.guessMinutes && !e.startOn && target != null ? [{ e, guess: e.guessMinutes, targetDay: dayIndex(target) }] : [];
    })
    .sort((a, b) => a.targetDay - b.targetDay || a.e.id.localeCompare(b.e.id));
  for (const { e, guess, targetDay } of withGuess) {
    let need = guess;
    let day = today;
    for (let d = targetDay - 1; d >= today && need > 0; d--) {
      const take = Math.min(minutesOn(d), need);
      left.set(d, minutesOn(d) - take);
      need -= take;
      day = d;
    }
    out.set(e.id, { day: Math.max(day, today), placement: { kind: 'guess', minutes: guess, short: need > 0 } });
  }
  return out;
}

/**
 * Fits starts into the room the student gave each day. Works from the last
 * start day back to today: while a day holds more workload dots than its room,
 * the movable start with the latest due date moves one day earlier. Student-
 * picked days never move. Nothing moves later or before today; a day that stays
 * too full is marked over-full so Home can say so.
 */
function place(planned: Planned[], today: number, roomFor: RoomFor): Planned[] {
  const startDay = new Map<string, number>();
  for (const p of planned) if (p.startBy) startDay.set(p.id, Math.max(dayIndex(Date.parse(p.startBy.at)), today));
  if (startDay.size === 0) return planned;
  const moved = new Map<string, Placement>();
  const overFull = new Map<string, Planned['overFull']>();
  // The student's own start day and their guess-based start are never moved.
  const movable = (p: Planned) => p.placement === null || p.placement.kind === 'moved';

  for (let d = Math.max(...startDay.values()); d >= today; d--) {
    const room = roomFor(dateOfDay(d));
    for (;;) {
      const here = planned.filter((p) => startDay.get(p.id) === d);
      const dots = here.reduce((n, p) => n + SIZE[p.effort], 0);
      const fits = room.level === 'busy' ? here.length === 0 : here.length <= 1 || dots <= ROOM_DOTS[room.level];
      if (fits) break;
      const candidate = here.filter(movable).sort((a, b) => time(b.due) - time(a.due) || b.id.localeCompare(a.id))[0];
      if (!candidate || d === today) {
        for (const p of here) overFull.set(p.id, { date: dateOfDay(d), level: room.level });
        break;
      }
      startDay.set(candidate.id, d - 1);
      if (!moved.has(candidate.id)) moved.set(candidate.id, { kind: 'moved', from: dateOfDay(d), level: room.level });
    }
  }

  return planned.map((p) => {
    const day = startDay.get(p.id);
    if (day === undefined || !p.startBy) return p;
    const move = moved.get(p.id);
    const placed = move ? { ...p, startBy: { ...p.startBy, at: new Date(noonOf(day)).toISOString() }, bucket: bucketOf(day - today), placement: move } : p;
    return { ...placed, overFull: overFull.get(p.id) ?? null };
  });
}

/** Bucket, then earlier due, then bigger work, then earlier start-by. */
export function comparePlanned(a: Planned, b: Planned): number {
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

/** Checkpoint text arrives as its own sentence ("Submit a draft"); mid-sentence it needs a lowercase start. */
export const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
/** "Wed", for tight spots. */
const weekday = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
/** "Wednesday", for sentences. */
export const weekdayLong = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });

/** "45 min", "2 h", "1 h 30 min": the student's own number, said back. */
export function minutesWords(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "45 minutes", "3 hours", "1 hour 30 minutes": the same number, for sentences. */
export function minutesLong(n: number): string {
  const unit = (v: number, one: string) => `${v} ${one}${v === 1 ? '' : 's'}`;
  if (n < 60) return unit(n, 'minute');
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${unit(h, 'hour')} ${unit(m, 'minute')}` : unit(h, 'hour');
}

/**
 * A due time for sentences: "Thursday at 7:59 PM" within the coming week,
 * "Thursday, Oct 22" further out or in the past.
 */
export function dueWords(iso: string, now: Date): string {
  const d = new Date(iso);
  const days = (d.getTime() - now.getTime()) / DAY_MS;
  if (days < 0 || days > 6) return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return `${weekdayLong(iso)} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** The panel's workload words for each label. */
export const WORKLOAD_WORDS: Record<EffortLabel, string> = { Short: 'Light', Moderate: 'Medium', Substantial: 'Heavy', Unknown: 'Unknown' };
export const dayName = (ymd: string) => weekdayLong(new Date(noonOf(dayOfDate(ymd))).toISOString());
export const roomWords: Record<RoomLevel, string> = { busy: 'is busy', little: 'has little room', some: 'only has some room', free: 'is free' };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const daysFrom = (iso: string, now: Date) => dayIndex(Date.parse(iso)) - dayIndex(now.getTime());

/** "today", "tomorrow", "Thursday" in the coming week, else "Thursday, Oct 29". */
export function dayWords(iso: string, now: Date): string {
  const n = daysFrom(iso, now);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n <= 6) return weekdayLong(iso);
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** "today", "tomorrow", or "by Wednesday": when to start, for "starting ___". */
const startWhen = (p: Planned) => (!p.startBy || p.bucket === 'today' ? 'today' : p.bucket === 'tomorrow' ? 'tomorrow' : `by ${weekdayLong(p.startBy.at)}`);

/** The end of a sentence that says when to start: "so today is a good day to start". */
export function startClause(p: Planned): string {
  if (p.placement?.kind === 'student' && p.startBy) return `and you picked ${p.bucket === 'today' ? 'today' : weekdayLong(p.startBy.at)} to start`;
  const when = startWhen(p);
  return when.startsWith('by ') ? `so start ${when}` : `so ${when} is a good day to start`;
}

/**
 * Why one item starts when it does, as one sentence that names it and gives
 * the concrete fact: "This essay is due Friday, 6 days from now, so today is a
 * good day to start." The student's own facts (a picked day, a busy day, their
 * guess) come first when they apply. Never a workload word.
 */
export function startReason(p: Planned, now: Date): string {
  const pl = p.placement;
  if (pl?.kind === 'student' && p.startBy) {
    const picked = `You picked ${weekdayLong(p.startBy.at)} to start ${p.noun}`;
    if (pl.daysLeft === null) return `${picked}.`;
    return pl.daysLeft <= 0 ? `${picked}, which is the day it's due.` : `${picked}, which leaves ${pl.daysLeft} ${pl.daysLeft === 1 ? 'day' : 'days'} before it's due.`;
  }
  if (pl?.kind === 'moved' && p.startBy) return `${cap(p.noun)} starts ${dayWords(p.startBy.at, now)} because you said ${dayName(pl.from)} ${roomWords[pl.level]}.`;
  if (pl?.kind === 'guess') {
    const starting = `Starting ${p.noun} ${startWhen(p)}`;
    return pl.short
      ? `${starting} helps, though your guess of about ${minutesLong(pl.minutes)} is more than the days before it have.`
      : `${starting} leaves time for your guess of about ${minutesLong(pl.minutes)}.`;
  }
  if (!p.startBy || !p.due) return p.keptActive ? `You kept ${p.noun} active, so it stays on your plan.` : `Loomer didn't find a due date for ${p.noun}.`;
  if (p.nextCheckpoint) return `The next step for ${p.noun}, ${lowerFirst(p.nextCheckpoint.text)}, is due ${dayWords(p.nextCheckpoint.at, now)}, ${startClause(p)}.`;
  const n = daysFrom(p.due, now);
  if (n < 0) return `${cap(p.noun)} was due ${dayWords(p.due, now)}, so it's worth finishing soon.`;
  if (n === 0) return `${cap(p.noun)} is due today at ${new Date(p.due).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}, so finish it today.`;
  return `${cap(p.noun)} is due ${n === 1 ? 'tomorrow' : `${dayWords(p.due, now)}, ${n} days from now`}, ${startClause(p)}.`;
}

/**
 * One sentence per ranked item. When the first two follow Loomer's own start
 * rule, they say how they compare instead.
 */
export function rankReasons(ranked: Planned[], now: Date): Map<string, string> {
  const reasons = new Map<string, string>();
  const [first, second] = ranked;
  ranked.forEach((p, i) => {
    const own = p.placement === null && p.startBy;
    if (i === 0 && own && second?.due && p.due && Date.parse(second.due) < Date.parse(p.due)) {
      reasons.set(p.id, `${second.title} is due sooner, but ${p.noun} needs more days, ${startClause(p)}.`);
    } else if (i === 1 && own && first) reasons.set(p.id, `${cap(p.noun)} comes second because ${first.title} needs to start first.`);
    else reasons.set(p.id, startReason(p, now));
  });
  return reasons;
}

const listNames = (items: Planned[]) => (items.length === 1 ? items[0]!.title : `${items.slice(0, -1).map((p) => p.title).join(', ')} and ${items.at(-1)!.title}`);

/**
 * A heads-up, not a rule. First: a day that is over the room the student gave
 * it and nothing could move. Otherwise: two bigger items needing a start within
 * two days of each other in the coming week.
 */
export function crowdedWeek(ranked: Planned[], now: Date): { text: string; assignmentIds: string[] } | null {
  const firstDate = ranked.flatMap((p) => (p.overFull ? [p.overFull.date] : [])).sort()[0];
  if (firstDate) {
    const items = ranked.filter((p) => p.overFull?.date === firstDate);
    const when = dayOfDate(firstDate) === dayIndex(now.getTime()) ? 'today' : dayName(firstDate);
    const then = when === 'today' ? 'today' : 'then';
    const who = items.length === 1 ? `${items[0]!.title} needs to start ${then}, so move it or plan time` : `${listNames(items)} ${items.length === 2 ? 'both' : 'all'} need to start ${then}, so move one or plan time`;
    return { text: `You said ${when} ${roomWords[items[0]!.overFull!.level]}, but ${who}.`, assignmentIds: items.map((p) => p.id) };
  }
  const horizon = now.getTime() + CROWDED_LOOKAHEAD_DAYS * DAY_MS;
  const big = ranked
    .filter((p) => (p.effort === 'Substantial' || p.effort === 'Moderate') && p.startBy && Date.parse(p.startBy.at) <= horizon)
    .sort((a, b) => time(a.startBy!.at) - time(b.startBy!.at));
  for (let i = 0; i + 1 < big.length; i++) {
    const a = big[i]!;
    const b = big[i + 1]!;
    const dayA = dayIndex(Date.parse(a.startBy!.at));
    const dayB = dayIndex(Date.parse(b.startBy!.at));
    if (Math.abs(dayB - dayA) <= CROWDED_WINDOW_DAYS) {
      // Several things can start on one day; this only flags the load so the student plans time for it.
      const text =
        dayA === dayB
          ? `${a.title} and ${b.title} both need to start ${weekdayLong(a.startBy!.at)}, so plan time for both.`
          : `${weekdayLong(a.startBy!.at)} and ${weekdayLong(b.startBy!.at)} are busy, because ${a.title} and ${b.title} both need to start then.`;
      return { text, assignmentIds: [a.id, b.id] };
    }
  }
  return null;
}

/** The first-open-of-the-day sentence. Facts from the plan only; no AI. */
export function dailyBrief(ranked: Planned[], now: Date): string {
  const today = dayIndex(now.getTime());
  const dueIn = (n: number) => ranked.filter((p) => p.due && dayIndex(Date.parse(p.due)) - today === n).length;
  const startToday = ranked.filter((p) => p.bucket === 'today' && (!p.due || dayIndex(Date.parse(p.due)) - today > 1));
  const things = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`;
  const due = [dueIn(0) ? `${things(dueIn(0))} due today` : null, dueIn(1) ? `${dueIn(0) ? dueIn(1) : things(dueIn(1))} due tomorrow` : null].filter(Boolean).join(' and ');
  const start = startToday[0] ? `Loomer suggests starting ${startToday[0].title}${startToday.length > 1 ? ` and ${startToday.length - 1} more` : ''} today` : null;
  if (due && start) return `You have ${due}, and ${start}.`;
  if (due) return `You have ${due}.`;
  if (start) return `${start}.`;
  return 'Nothing needs to start today.';
}

/** Local calendar date as YYYY-MM-DD, used to show the brief once per day. */
export function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
