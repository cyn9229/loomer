import { describe, expect, it } from 'vitest';
import type { RoomLevel } from '../model/home';
import { checkpointsFor, crowdedWeek, dailyBrief, dayOfDate, keepPreviousTop, localDay, plan, rankReasons, type PlanEntry } from './plan';
import { roomLookup } from './room';

// Saturday noon, local time, so day buckets are stable.
const now = new Date(2026, 9, 17, 12, 0);
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const entry = (id: string, dueDays: number | null, effort: PlanEntry['effort'], over: Partial<PlanEntry> = {}): PlanEntry => ({
  id,
  title: id,
  due: dueDays === null ? null : inDays(dueDays),
  effort,
  milestones: [],
  keptActive: false,
  startOn: null,
  guessMinutes: null,
  ...over,
});
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('checkpoints', () => {
  it('computes dates from stated days before the deadline, keeps stated dates, and drops ones after the due date', () => {
    const e = entry('essay', 5, 'Substantial', {
      milestones: [
        { text: 'Draft for peer review', quote: 'the day before the final deadline', date: null, daysBeforeDue: 1 },
        { text: 'Proposal', quote: 'Proposal due Oct 19', date: '2026-10-19', daysBeforeDue: null },
        { text: 'Too late', quote: 'x', date: '2026-12-01', daysBeforeDue: null },
        { text: 'No date', quote: 'y' },
      ],
    });
    const cps = checkpointsFor(e);
    expect(cps.map((c) => [c.text, c.derived])).toEqual([
      ['Proposal', false],
      ['Draft for peer review', true],
    ]);
    expect(cps[1]!.at).toBe(inDays(4));
  });
});

describe('plan', () => {
  it('keeps checkpoint text lowercase inside the reason sentence', () => {
    const ranked = plan([entry('essay', 6, 'Substantial', { milestones: [{ text: 'Submit a full draft', quote: 'q', date: null, daysBeforeDue: 2 }] })], now);
    expect(rankReasons(ranked).get('essay')).toMatch(/^Start today because it's a heavy one and its next step, submit a full draft, is due \w+day\.$/);
  });

  it('starts from the next checkpoint, not the final due date', () => {
    const [p] = plan([entry('essay', 6, 'Substantial', { milestones: [{ text: 'Draft', quote: 'q', date: null, daysBeforeDue: 2 }] })], now);
    expect(p!.startBy).toEqual({ at: inDays(0), basis: 'checkpoint' });
    expect(p!.bucket).toBe('today');
  });

  it('orders by start-by bucket, then earlier due, then bigger work', () => {
    const ranked = plan(
      [
        entry('later-small', 9, 'Short'),
        entry('essay', 3, 'Substantial'), // start by day -1: today
        entry('quiz', 1, 'Short'), // start by day 0: today, due sooner
        entry('lab', 3, 'Moderate'), // start by day 1: tomorrow
      ],
      now,
    );
    expect(ids(ranked)).toEqual(['quiz', 'essay', 'lab', 'later-small']);
    expect(ranked.map((p) => p.bucket)).toEqual(['today', 'today', 'tomorrow', 'later']);
  });

  it('ranks undated work only when kept active', () => {
    expect(plan([entry('undated', null, 'Unknown', { keptActive: true })], now)[0]).toMatchObject({ startBy: null, bucket: 'soon' });
  });
});

describe('calm re-ranking', () => {
  it('keeps the previous top while it stays in the top bucket, and lets an earlier bucket take over', () => {
    const ranked = plan([entry('a', 1, 'Short'), entry('b', 3, 'Substantial')], now);
    expect(ids(keepPreviousTop(ranked, 'b'))).toEqual(['b', 'a']);
    const moved = plan([entry('a', 1, 'Short'), entry('b', 8, 'Substantial')], now);
    expect(ids(keepPreviousTop(moved, 'b'))).toEqual(['a', 'b']);
  });
});

describe('reasons, crowded week, brief', () => {
  const ranked = plan([entry('Essay', 4, 'Substantial'), entry('Lab report', 5, 'Substantial'), entry('Quiz', 1, 'Short')], now);

  it('gives every ranked item a plain reason, and says why the second is second', () => {
    const reasons = rankReasons(ranked);
    expect(reasons.get('Quiz')).toMatch(/^Start today because it's a light one and it's due \w+day\.$/);
    expect(reasons.get('Essay')).toMatch(/ This comes second because Quiz needs to start first\.$/);
  });

  it('warns when two big assignments need a start within two days', () => {
    const crowded = crowdedWeek(ranked, now);
    expect(crowded).toMatchObject({ assignmentIds: ['Essay', 'Lab report'] });
    expect(crowded?.text).toMatch(/^\w+day and \w+day are busy, because Essay and Lab report both need to start then\.$/);
    expect(crowdedWeek(plan([entry('Essay', 4, 'Substantial'), entry('Lab report', 12, 'Substantial')], now), now)).toBeNull();
  });

  it('summarizes today without numbers about time or grades', () => {
    // The quiz is due tomorrow, so it is counted there, not repeated as "start today".
    expect(dailyBrief(ranked, now)).toBe('You have 1 thing due tomorrow, and Loomer suggests starting Essay today.');
    expect(dailyBrief(plan([entry('Far', 20, 'Short')], now), now)).toBe('Nothing needs to start today.');
  });
});

describe('room placement', () => {
  // now is Saturday Oct 17; day n is n days later.
  const dateIn = (d: number) => localDay(new Date(now.getTime() + d * 86_400_000));
  const rooms = (levels: Record<number, RoomLevel>, weekly: Record<number, RoomLevel> = {}) =>
    roomLookup([
      ...Object.entries(levels).map(([d, level]) => ({ key: `date:${dateIn(Number(d))}`, level, minutes: null, setAt: '' })),
      ...Object.entries(weekly).map(([w, level]) => ({ key: `weekday:${w}`, level, minutes: null, setAt: '' })),
    ]);
  const startDays = (ranked: { id: string; startBy: { at: string } | null }[]) =>
    Object.fromEntries(ranked.map((p) => [p.id, p.startBy ? Math.round((dayOfDate(localDay(new Date(p.startBy.at))) - dayOfDate(localDay(now)))) : null]));

  it('moves a start off a busy day to the day before, and says why', () => {
    // Essay: due day 6, Heavy, starts day 2.
    const ranked = plan([entry('Essay', 6, 'Substantial')], now, rooms({ 2: 'busy' }));
    expect(startDays(ranked)).toEqual({ Essay: 1 });
    expect(rankReasons(ranked).get('Essay')).toMatch(/^Start tomorrow because you said Monday is busy\.$/);
  });

  it('fills a day by workload dots, moving the latest-due start, and one start always fits', () => {
    // Both start day 3. Little room (1 dot): two Light starts do not fit, so the later due moves to day 2.
    const lights = plan([entry('Vocab', 4, 'Short'), entry('Reading', 5, 'Moderate', { startOn: null })], now, rooms({ 3: 'little' }));
    expect(startDays(lights)).toEqual({ Vocab: 3, Reading: 2 });
    // One Heavy start alone on a little day still fits.
    expect(startDays(plan([entry('Essay', 7, 'Substantial')], now, rooms({ 3: 'little' })))).toEqual({ Essay: 3 });
    // Some room (2 dots) holds two Light starts.
    expect(startDays(plan([entry('A', 4, 'Short'), entry('B', 4, 'Short')], now, rooms({ 3: 'some' })))).toEqual({ A: 3, B: 3 });
  });

  it('never moves a start later or before today, and flags a full today', () => {
    const ranked = plan([entry('Quiz', 1, 'Short'), entry('Lab', 1, 'Moderate')], now, rooms({ 0: 'busy' }));
    // Lab's start-by had already passed; it stays as it was (shown as "Start today").
    expect(startDays(ranked)).toEqual({ Quiz: 0, Lab: -1 });
    expect(ranked.map((p) => p.bucket)).toEqual(['today', 'today']);
    expect(crowdedWeek(ranked, now)?.text).toBe('You said today is busy, but Lab and Quiz both need to start today, so move one or plan time.');
  });

  it('lets a dated entry beat a weekly one', () => {
    // Day 2 is Monday. Mondays are busy, but this Monday is free.
    const weeklyOnly = plan([entry('Essay', 6, 'Substantial')], now, rooms({}, { 1: 'busy' }));
    expect(startDays(weeklyOnly)).toEqual({ Essay: 1 });
    const datedFree = plan([entry('Essay', 6, 'Substantial')], now, rooms({ 2: 'free' }, { 1: 'busy' }));
    expect(startDays(datedFree)).toEqual({ Essay: 2 });
  });

  it('keeps a start day the student picked, even on a full day, and says how little room it leaves', () => {
    const ranked = plan([entry('Essay', 6, 'Substantial', { startOn: dateIn(5) }), entry('Lab', 7, 'Moderate')], now, rooms({ 5: 'little' }));
    expect(startDays(ranked)).toMatchObject({ Essay: 5 });
    expect(rankReasons(ranked).get('Essay')).toBe("You picked Thursday, which leaves 1 day before it's due.");
  });
});

describe('student guesses', () => {
  const dateIn = (d: number) => localDay(new Date(now.getTime() + d * 86_400_000));
  const dayOf = (p: { startBy: { at: string } | null }) => dayOfDate(localDay(new Date(p.startBy!.at))) - dayOfDate(localDay(now));
  const rooms = (levels: Record<number, { level: RoomLevel; minutes?: number }>, normal?: number) =>
    roomLookup([
      ...Object.entries(levels).map(([d, r]) => ({ key: `date:${dateIn(Number(d))}`, level: r.level, minutes: r.minutes ?? null, setAt: '' })),
      ...(normal ? [{ key: 'default', level: 'free' as const, minutes: normal, setAt: '' }] : []),
    ]);

  it('counts back from the day before the target through each day’s minutes', () => {
    // Due day 6. Normal day 60 min; day 5 is little (30), day 4 the student has 2 h. Guess 3 h:
    // day 5 (30) + day 4 (120) + day 3 (60) = 210 ≥ 180, so start day 3.
    const [p] = plan([entry('Essay', 6, 'Unknown', { guessMinutes: 180 })], now, rooms({ 5: { level: 'little' }, 4: { level: 'free', minutes: 120 } }, 60));
    expect(dayOf(p!)).toBe(3);
    expect(rankReasons([p!]).get('Essay')).toMatch(/^Start by \w+day so there's time for your guess of about 3 hours\.$/);
  });

  it('gives shared days to the earlier target first', () => {
    // Normal day 60. A due day 3 (guess 120: days 2, 1). B due day 4 (guess 120): day 3 (60), days 2 and 1 are used, day 0 (60).
    const ranked = plan([entry('A', 3, 'Unknown', { guessMinutes: 120 }), entry('B', 4, 'Unknown', { guessMinutes: 120 })], now, rooms({}, 60));
    expect(Object.fromEntries(ranked.map((p) => [p.id, dayOf(p)]))).toEqual({ A: 1, B: 0 });
  });

  it('starts today and says so when the guess is more than the days before the target have', () => {
    const [p] = plan([entry('Lab', 2, 'Unknown', { guessMinutes: 600 })], now, rooms({}, 60));
    expect(dayOf(p!)).toBe(0);
    expect(rankReasons([p!]).get('Lab')).toBe("Start today, though your guess of about 10 hours is more than the days before it have.");
  });
});
