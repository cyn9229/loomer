import { describe, expect, it } from 'vitest';
import { findInstructionDeadlines } from './deadlines';
import { resolvePolicy, scanPolicy } from './policy';

const verdicts = (text: string) => scanPolicy(text, 'Assignment').map((f) => f.verdict);

describe('scanPolicy', () => {
  it('separates bans, permission, mixed rules, quotations, and discussion', () => {
    expect(verdicts('Do not use AI tools such as ChatGPT for any part of this assignment.')).toEqual(['prohibits']);
    expect(verdicts('No AI may be used.')).toEqual(['prohibits']);
    expect(verdicts('Using ChatGPT to write your essay is plagiarism.')).toEqual(['prohibits']);
    expect(verdicts('You may use AI to check grammar.')).toEqual(['permits']);
    expect(verdicts('AI is allowed for brainstorming.')).toEqual(['permits']);
    expect(verdicts('You may use AI to brainstorm, but do not use it to write.')).toEqual(['mixed']);
    expect(verdicts('Discuss the claim "AI should not be used in schools" in your essay.')).toEqual(['mentions']);
    expect(verdicts('We will study how generative models work.')).toEqual(['mentions']);
  });

  it('ignores text without an AI term, including lowercase "ai" inside words', () => {
    expect(verdicts('Do not copy from classmates. Explain the main idea and its detail.')).toEqual([]);
  });
});

describe('resolvePolicy', () => {
  const course = (text: string | null) => ({ label: 'Course syllabus', text });
  const assignment = (text: string | null) => ({ label: 'Canvas assignment', text });

  it('blocks on a clear prohibition and quotes it', () => {
    const r = resolvePolicy([course('Cite sources.'), assignment('Do not use AI for this assignment.')]);
    expect(r).toMatchObject({ state: 'blocked', finding: { quote: 'Do not use AI for this assignment.', sourceLabel: 'Canvas assignment' } });
  });

  it('never lets a permission in one source cancel a ban in another', () => {
    const r = resolvePolicy([course('You may use AI for brainstorming.'), assignment('Do not use AI for any part of this essay.')]);
    expect(r.state).toBe('limited');
  });

  it('cannot clear policy when a source is unreadable', () => {
    expect(resolvePolicy([course('Cite sources.'), assignment(null)])).toMatchObject({ state: 'unresolved', unresolvedBecause: 'unreadable' });
    // A detected ban still wins over unreadable material.
    expect(resolvePolicy([course('No AI use in this class.'), assignment(null)]).state).toBe('blocked');
  });

  it('distinguishes permitted, ambiguous mention, and nothing found', () => {
    expect(resolvePolicy([assignment('You may use AI to check spelling.')]).state).toBe('permitted');
    expect(resolvePolicy([assignment('We will discuss AI in class.')])).toMatchObject({ state: 'unresolved', unresolvedBecause: 'ambiguous' });
    expect(resolvePolicy([assignment('Write 600 words.')]).state).toBe('none-found');
  });
});

describe('findInstructionDeadlines', () => {
  const ref = new Date(2026, 9, 17);

  it('finds explicit dates in due-date sentences and infers the year', () => {
    expect(findInstructionDeadlines('The proposal is due Mon Oct 26 2026.', ref)).toEqual([
      { date: '2026-10-26', quote: 'The proposal is due Mon Oct 26 2026.' },
    ]);
    expect(findInstructionDeadlines('Final draft due January 8th.', ref).map((d) => d.date)).toEqual(['2027-01-08']);
    expect(findInstructionDeadlines('Submit by 11/3.', ref).map((d) => d.date)).toEqual(['2026-11-03']);
  });

  it('ignores weekday-only phrases and dates outside due-date sentences', () => {
    expect(findInstructionDeadlines('Due Friday in class.', ref)).toEqual([]);
    expect(findInstructionDeadlines('The Treaty was signed on Oct 26 1648.', ref)).toEqual([]);
  });
});
