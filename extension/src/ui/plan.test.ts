import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../model/home';
import { planByStart, weekDays } from './plan';

const now = new Date(2026, 9, 17, 10, 0);
const day = (d: number, h = 23) => new Date(2026, 9, 17 + d, h, 59).toISOString();

function item(id: string, startDay: number | null, dueDay: number | null, over: Partial<WorkItem> = {}): WorkItem {
  return {
    assignmentId: id,
    title: id,
    courseKey: 'c',
    courseName: null,
    url: null,
    due: dueDay === null ? null : { at: day(dueDay), source: 'canvas' },
    dueConflict: false,
    effort: { label: 'Moderate', reason: null },
    policy: { state: 'permitted' },
    requirements: 'checked',
    replay: false,
    bucket: dueDay === null ? 'no-date' : dueDay < 0 ? 'past' : dueDay <= 7 ? 'soon' : 'later',
    hidden: false,
    correction: null,
    startBy: startDay === null ? null : { at: day(startDay, 9), basis: 'due' },
    checkpoints: [],
    rankReason: null,
    ...over,
  };
}

describe('planByStart', () => {
  it('puts several starts on one day, counts a missed start as today, and sends far starts to later', () => {
    const plan = planByStart([item('essay', -1, 4), item('quiz', 0, 1), item('lab', 2, 3), item('project', 9, 12), item('log', null, null)], now);
    expect(plan.days.map((d) => [d.offset, d.items.map((i) => i.assignmentId)])).toEqual([
      [0, ['quiz', 'essay']],
      [2, ['lab']],
    ]);
    expect(plan.later.map((i) => i.assignmentId)).toEqual(['project']);
  });
});

describe('weekDays', () => {
  it('lists starts, checkpoints, then dues on each day', () => {
    const essay = item('essay', 0, 5, { checkpoints: [{ text: 'Draft', at: day(4), quote: 'the day before', derived: true }] });
    const week = weekDays([essay, item('quiz', 0, 1)], now);
    expect(week).toHaveLength(7);
    expect(week[0]!.events.map((e) => `${e.kind}:${e.item.assignmentId}`)).toEqual(['start:essay', 'start:quiz']);
    expect(week[1]!.events.map((e) => e.kind)).toEqual(['due']);
    expect(week[4]!.events.map((e) => e.kind)).toEqual(['checkpoint']);
    expect(week[5]!.events.map((e) => e.kind)).toEqual(['due']);
  });
});
