import { describe, expect, it } from 'vitest';
import { assignmentTerms, matchTab } from './relevance';

const terms = assignmentTerms(
  'Urban heat islands: comparative essay',
  'Write an essay comparing how two sources explain urban heat islands and the role of tree cover. Compare tree cover evidence. Cite both sources.',
);

describe('matchTab', () => {
  it('suggests a page whose title shares a phrase or two distinctive words', () => {
    expect(matchTab(terms, 'Heat Island Effect | US EPA', 'https://www.epa.gov/heatislands')).toMatchObject({ suggest: true });
    expect(matchTab(terms, 'Why urban trees matter for cooling', 'https://news.test/a').suggest).toBe(true);
  });

  it('stays quiet for one shared word, generic words, or unrelated pages', () => {
    expect(matchTab(terms, 'Urban Outfitters sale', 'https://shop.test/').suggest).toBe(false);
    expect(matchTab(terms, 'How to write a comparative essay with sources', 'https://writing.test/essay').suggest).toBe(false);
    expect(matchTab(terms, 'Weather tomorrow', 'https://weather.test/').suggest).toBe(false);
  });
});
