import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment } from '../core/db';
import { startSession } from './session';
import { embeddedTopicsStep, loadSheetTopics, setTopicDone, topicsStep } from './topics';

const t0 = new Date('2026-10-18T12:00:00Z');
const DOC = 'y'.repeat(30);
const sheet = 'Part A: Parabolas\n1. Find the vertex of y = x^2 - 4x.\nPart B: Ellipses\n5. Find the foci of x^2/9 + y^2/4 = 1.';
const ai = async () => ({ enabled: true, brokerOrigin: 'http://127.0.0.1:8787' });

const worksheet = (over: Partial<Assignment> = {}): Assignment => ({
  id: 'k#assignment:2',
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: '2',
  courseId: '1',
  courseName: 'Precalculus',
  title: 'Unit 2 review worksheet',
  url: null,
  dueAt: null,
  pointsPossible: null,
  submission: null,
  firstSeenAt: '',
  lastSeenAt: '',
  presence: 'seen-in-last-check',
  detail: { observedAt: '', hash: 'h', text: 'AI tools are allowed for studying. Complete the review sheet.', links: [], rubric: [], submissionTypes: ['on_paper'], canvasUpdatedAt: null },
  detailError: null,
  ...over,
});

let db: LoomerDb;
let calls: unknown[];
const broker = (topics: object[]) => async (_: unknown, init?: RequestInit) => {
  calls.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ ok: true, model: 'test', result: { topics } }));
};

beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  calls = [];
  await db.courses.put({ id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'Precalculus', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null });
  await db.docLinks.put({ assignmentId: 'k#assignment:2', docId: DOC, url: 'https://docs.google.com/document/d/y/edit', linkedAt: '' });
  await db.docReads.put({ docId: DOC, readState: 'ok', lastAttemptAt: null, nextReadAt: '', backoffMs: 0, current: { observedAt: '', hash: 'd1', text: sheet }, previous: null });
});

describe('sheet topics', () => {
  it('keeps only topics quoted from the sheet, once, and lets the student tick them', async () => {
    await db.assignments.put(worksheet());
    await startSession(db, 'k#assignment:2', t0);
    const fetch = broker([
      { text: 'Parabolas', quote: 'Part A: Parabolas' },
      { text: 'Ellipses', quote: 'Part B: Ellipses' },
      { text: 'Hyperbolas', quote: 'Part C: Hyperbolas' },
    ]);
    await topicsStep({ db, ai, fetch }, t0);
    await setTopicDone(db, 'k#assignment:2', 'Parabolas', true);
    expect(await loadSheetTopics(db, 'k#assignment:2')).toEqual({
      status: 'ok',
      items: [
        { text: 'Parabolas', quote: 'Part A: Parabolas', done: true },
        { text: 'Ellipses', quote: 'Part B: Ellipses', done: false },
      ],
    });
    // Read once: the next step does not ask again.
    await topicsStep({ db, ai, fetch }, new Date(t0.getTime() + 60_000));
    expect(calls).toHaveLength(1);
  });

  it('never reads the sheet for writing work or a quiz', async () => {
    await db.assignments.put(worksheet({ title: 'Heat islands essay', detail: { ...worksheet().detail!, submissionTypes: ['online_upload'] } }));
    await startSession(db, 'k#assignment:2', t0);
    await topicsStep({ db, ai, fetch: broker([]) }, t0);
    await db.assignments.put(worksheet({ kind: 'quiz', title: 'Unit 2 quiz' }));
    await topicsStep({ db, ai, fetch: broker([]) }, t0);
    expect(calls).toHaveLength(0);
    expect(await loadSheetTopics(db, 'k#assignment:2')).toBeNull();
  });
});

describe('embedded teacher sheet', () => {
  it('lists topics from the sheet in the instructions before any session, under the instructions rule', async () => {
    // No session, no linked Doc; the policy is unclear, which allows reading instructions but not work help.
    await db.docLinks.clear();
    const embedded = worksheet({
      detail: { ...worksheet().detail!, text: 'Complete the review sheet.', sheet: { docId: DOC, state: 'ok', text: sheet, textHash: 's1', attemptAt: '' } },
    });
    await db.assignments.put(embedded);
    await embeddedTopicsStep({ db, ai, fetch: broker([{ text: 'Ellipses', quote: 'Part B: Ellipses' }]) }, 'k', t0);
    expect(await loadSheetTopics(db, embedded.id)).toEqual({ status: 'ok', items: [{ text: 'Ellipses', quote: 'Part B: Ellipses', done: false }] });
    expect(calls).toHaveLength(1);
  });
});
