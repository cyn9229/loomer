import { describe, expect, it } from 'vitest';
import type { Analysis, Assignment, CollectionRun, StudentContext } from '../core/db';
import { DEFAULT_LEVEL_MINUTES } from './plan';
import { buildHomeModel } from './recommend';
import { slipOf } from './slip';

// Wednesday Oct 21, local noon.
const now = new Date(2026, 9, 21, 12);
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

describe('slipOf', () => {
  const ctx = (over: Partial<StudentContext>): StudentContext => ({ key: 'e', suggestedStarts: ['2026-10-20'], ...over });

  it('finds a suggested day with no session since the last work, and counts repeats', () => {
    expect(slipOf('e', ctx({}), [], '2026-10-21')).toEqual({ assignmentId: 'e', missedOn: '2026-10-20', count: 1, answer: null });
    expect(slipOf('e', ctx({ suggestedStarts: ['2026-10-19', '2026-10-20'] }), [], '2026-10-21')?.count).toBe(2);
    // Worked on it today, or on the suggested day: nothing missed.
    expect(slipOf('e', ctx({}), ['2026-10-21'], '2026-10-21')).toBeNull();
    expect(slipOf('e', ctx({}), ['2026-10-20'], '2026-10-21')).toBeNull();
  });

  it('shows an answer only on the day it was given, and never after a dismiss', () => {
    const answered = (reason: 'too-big' | 'dismissed', day: number) => ctx({ slipAnswer: { missedOn: '2026-10-20', reason, at: at(day) } });
    expect(slipOf('e', answered('too-big', 21), [], '2026-10-21')?.answer).toBe('too-big');
    expect(slipOf('e', answered('too-big', 21), [], '2026-10-22')).toBeNull();
    expect(slipOf('e', answered('dismissed', 21), [], '2026-10-21')).toBeNull();
  });
});

describe('Home after a missed start', () => {
  const essay: Assignment = {
    id: 'e', sourceKey: 'k', origin: 'https://s.test', replay: false, kind: 'assignment', canvasId: '1', courseId: '1', courseName: 'English',
    title: 'Frankenstein essay', url: null, dueAt: at(23, 23), pointsPossible: null, submission: null, firstSeenAt: at(15), lastSeenAt: at(21),
    presence: 'seen-in-last-check', detail: { observedAt: at(21), hash: 'h', text: 'Write an argument essay.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null }, detailError: null,
  };
  const analysis: Analysis = {
    assignmentId: 'e', detailHash: 'h', status: 'ok', createdAt: at(21), model: 't', effort: 'Substantial', effortReason: { text: 'x', quote: '' },
    deliverables: [], milestones: [], firstStep: 'Outline your two reasons', plainWords: 'Argue who the real monster is, with evidence.',
  };
  const run: CollectionRun = { id: 1, sourceKey: 'k', origin: 'https://s.test', startedAt: at(21, 11), finishedAt: at(20), outcome: 'ok', coverage: { courses: 1, plannerItems: 1, plannerTruncated: false, undatedCoursesChecked: 1, detailsFetched: 1, detailFailures: 0 }, error: null };
  const home = (ctx: StudentContext) =>
    buildHomeModel({
      connected: true, assignments: [essay], courses: [], analyses: [analysis], context: [ctx], ai: { enabled: true, brokerOrigin: 'x' }, lastRun: run, now,
      packets: [], sources: [], docUrls: new Map(), activeSession: false, choice: null, snapshot: null, briefDismissedOn: null, room: [], planChanges: [],
      levelMinutes: DEFAULT_LEVEL_MINUTES, sheetTopics: [], topicChecks: [], workedDays: new Map(),
    preps: [],
    practices: [],
    });

  it('names the miss once, then makes the step smaller after a second miss', () => {
    const once = home({ key: 'e', suggestedStarts: ['2026-10-20'] });
    expect(once.status === 'ready' && [once.next.insight.text, once.next.quickStart, once.next.action]).toEqual([
      "You didn't get to this essay yesterday, and it's due Friday, so today's start matters more.",
      null,
      'Outline your two reasons',
    ]);
    const twice = home({ key: 'e', suggestedStarts: ['2026-10-19', '2026-10-20'] });
    expect(twice.status === 'ready' && [twice.next.slip?.count, twice.next.quickStart, twice.next.action]).toEqual([2, { minutes: 10 }, 'Just 10 minutes: outline your two reasons']);
  });

  it('gives the plain words after "Not sure how to start"', () => {
    const m = home({ key: 'e', suggestedStarts: ['2026-10-20'], slipAnswer: { missedOn: '2026-10-20', reason: 'not-sure', at: at(21, 9) } });
    expect(m.status === 'ready' && [m.next.plainWords, m.next.quickStart]).toEqual(['Argue who the real monster is, with evidence.', null]);
  });
});
