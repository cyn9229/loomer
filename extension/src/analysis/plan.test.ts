import { describe, expect, it } from 'vitest';
import { checkpointsFor, crowdedWeek, dailyBrief, keepPreviousTop, plan, rankReasons, type PlanEntry } from './plan';

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
    expect(reasons.get('Quiz')).toMatch(/^Start today: quick task, due /);
    expect(reasons.get('Essay')).toMatch(/Second because Quiz needs a start today\.$/);
  });

  it('warns when two big assignments need a start within two days', () => {
    const crowded = crowdedWeek(ranked, now);
    expect(crowded).toMatchObject({ assignmentIds: ['Essay', 'Lab report'] });
    expect(crowded?.text).toMatch(/busy: Essay and Lab report both need a start\. Plan time for both\.$/);
    expect(crowdedWeek(plan([entry('Essay', 4, 'Substantial'), entry('Lab report', 12, 'Substantial')], now), now)).toBeNull();
  });

  it('summarizes today without numbers about time or grades', () => {
    // The quiz is due tomorrow, so it is counted there, not repeated as "start today".
    expect(dailyBrief(ranked, now)).toBe('1 due tomorrow; start Essay today.');
    expect(dailyBrief(plan([entry('Far', 20, 'Short')], now), now)).toBe('Nothing needs a start today.');
  });
});
