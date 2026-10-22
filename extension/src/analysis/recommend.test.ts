import { DEFAULT_LEVEL_MINUTES } from './plan';
import { describe, expect, it } from 'vitest';
import type { Analysis, Assignment, CollectionRun, Course } from '../core/db';
import { buildHomeModel, type RecommendInput } from './recommend';

const now = new Date('2026-10-17T12:00:00Z');
const sourceKey = 'https://s.test|user:1';
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

function assignment(id: string, dueDays: number | null, over: Partial<Assignment> = {}): Assignment {
  return {
    id,
    sourceKey,
    origin: 'https://s.test',
    replay: false,
    kind: 'assignment',
    canvasId: id,
    courseId: '1',
    courseName: 'English',
    title: id,
    url: null,
    dueAt: dueDays === null ? null : inDays(dueDays),
    pointsPossible: 10,
    submission: null,
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    presence: 'seen-in-last-check',
    detail: { observedAt: now.toISOString(), hash: `h-${id}`, text: `Instructions for ${id}.`, links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
    detailError: null,
    ...over,
  };
}

const analysis = (a: Assignment, effort: 'Short' | 'Substantial'): Analysis => ({
  assignmentId: a.id,
  detailHash: a.detail!.hash,
  status: 'ok',
  createdAt: now.toISOString(),
  model: 'test',
  effort,
  effortReason: { text: `${effort} work`, quote: `Instructions for ${a.id}.` },
  deliverables: [],
  milestones: [],
  firstStep: `Start ${a.id}`,
});

const course: Course = { id: `${sourceKey}#course:1`, sourceKey, canvasId: '1', name: 'English', syllabus: { observedAt: now.toISOString(), hash: 's', text: 'Cite sources.' }, syllabusError: null };
const run: CollectionRun = {
  id: 1,
  sourceKey,
  origin: 'https://s.test',
  startedAt: inDays(-0.01),
  finishedAt: inDays(-0.01),
  outcome: 'ok',
  coverage: { courses: 1, plannerItems: 2, plannerTruncated: false, undatedCoursesChecked: 1, detailsFetched: 2, detailFailures: 0 },
  error: null,
};

const input = (over: Partial<RecommendInput>): RecommendInput => ({
  connected: true,
  assignments: [],
  courses: [course],
  analyses: [],
  context: [],
  ai: { enabled: true, brokerOrigin: 'http://127.0.0.1:8787' },
  lastRun: run,
  now,
  packets: [],
  sources: [],
  docUrls: new Map(),
  activeSession: false,
  choice: null,
  snapshot: null,
  briefDismissedOn: null,
  room: [],
  planChanges: [],
  levelMinutes: DEFAULT_LEVEL_MINUTES,
  sheetTopics: [],
  topicChecks: [],
    workedDays: new Map(),
    preps: [],
    practices: [], waits: [], waitTimes: new Map(), trailNotes: [],
  ...over,
});

describe('buildHomeModel', () => {
  it('turns the next step of practice work into the topic to review, from the student\'s own checks', () => {
    const sheet = { ...assignment('review', 2), title: 'Unit 2 review worksheet' };
    const m = buildHomeModel(
      input({
        assignments: [sheet],
        analyses: [analysis(sheet, 'Short')],
        sheetTopics: [{ assignmentId: 'review', status: 'ok', docHash: 'd', createdAt: '', topics: [{ text: 'Hyperbolas', quote: 'Part C', sheetId: 's' }] }],
        topicChecks: [0, 1, 2].map((q) => ({ id: q, assignmentId: 'review', topic: 'hyperbolas', quizId: 'z', question: q, correct: q === 0, at: now.toISOString() })),
      }),
    );
    expect(m.status === 'ready' && [m.next.action, m.next.topic]).toEqual(['Review Hyperbolas', { topic: 'Hyperbolas', reason: 'You missed 2 of 3 on the last check.', mode: 'explain' }]);
    expect(m.status === 'ready' && m.next.insight).toEqual({ kind: 'weak-topic', text: 'You missed 2 of 3 on hyperbolas last time, and this worksheet is due Monday, so start with that topic.', aiFound: false });
  });

  it('leads the why with a step the instructions set before the due date', () => {
    const essay = { ...assignment('essay', 6), title: 'Persuasive essay' };
    const read = { ...analysis(essay, 'Substantial'), milestones: [{ text: 'Draft for peer review', quote: 'Bring a draft two days before.', daysBeforeDue: 2 }] };
    const m = buildHomeModel(input({ assignments: [essay], analyses: [read] }));
    expect(m.status === 'ready' && m.next.insight).toEqual({
      kind: 'hidden-deadline',
      text: 'Canvas says this essay is due Friday, but the instructions ask for a draft for peer review by Wednesday, so today is a good day to start.',
      aiFound: true,
    });
  });

  it('says when a busy day moved the start, and falls back to the days left', () => {
    const reflection = { ...assignment('r', 2), title: 'Reading reflection' };
    const room = [{ key: 'date:2026-10-18', level: 'busy' as const, minutes: null, setAt: now.toISOString() }];
    const busy = buildHomeModel(input({ assignments: [reflection], analyses: [analysis(reflection, 'Short')], room }));
    expect(busy.status === 'ready' && busy.next.insight).toEqual({ kind: 'busy-day', text: 'This reflection is due Monday, and since you said Sunday is busy, Loomer moved its start up to today.', aiFound: false });
    const plain = buildHomeModel(input({ assignments: [reflection], analyses: [analysis(reflection, 'Short')] }));
    expect(plain.status === 'ready' && plain.next.insight).toEqual({ kind: 'countdown', text: 'This reflection is due Monday, 2 days from now, so tomorrow is a good day to start.', aiFound: false });
  });

  it('lets a genuinely urgent short task beat a larger assignment due later', () => {
    const short = assignment('short', 1);
    const essay = assignment('essay', 5);
    const m = buildHomeModel(input({ assignments: [short, essay], analyses: [analysis(short, 'Short'), analysis(essay, 'Substantial')] }));
    expect(m.status === 'ready' && m.next.item.assignmentId).toBe('short');
  });

  it('puts substantial work first when its lead time starts earlier, and says why', () => {
    const short = assignment('short', 2);
    const essay = assignment('essay', 3);
    const m = buildHomeModel(input({ assignments: [short, essay], analyses: [analysis(short, 'Short'), analysis(essay, 'Substantial')] }));
    expect(m.status).toBe('ready');
    if (m.status !== 'ready') return;
    expect(m.next.item.assignmentId).toBe('essay');
    expect(m.next.reason).toBe('short is due sooner, but this essay needs more days, so today is a good day to start.');
    expect(m.next).toMatchObject({ action: 'Start essay', aiGenerated: true });
  });

  it('refuses a confident pick when unreadable work could come first', () => {
    const essay = assignment('essay', 5);
    const hidden = assignment('hidden', 2, { detail: null, detailError: 'unexpected' });
    const m = buildHomeModel(input({ assignments: [essay, hidden], analyses: [analysis(essay, 'Substantial')] }));
    expect(m.status).toBe('cannot-compare');
  });

  it('never uses AI output for a blocked assignment, even if stored earlier', () => {
    const banned = assignment('banned', 1, {
      detail: { observedAt: now.toISOString(), hash: 'h-banned', text: 'Do not use AI for any part of this.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
    });
    const m = buildHomeModel(input({ assignments: [banned], analyses: [{ ...analysis(banned, 'Short'), detailHash: 'h-banned' }] }));
    expect(m.status).toBe('ready');
    if (m.status !== 'ready') return;
    expect(m.next).toMatchObject({ aiGenerated: false, item: { policy: { state: 'blocked' }, effort: { label: 'Unknown' } } });
  });

  it('waits for allowed analysis right after a check instead of ranking by title', () => {
    const justFinished = { ...run, finishedAt: new Date(now.getTime() - 10_000).toISOString() };
    const m = buildHomeModel(input({ assignments: [assignment('essay', 5)], lastRun: justFinished }));
    expect(m).toMatchObject({ status: 'checking', progress: { checked: 0, total: 1 } });
    // After the bounded wait, rank without effort instead of waiting forever.
    expect(buildHomeModel(input({ assignments: [assignment('essay', 5)] })).status).toBe('ready');
  });

  it('keeps past-due and undated work listed but out of the ranking', () => {
    const m = buildHomeModel(input({ assignments: [assignment('old', -3), assignment('undated', null)], ai: { enabled: false, brokerOrigin: '' } }));
    expect(m).toMatchObject({ status: 'empty' });
    expect(m.status === 'empty' && m.rest.map((r) => r.assignmentId)).toEqual(['old', 'undated']);
  });
});
