import { describe, expect, it } from 'vitest';
import { calendarDaysUntil, deadlineLabel } from './format';

const now = new Date(2026, 9, 17, 16, 12); // Sat Oct 17, 4:12 PM local

describe('deadlineLabel', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    // 1:00 AM tomorrow is under 24 hours away but still "Tomorrow".
    expect(deadlineLabel(new Date(2026, 9, 18, 1, 0).toISOString(), now).text).toBe('Tomorrow');
    expect(calendarDaysUntil(new Date(2026, 9, 22, 23, 59), now)).toBe(5);
    expect(deadlineLabel(new Date(2026, 9, 22, 23, 59).toISOString(), now)).toEqual({ text: '5 days left', soon: false });
  });

  it('marks today and the next two days as soon', () => {
    expect(deadlineLabel(new Date(2026, 9, 17, 23, 59).toISOString(), now)).toEqual({ text: 'Due today', soon: true });
    expect(deadlineLabel(new Date(2026, 9, 19, 8, 0).toISOString(), now).soon).toBe(true);
  });

  it('never calls a passed deadline missing', () => {
    expect(deadlineLabel(new Date(2026, 9, 17, 9, 0).toISOString(), now).text).toBe('Deadline passed');
  });
});
