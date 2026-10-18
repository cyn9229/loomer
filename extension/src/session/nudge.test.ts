import { describe, expect, it } from 'vitest';
import { covered, EMPTY_NUDGE_STATE, muted, nudgeAfter, type NudgeSignal, type NudgeState, type SessionNow } from './nudge';

const t0 = Date.parse('2026-10-18T15:00:00Z');
const sec = (s: number) => t0 + s * 1000;
const sig = (kind: NudgeSignal['kind'], s: number, assignmentId = 'a'): NudgeSignal => ({ kind, assignmentId, title: 'Unit 2 review', at: sec(s) });
const run = (signals: NudgeSignal[], session: SessionNow = null, start: NudgeState = EMPTY_NUDGE_STATE) => signals.reduce((st, x) => nudgeAfter(st, x, session), start);

describe('work nudges', () => {
  it('needs a real stretch of typing, not one stray key', () => {
    expect(run([sig('typing', 0), sig('typing', 2)]).nudge).toBeNull();
    expect(run([sig('typing', 0), sig('typing', 20), sig('typing', 50)]).nudge).toMatchObject({ assignmentId: 'a', action: 'start', reason: 'typing' });
    // A long gap starts a new burst.
    expect(run([sig('typing', 0), sig('typing', 20), sig('typing', 400)]).nudge).toBeNull();
  });

  it('suggests resume for a paused session, switch for another one, and nothing for the active one', () => {
    const typed = [sig('typing', 0), sig('typing', 20), sig('typing', 50)];
    expect(run(typed, { assignmentId: 'a', state: 'paused' }).nudge?.action).toBe('resume');
    expect(run(typed, { assignmentId: 'b', state: 'active' }).nudge?.action).toBe('switch');
    expect(run(typed, { assignmentId: 'a', state: 'active' }).nudge).toBeNull();
  });

  it('suggests a session after the panel stays on one assignment for 3 minutes', () => {
    expect(run([sig('viewing', 0), sig('viewing', 60), sig('viewing', 120)]).nudge).toBeNull();
    expect(run([sig('viewing', 0), sig('viewing', 60), sig('viewing', 120), sig('viewing', 180)]).nudge).toMatchObject({ reason: 'viewing', action: 'start' });
  });

  it('stays quiet for 2 hours after Not now, and clears once the session covers it', () => {
    const typed = [sig('typing', 0), sig('typing', 20), sig('typing', 50)];
    const quiet = muted(run(typed), 'a', sec(60));
    expect(quiet.nudge).toBeNull();
    expect(run([sig('typing', 70), sig('typing', 100), sig('typing', 130)], null, quiet).nudge).toBeNull();
    expect(run([sig('typing', 7300), sig('typing', 7330), sig('typing', 7360)], null, quiet).nudge).not.toBeNull();
    expect(covered(run(typed), 'a')).toMatchObject({ nudge: null, typing: {} });
  });
});
