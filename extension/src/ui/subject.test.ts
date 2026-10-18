import { describe, expect, it } from 'vitest';
import { subjectIcon } from './subject';

describe('subjectIcon', () => {
  it('reads common class names', () => {
    expect(subjectIcon('AP English Language and Composition')).toBe('book');
    expect(subjectIcon('Spanish III')).toBe('languages');
    expect(subjectIcon('Honors Chemistry')).toBe('flask');
    expect(subjectIcon('Precalculus Honors')).toBe('sigma');
    expect(subjectIcon('Environmental Science (replay)')).toBe('tree');
    expect(subjectIcon('AP Computer Science Principles')).toBe('code');
  });

  it('falls back to a plain document', () => {
    expect(subjectIcon('Period 3')).toBe('doc');
    expect(subjectIcon(null)).toBe('doc');
  });
});
