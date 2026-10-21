import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../model/home';
import { planByStart, stripDays, stripStarts, weekDays } from './plan';

const now = new Date(2026, 9, 17, 10, 0);
const day = (d: number, h = 23) => new Date(2026, 9, 17 + d, h, 59).toISOString();

function item(id: string, startDay: number | null, dueDay: number | null, over: Partial<WorkItem> = {}): WorkItem {
  return {
    assignmentId: id,
    title: id,
    source: 'canvas',
    sameAsCanvas: null,
    courseKey: 'c',
    courseName: null,
    url: null,
    due: dueDay === null ? null : { at: day(dueDay), source: 'canvas' },
    dueConflict: false,
    effort: { label: 'Moderate', reason: null, source: 'ai' },
    guessMinutes: null,
    workType: { type: 'writing', source: 'rule' },
    quiz: false,
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
    const essay = item('essay', 0, 5, { checkpoints: [{ text: 'Draft', label: 'Draft due', at: day(4), quote: 'the day before', derived: true }] });
    const week = weekDays([essay, item('quiz', 0, 1)], now);
    expect(week).toHaveLength(7);
    expect(week[0]!.events.map((e) => `${e.kind}:${e.item.assignmentId}`)).toEqual(['start:essay', 'start:quiz']);
    expect(week[1]!.events.map((e) => e.kind)).toEqual(['due']);
    expect(week[4]!.events.map((e) => e.kind)).toEqual(['checkpoint']);
    expect(week[5]!.events.map((e) => e.kind)).toEqual(['due']);
  });
});

describe('change card strip', () => {
  const room = (date: string) => ({ date, level: 'free' as const, minutes: null, repeating: false });
  it('counts kept starts and moved starts without counting a moved item twice', () => {
    const moved = item('set', 3, 4);
    const preview = { lines: [], days: [], moves: [{ assignmentId: 'set', title: 'set', from: day(3, 9), to: day(2, 9) }] };
    const days = stripDays(preview, now);
    expect(days[0]!.getDate()).toBe(17);
    expect(stripStarts([moved, item('lab', 2, 4)], preview.moves, days[2]!, now)).toEqual({ kept: 1, movedIn: 1, movedOut: 0 });
    expect(stripStarts([moved], preview.moves, days[3]!, now)).toEqual({ kept: 0, movedIn: 0, movedOut: 1 });
  });
  it('starts the strip at the first change when it is a week or more away', () => {
    expect(stripDays({ lines: [], days: [{ date: '2026-10-27', before: room('2026-10-27'), after: { ...room('2026-10-27'), level: 'busy' } }], moves: [] }, now)[0]!.getDate()).toBe(27);
  });
});
