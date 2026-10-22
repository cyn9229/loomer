import { describe, expect, it } from 'vitest';
import { groundInSource } from './analyze';

const request = {
  title: 'Essay',
  courseName: null,
  dueAt: null,
  instructions: 'Compare the evidence each source uses.  Cite both sources in MLA format.',
  rubric: [{ description: 'Original argument', points: 30 }],
};

describe('groundInSource', () => {
  it('keeps statements whose quote is in the sent text, ignoring whitespace and case', () => {
    const r = groundInSource(
      {
        effort: 'Substantial',
        effortReason: { text: 'Two sources and an argument.', quote: 'compare the evidence each source uses.' },
        deliverables: [
          { text: 'An essay with MLA citations', quote: 'Cite both sources in MLA format.' },
          { text: 'A slideshow', quote: 'Present a slideshow to the class.' },
        ],
        milestones: [],
        pace: { days: 5, quote: 'Not in the instructions at all.' },
        plainWords: 'Compare two sources.',
        plainShort: 'Compare two sources.',
        firstStep: 'Read both sources and note each main claim', workType: 'writing',
      },
      request,
    );
    expect(r.effort).toBe('Substantial');
    expect(r.deliverables.map((d) => d.text)).toEqual(['An essay with MLA citations']);
    expect(r.pace).toBeNull();
  });

  it('turns an unsupported effort reason into Unknown', () => {
    const r = groundInSource(
      { effort: 'Short', effortReason: { text: 'Quick', quote: 'This takes ten minutes.' }, deliverables: [], milestones: [], pace: null, plainWords: '', plainShort: '', firstStep: 'Begin', workType: 'writing' },
      request,
    );
    expect(r.effort).toBe('Unknown');
  });
});
