import { DEFAULT_LEVEL_MINUTES } from './plan';
import { describe, expect, it } from 'vitest';
import type { Assignment, CollectionRun, Course, StudentContext } from '../core/db';
import { buildHomeModel, type RecommendInput } from './recommend';

const now = new Date('2026-10-17T12:00:00Z');
const sourceKey = 'https://s.test|user:1';
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

const assignment = (id: string, dueDays: number | null, over: Partial<Assignment> = {}): Assignment => ({
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
  firstSeenAt: '',
  lastSeenAt: '',
  presence: 'seen-in-last-check',
  detail: { observedAt: '', hash: `h-${id}`, text: `Instructions for ${id}.`, links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
  ...over,
});

const course: Course = { id: `${sourceKey}#course:1`, sourceKey, canvasId: '1', name: 'English', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null };
const run: CollectionRun = {
  id: 1,
  sourceKey,
  origin: 'https://s.test',
  startedAt: inDays(-1),
  finishedAt: inDays(-1),
  outcome: 'ok',
  coverage: { courses: 1, plannerItems: 1, plannerTruncated: false, undatedCoursesChecked: 1, detailsFetched: 1, detailFailures: 0 },
  error: null,
};
const input = (over: Partial<RecommendInput>): RecommendInput => ({
  connected: true,
  assignments: [],
  courses: [course],
  analyses: [],
  context: [],
  ai: { enabled: false, brokerOrigin: '' },
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
  ...over,
});
const ctx = (key: string, c: Omit<StudentContext, 'key'>): StudentContext => ({ key, ...c });

describe('remembered choice', () => {
  const soon = assignment('soon', 1);
  const essay = assignment('essay', 5);

  it("keeps the student's pick and shows Loomer's own pick alongside", () => {
    const m = buildHomeModel(input({ assignments: [soon, essay], choice: { assignmentId: 'essay', dueAt: essay.dueAt, detailHash: 'h-essay', at: '' } }));
    expect(m.status === 'ready' && m.next).toMatchObject({ item: { assignmentId: 'essay' }, chosenByStudent: true, loomerPick: { item: { assignmentId: 'soon' } } });
  });

  it('drops the choice when its due date or requirement text changes', () => {
    const moved = { ...essay, dueAt: inDays(6) };
    const m = buildHomeModel(input({ assignments: [soon, moved], choice: { assignmentId: 'essay', dueAt: essay.dueAt, detailHash: 'h-essay', at: '' } }));
    expect(m.status === 'ready' && m.next).toMatchObject({ item: { assignmentId: 'soon' }, chosenByStudent: false, loomerPick: null });
  });
});

describe('student corrections', () => {
  it('takes done-offline work out of ranking and ranks kept-active work even without a date', () => {
    const soon = assignment('soon', 1);
    const undated = assignment('undated', null);
    const m = buildHomeModel(
      input({ assignments: [soon, undated], context: [ctx('soon', { correction: 'done-offline' }), ctx('undated', { correction: 'kept-active' })] }),
    );
    expect(m.status === 'ready' && m.next.item).toMatchObject({ assignmentId: 'undated', correction: 'kept-active' });
    expect(m.status !== 'not-connected' && m.rest.find((r) => r.assignmentId === 'soon')?.correction).toBe('done-offline');
  });
});

describe('older-work review', () => {
  const old = assignment('old', -5);

  it('offers past-due work once, without calling it missing', () => {
    const m = buildHomeModel(input({ assignments: [old] }));
    expect(m.status !== 'not-connected' && m.olderReview?.items[0]?.reason).toMatch(/^This was due /);
  });

  it('stays quiet after review and returns only when Canvas newly marks it missing', () => {
    const reviewed = ctx('old', { olderReview: { at: '', missing: false } });
    expect(buildHomeModel(input({ assignments: [old], context: [reviewed] }))).toMatchObject({ olderReview: null });
    const missing = { ...old, submission: { submitted: false, excused: false, missing: true, late: true } };
    const m = buildHomeModel(input({ assignments: [missing], context: [reviewed] }));
    expect(m.status !== 'not-connected' && m.olderReview?.items[0]?.reason).toBe('Canvas now marks this one missing.');
  });
});

describe('plan snapshot', () => {
  it('says why the top moved and shows it on Home', async () => {
    const { nextPlanSnapshot } = await import('./recommend');
    const soon = assignment('soon', 1);
    const essay = assignment('essay', 5);
    const first = nextPlanSnapshot(input({ assignments: [soon, essay] }), null);
    expect(first).toMatchObject({ topId: 'soon', change: null });
    const second = nextPlanSnapshot(input({ assignments: [soon, essay], context: [ctx('soon', { correction: 'done-offline' })] }), first);
    expect(second).toMatchObject({ topId: 'essay', change: { text: 'soon is off your list now, so this essay is first.' } });
    const m = buildHomeModel(input({ assignments: [soon, essay], context: [ctx('soon', { correction: 'done-offline' })], snapshot: second }));
    expect(m.status === 'ready' && [m.next.change, m.next.insight.kind]).toEqual(['soon is off your list now, so this essay is first.', 'change']);
  });
});
