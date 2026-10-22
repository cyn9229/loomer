import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment } from '../core/db';
import { startSession } from './session';
import { embeddedTopicsStep, loadSheetTopics, recordTopicAnswer, reusedFromSheet, setTopicSkipped, topicsStep } from './topics';
import { runTool } from '../chat/tools';

const t0 = new Date('2026-10-18T12:00:00Z');
const DOC = 'y'.repeat(30);
const sheet = 'Part A: Parabolas\n1. Find the vertex of y = x^2 - 4x.\nPart B: Ellipses\n5. Find the foci of x^2/9 + y^2/4 = 1.';
const ai = async () => ({ enabled: true, brokerOrigin: 'http://127.0.0.1:8787' });
const settings = { connected: true, ai: { enabled: true, brokerOrigin: 'http://127.0.0.1:8787' }, choice: null, snapshot: null, levelMinutes: { some: 120, little: 30 } };

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
  it('keeps only topics quoted from the sheet, once, and sets standing from quick checks, not ticks', async () => {
    await db.assignments.put(worksheet());
    await startSession(db, 'k#assignment:2', t0);
    const fetch = broker([
      { text: 'Parabolas', quote: 'Part A: Parabolas', sheet: 0 },
      { text: 'Ellipses', quote: 'Part B: Ellipses', sheet: 0 },
      { text: 'Hyperbolas', quote: 'Part C: Hyperbolas', sheet: 0 },
    ]);
    await topicsStep({ db, ai, fetch }, t0);
    // A quick check on Parabolas, tagged by the one-tap request; 1 of 3 right.
    const quiz = await runTool(
      db,
      settings,
      'quiz_me',
      JSON.stringify({ concept: 'Parabolas', questions: [0, 1, 2].map((i) => ({ prompt: `q${i}`, choices: ['a', 'b'], answer_index: 0, explanation: 'e' })) }),
      t0,
      { threadKey: 'k#assignment:2', topic: 'Parabolas' },
    );
    const block = quiz.block?.kind === 'quiz' ? quiz.block : null;
    expect(block?.quiz.topic).toBe('Parabolas');
    await db.chatTurns.add({ threadKey: 'k#assignment:2', role: 'loomer', blocks: [block!], status: 'done', createdAt: t0.toISOString() });
    for (const [i, right] of [true, false, false].entries()) expect(await recordTopicAnswer(db, block!.quiz.id, i, right, t0)).toBe(true);
    await setTopicSkipped(db, 'k#assignment:2', 'Ellipses', true);
    expect(await loadSheetTopics(db, 'k#assignment:2')).toEqual({
      status: 'ok', pending: null, retryAt: null,
      items: [
        { text: 'Parabolas', quote: 'Part A: Parabolas', sheet: null, standing: 'shaky', lastCheck: { correct: 1, total: 3, at: t0.toISOString() }, skipped: false },
        { text: 'Ellipses', quote: 'Part B: Ellipses', sheet: null, standing: 'unchecked', lastCheck: null, skipped: true },
      ],
      next: { topic: 'Parabolas', reason: 'You missed 2 of 3 on the last check.', mode: 'explain' },
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
      detail: {
        ...worksheet().detail!,
        text: 'Complete the review sheet.',
        sheets: [
          { docId: DOC, state: 'ok', title: 'Unit 2 Review', text: sheet, textHash: 's1', attemptAt: '' },
          { docId: `${DOC}2`, state: 'ok', title: 'Extra practice', text: 'Part C: Hyperbolas\n9. Find the asymptotes.', textHash: 's2', attemptAt: '' },
        ],
      },
    });
    await db.assignments.put(embedded);
    await embeddedTopicsStep(
      {
        db,
        ai,
        fetch: broker([
          { text: 'Ellipses', quote: 'Part B: Ellipses', sheet: 0 },
          { text: 'Hyperbolas', quote: 'Part C: Hyperbolas', sheet: 1 },
          // The quote is on the other sheet: dropped.
          { text: 'Circles', quote: 'Part C: Hyperbolas', sheet: 0 },
        ]),
      },
      'k',
      t0,
    );
    expect(await loadSheetTopics(db, embedded.id)).toEqual({
      status: 'ok', pending: null, retryAt: null,
      items: [
        { text: 'Ellipses', quote: 'Part B: Ellipses', sheet: 'Unit 2 Review', standing: 'unchecked', lastCheck: null, skipped: false },
        { text: 'Hyperbolas', quote: 'Part C: Hyperbolas', sheet: 'Extra practice', standing: 'unchecked', lastCheck: null, skipped: false },
      ],
      next: { topic: 'Ellipses', reason: 'Not checked yet.', mode: 'check' },
    });
    expect(calls).toHaveLength(1);
  });
});

describe('quick checks never copy the sheet', () => {
  it('finds math copied from the sheet, ignoring spaces and dollar signs', () => {
    const sheetText = 'Part 2: Parabolas\n3. Find the focus and directrix of y^2 = 12x.';
    expect(reusedFromSheet('For the parabola $y^2=12x$, which way does it open?', sheetText)).toBe('y^2=12x');
    expect(reusedFromSheet('For the parabola $y^2=20x$, which way does it open?', sheetText)).toBeNull();
    expect(reusedFromSheet('Which way does it open?', sheetText)).toBeNull();
  });

  it('refuses a quiz that copies a problem, so the model writes new numbers', async () => {
    await db.assignments.put(worksheet({ detail: { ...worksheet().detail!, sheets: [{ docId: DOC, state: 'ok', title: null, text: 'Find the foci of x^2/25 + y^2/9 = 1.', textHash: 'h', attemptAt: '' }] } }));
    const copied = await runTool(
      db,
      settings,
      'quiz_me',
      JSON.stringify({ concept: 'Ellipses', questions: [{ prompt: 'Find the foci of $x^2/25 + y^2/9 = 1$.', choices: ['(±4, 0)', '(0, ±4)'], answer_index: 0, explanation: 'c² = a² − b².' }] }),
      t0,
      { threadKey: 'k#assignment:2', topic: null },
    );
    expect(copied.block).toBeUndefined();
    expect(copied.forModel).toMatch(/uses "x\^2\/25\+y\^2\/9=1" from the student's own sheet/);
  });
});
