import { describe, expect, it } from 'vitest';
import type { TopicCheckRecord } from '../core/db';
import type { TopicItem } from '../model/session';
import { lastCheck, nextTopic, standingOf } from './topicStanding';

const check = (quizId: string, question: number, correct: boolean, at: string): TopicCheckRecord => ({ id: 0, assignmentId: 'a', topic: 'ellipses', quizId, question, correct, at });
const item = (text: string, standing: TopicItem['standing'], correct = 0, total = 0, skipped = false): TopicItem => ({
  text,
  quote: text,
  sheet: null,
  standing,
  lastCheck: total ? { correct, total, at: '2026-10-18T12:00:00Z' } : null,
  skipped,
});

describe('topic standing', () => {
  it('uses only the latest check, and the last answer per question', () => {
    const checks = [
      check('old', 0, false, '2026-10-17T10:00:00Z'),
      check('new', 0, false, '2026-10-18T10:00:00Z'),
      check('new', 0, true, '2026-10-18T10:00:05Z'),
      check('new', 1, true, '2026-10-18T10:00:10Z'),
      check('new', 2, true, '2026-10-18T10:00:20Z'),
    ];
    const last = lastCheck(checks);
    expect(last).toEqual({ correct: 3, total: 3, at: '2026-10-18T10:00:20Z' });
    expect(standingOf(last)).toBe('solid');
    expect(standingOf({ correct: 2, total: 3, at: '' })).toBe('shaky');
    expect(standingOf(null)).toBe('unchecked');
  });

  it('picks the shakiest topic first, then the first unchecked one, never a skipped one', () => {
    expect(nextTopic([item('Circles', 'shaky', 2, 3), item('Hyperbolas', 'shaky', 0, 3), item('Ellipses', 'unchecked')])).toEqual({
      topic: 'Hyperbolas',
      reason: 'You missed 3 of 3 on the last check.',
      mode: 'explain',
    });
    expect(nextTopic([item('Circles', 'solid', 3, 3), item('Ellipses', 'unchecked', 0, 0, true), item('Parabolas', 'unchecked')])).toMatchObject({ topic: 'Parabolas', mode: 'check' });
    expect(nextTopic([item('Circles', 'solid', 3, 3)])).toBeNull();
  });
});
