import { describe, expect, it } from 'vitest';
import { usualWords } from './wait';

describe('usualWords', () => {
  it('reads the live measurements in a few words', () => {
    expect(usualWords([2, 2])).toBe('a few seconds');
    expect(usualWords([2, 6])).toBe('a few seconds');
    expect(usualWords([9, 9])).toBe('about 10 s');
    expect(usualWords([5, 10])).toBe('5 to 10 s');
    expect(usualWords([10, 30])).toBe('10 to 30 s');
    expect(usualWords([14, 90])).toBe('15 s to 1½ min');
  });
});
