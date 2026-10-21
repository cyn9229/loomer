import { describe, expect, it } from 'vitest';
import { climb, strictnessFor, type Observation } from './ladder';

const H = 3_600_000;
let n = 0;
const o = (kind: Observation['kind'], rung: number, at = 0, checksMixup = false): Observation => ({ at: at * H, questionId: `q${n++}`, rung, kind, checksMixup });
const week = { passesToClimb: 2, retentionMs: 20 * H, target: 'apply' as const };

describe('skill ladder', () => {
  it('climbs on two sure answers per rung, and a higher rung shows the lower ones', () => {
    expect(climb([o('pick', 0), o('pick', 0)], week).level).toBe(1);
    expect(climb([o('pick', 2), o('pick', 2)], week).level).toBe(3);
  });

  it('never climbs on right guesses, and steps down after two misses in a row', () => {
    expect(climb([o('assisted', 0), o('assisted', 0), o('assisted', 0)], week).level).toBe(0);
    expect(climb([o('pick', 1), o('pick', 1), o('miss', 0), o('miss', 1)], week).level).toBe(1);
    // A miss on a stretch question above the working rung is not a slip.
    expect(climb([o('pick', 1), o('pick', 1), o('miss', 4), o('miss', 4)], week).level).toBe(2);
  });

  it('caps a sure, wrong answer below "tell apart" until a check written for it is passed', () => {
    const open = climb([o('pick', 2), o('pick', 2), o('mixup', 2)], week);
    expect([open.mixupOpen, open.ask, open.ready]).toEqual([true, 'tell-apart', false]);
    expect(climb([o('pick', 2), o('pick', 2), o('mixup', 2), o('pick', 3, 0, true)], week).mixupOpen).toBe(false);
  });

  it('is ready only after a later sitting, and relaxes as the test gets close', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(climb([o('pick', 2), o('pick', 2)], week).ready).toBe(false);
    expect(climb([o('pick', 2), o('pick', 2), o('pick', 2, 21)], week).ready).toBe(true);
    // The test is tomorrow: one answer per rung, and the evening check 3 hours on counts.
    const tomorrow = strictnessFor('2026-10-21T13:00:00Z', now);
    expect(tomorrow).toMatchObject({ passesToClimb: 1, retentionMs: 3 * H });
    expect(climb([o('pick', 2), o('pick', 2, 4)], tomorrow).ready).toBe(true);
    // Test day: explain is enough, with no later sitting.
    const today = strictnessFor('2026-10-20T18:00:00Z', now);
    expect(climb([o('pick', 1)], today)).toMatchObject({ ready: true, progress: 1 });
  });

  it('shows progress as one number that only reaches 1 when ready', () => {
    const halfway = climb([o('pick', 0), o('pick', 0), o('pick', 1)], week);
    expect(halfway.progress).toBeGreaterThan(0.3);
    expect(halfway.progress).toBeLessThan(1);
  });
});
