import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment } from '../core/db';
import { buildHomeModel, type RecommendInput } from '../analysis/recommend';
import { DEFAULT_LEVEL_MINUTES } from '../analysis/plan';
import { activeMinutes, closeSession, nextStepStep, recapFor } from './close';
import { setState, startSession } from './session';

const t0 = new Date('2026-10-17T12:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const DOC = 'd'.repeat(30);

const essay: Assignment = {
  id: 'k#assignment:1',
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: '1',
  courseId: '1',
  courseName: 'English',
  title: 'Frankenstein essay',
  url: null,
  dueAt: new Date(t0.getTime() + 3 * 86_400_000).toISOString(),
  pointsPossible: null,
  submission: null,
  firstSeenAt: t0.toISOString(),
  lastSeenAt: t0.toISOString(),
  presence: 'seen-in-last-check',
  detail: { observedAt: t0.toISOString(), hash: 'h', text: 'You may use AI to get feedback. Write an argument essay.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
};

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.put(essay);
  await db.docLinks.put({ assignmentId: essay.id, docId: DOC, url: 'u', linkedAt: t0.toISOString() });
  await db.docReads.put({ docId: DOC, readState: 'ok', lastAttemptAt: t0.toISOString(), nextReadAt: t0.toISOString(), backoffMs: 0, current: { observedAt: t0.toISOString(), hash: 'h2', text: 'Victor is the real monster.' }, previous: null });
  await startSession(db, essay.id, t0);
});

const home = async (now: Date, over: Partial<RecommendInput> = {}) =>
  buildHomeModel({
    connected: true,
    assignments: [essay],
    courses: [],
    analyses: [],
    context: await db.studentContext.toArray(),
    ai: { enabled: false, brokerOrigin: '' },
    lastRun: { id: 1, sourceKey: 'k', origin: 'https://s.test', startedAt: t0.toISOString(), finishedAt: t0.toISOString(), outcome: 'ok', coverage: { courses: 1, plannerItems: 1, plannerTruncated: false, undatedCoursesChecked: 1, detailsFetched: 1, detailFailures: 0 }, error: null },
    now,
    packets: await db.resumePackets.toArray(),
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
    practices: [], waits: [], waitTimes: new Map(),
    ...over,
  });

describe('end card recap', () => {
  it('counts active minutes only, and says what happened in one sentence', () => {
    const events = [
      { kind: 'started' as const, at: at(0).toISOString() },
      { kind: 'paused' as const, at: at(20).toISOString() },
      { kind: 'resumed' as const, at: at(50).toISOString() },
    ];
    expect(activeMinutes(events, at(65))).toBe(35);
    const base = { id: 1, sessionId: 1, assignmentId: essay.id };
    const edits = [...events.map((e) => ({ ...base, ...e })), { ...base, kind: 'doc-changed' as const, at: at(10).toISOString(), wordsDelta: 240 }];
    const s = { id: 1, startedAt: at(0).toISOString() };
    expect(recapFor({ ...essay, quiz: false }, s, edits, 2, [], at(65)).text).toBe('You added 240 words and saved 2 sources in 35 minutes.');
    expect(recapFor({ ...essay, quiz: false }, s, edits.slice(0, 3), 0, [], at(65)).text).toBe(
      "You spent 35 minutes on this essay, and reading and planning count even when the word count doesn't move.",
    );
    expect(recapFor({ ...essay, title: 'Unit 3 test', quiz: true }, s, edits, 0, [], at(65)).text).toBe('You spent 35 minutes on this test.');
  });
});

describe('closing a session', () => {
  it('keeps the step from "Done for today" even with no edits, and Home continues with it', async () => {
    expect(await closeSession(db, 'for-today', { text: 'find a quote for your second reason', aiGenerated: false }, at(30))).toBe(true);
    expect((await db.sessions.get(1))?.state).toBe('ended');
    const m = await home(at(24 * 60));
    expect(m.status === 'ready' && [m.next.action, m.next.aiGenerated, m.next.insight]).toEqual([
      'Find a quote for your second reason',
      false,
      { kind: 'continue', text: 'Last time you planned this essay and left yourself this step.', aiFound: false },
    ]);
  });

  it('takes a turned-in assignment off the plan, and brings it back a day after the due date if Canvas never shows it', async () => {
    await closeSession(db, 'turned-in', undefined, at(30));
    expect((await home(at(60))).status).toBe('empty');
    const afterDue = await home(at(5 * 24 * 60));
    expect(afterDue.status !== 'not-connected' && afterDue.olderReview?.items[0]?.reason).toBe(
      "You said you turned in this essay, but Canvas doesn't show it yet, so check that it went through.",
    );
  });
});

describe('next step for next time', () => {
  const ai = async () => ({ enabled: true, brokerOrigin: 'http://127.0.0.1:8787' });

  it('asks the AI for writing, and keeps the plan step when the AI fails', async () => {
    await db.courses.put({ id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'English', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null });
    const reply = async () => new Response(JSON.stringify({ ok: true, model: 'test', result: { focus: 'Add evidence for your second reason', why: 'It has none yet.', requirementIndex: null } }));
    expect(await nextStepStep({ db, ai, fetch: reply }, at(30))).toBe(true);
    expect((await db.sessions.get(1))?.nextStep).toEqual({ status: 'ready', text: 'Add evidence for your second reason', aiGenerated: true });

    const down = async () => new Response('nope', { status: 500 });
    await nextStepStep({ db, ai, fetch: down }, at(31));
    expect((await db.sessions.get(1))?.nextStep).toEqual({ status: 'ready', text: 'Open the instructions and list what this essay asks for', aiGenerated: false });
  });

  it('gives a quiz no next step', async () => {
    await db.assignments.put({ ...essay, kind: 'quiz' });
    await setState(db, (await db.sessions.get(1))!, 'active', at(1));
    expect(await nextStepStep({ db, ai }, at(30))).toBe(false);
  });
});
