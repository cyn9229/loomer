import { describe, expect, it } from 'vitest';
import { matchTab, assignmentTerms } from '../discovery/relevance';
import { siteName, sourceInDraft, sourcesNeeded } from './sources';

const assignment = 'Urban heat islands comparison essay\nCompare how two sources explain urban heat islands. Use at least three sources.';

describe('sources the teacher asks for', () => {
  it('reads the number from the instructions, in digits or words', () => {
    expect(sourcesNeeded(assignment)).toEqual({ required: 3, quote: 'Use at least three sources' });
    expect(sourcesNeeded('Cite 4 credible sources in MLA format.')).toEqual({ required: 4, quote: 'Cite 4 credible sources' });
    expect(sourcesNeeded('Explain what each source adds.')).toBeNull();
  });
});

describe('sources in the draft', () => {
  const draft = 'The EPA says cities can be 7 degrees warmer. Shaded blocks with more vegetation stayed cooler in the canopy survey.';

  it('counts a source when the draft names its site', () => {
    expect(siteName('https://www.epa.gov/heatislands')).toBe('epa');
    expect(sourceInDraft({ title: 'Heat Island Effect | US EPA', url: 'https://www.epa.gov/heatislands' }, draft, assignment)).toEqual({ used: true, matched: ['epa'] });
  });

  it('needs two of its own title words, not words every heat-island essay uses', () => {
    const canopy = { title: 'Tree canopy survey: vegetation and street heat', url: 'https://cityofexample.gov/forestry' };
    expect(sourceInDraft(canopy, draft, assignment)).toMatchObject({ used: true, matched: expect.arrayContaining(['canopy', 'survey', 'vegetation']) });
    const generic = { title: 'Urban heat islands explained', url: 'https://example.org/x' };
    expect(sourceInDraft(generic, draft, assignment)).toEqual({ used: false, matched: [] });
  });
});

describe('discovery from what the student writes', () => {
  it('suggests a page that matches words repeated in the draft, not just the assignment title', () => {
    const page = { title: 'How green roofs and tree canopy cool cities', url: 'https://example.org/green-roofs' };
    expect(matchTab(assignmentTerms('Heat essay', assignment), page.title, page.url).suggest).toBe(false);
    const withDraft = `${assignment}\nGreen roofs help. Green roofs also hold rain. The canopy matters, and canopy cover varies.`;
    expect(matchTab(assignmentTerms('Heat essay', withDraft), page.title, page.url)).toMatchObject({ suggest: true, matched: expect.arrayContaining(['green roof']) });
  });
});
