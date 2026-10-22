import { describe, expect, it } from 'vitest';
import { siteOf } from './trail';

describe('siteOf', () => {
  it('reads a site from what the student typed', () => {
    expect(siteOf('brainscape.com')).toBe('brainscape.com');
    expect(siteOf(' https://www.Brainscape.com/flashcards/unit-5 ')).toBe('brainscape.com');
    expect(siteOf('quizlet.com/123/unit-5-flash-cards')).toBe('quizlet.com');
  });
  it('turns down what isn’t a site', () => {
    expect(siteOf('')).toBeNull();
    expect(siteOf('my notes')).toBeNull();
    expect(siteOf('localhost')).toBeNull();
  });
});
