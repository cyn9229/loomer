import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment } from '../core/db';
import { buildHomeModel } from '../analysis/recommend';
import { dismissHint, hintEligibility, proactiveStep, type HintInputs } from './proactive';
import { focusStep } from './focus';
import { endSession, startSession } from './session';

const t0 = new Date('2026-10-17T12:00:00Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);

const base: HintInputs = {
  proactive: { enabled: true, delaySec: 90 },
  readOk: true,
  docLinked: true,
  helpAllowed: true,
  writing: true,
  paragraphDone: false,
  changedHints: false,
  lastEditAt: t0.getTime(),
  lastHintAt: null,
  hintShowing: false,
  studentWords: 120,
  currentHash: 'h2',
  lastEval: null,
  now: at(91).getTime(),
};

describe('hintEligibility', () => {
  it('allows a hint only after the pause, with new writing', () => {
    expect(hintEligibility(base)).toEqual({ eligible: true });
    expect(hintEligibility({ ...base, now: at(60).getTime() })).toEqual({ eligible: false, wait: 'still-editing' });
  });

  it('never treats inactivity alone as a reason: no edits, no new evidence, or AI not allowed means no hint', () => {
    expect(hintEligibility({ ...base, lastEditAt: null })).toMatchObject({ eligible: false, wait: 'still-editing' });
    expect(hintEligibility({ ...base, lastEval: { hash: 'h1', studentWords: 110 } })).toMatchObject({ wait: 'no-new-evidence' });
    expect(hintEligibility({ ...base, studentWords: 20 })).toMatchObject({ wait: 'no-new-evidence' });
    expect(hintEligibility({ ...base, helpAllowed: false })).toMatchObject({ wait: 'help-not-allowed' });
    expect(hintEligibility({ ...base, writing: false })).toMatchObject({ wait: 'not-writing' });
    expect(hintEligibility({ ...base, readOk: false })).toMatchObject({ wait: 'doc-not-readable' });
  });

  it('respects the cooldown, a hint already showing, and the setting', () => {
    expect(hintEligibility({ ...base, lastHintAt: at(0).getTime() })).toMatchObject({ wait: 'cooldown' });
    // A follow-up on an edited passage skips the cooldown.
    expect(hintEligibility({ ...base, lastHintAt: at(0).getTime(), changedHints: true, lastEval: { hash: 'old', studentWords: 120 } })).toEqual({ eligible: true });
    // After a finished paragraph, 30 s of pause is enough (now is 91 s after t0).
    expect(hintEligibility({ ...base, lastEditAt: at(51).getTime(), paragraphDone: true })).toEqual({ eligible: true });
    expect(hintEligibility({ ...base, lastEditAt: at(51).getTime() })).toMatchObject({ wait: 'still-editing' });
    expect(hintEligibility({ ...base, hintShowing: true })).toMatchObject({ wait: 'hint-showing' });
    expect(hintEligibility({ ...base, proactive: { enabled: false, delaySec: 90 } })).toMatchObject({ wait: 'disabled' });
    expect(hintEligibility({ ...base, proactive: { enabled: true, delaySec: 120 } })).toMatchObject({ wait: 'still-editing' });
  });
});

const DOC = 'd'.repeat(30);
const draft = 'Trees cool streets by giving shade. The EPA report says heat islands are hotter. The city article says trees help. '.repeat(3);
const assignment: Assignment = {
  id: 'k#assignment:1',
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: '1',
  courseId: '1',
  courseName: 'English',
  title: 'Essay',
  url: null,
  dueAt: new Date(t0.getTime() + 3 * 86_400_000).toISOString(),
  pointsPossible: null,
  submission: null,
  firstSeenAt: t0.toISOString(),
  lastSeenAt: t0.toISOString(),
  presence: 'seen-in-last-check',
  detail: { observedAt: t0.toISOString(), hash: 'h', text: 'You may use AI to get feedback. Compare two sources.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
};

/** Fake broker returning one hint reply; counts calls. */
function broker(result: object): typeof fetch & { calls: number } {
  const f = Object.assign(
    async () => {
      f.calls++;
      return new Response(JSON.stringify({ ok: true, model: 'test', result }));
    },
    { calls: 0 },
  );
  return f;
}

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.put(assignment);
  await db.courses.put({ id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'English', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null });
  await db.docLinks.put({ assignmentId: assignment.id, docId: DOC, url: 'u', linkedAt: t0.toISOString() });
  await db.docReads.put({ docId: DOC, readState: 'ok', lastAttemptAt: t0.toISOString(), nextReadAt: t0.toISOString(), backoffMs: 0, current: { observedAt: t0.toISOString(), hash: 'h2', text: draft }, previous: null });
  await startSession(db, assignment.id, t0);
  await db.sessionEvents.add({ sessionId: 1, assignmentId: assignment.id, at: t0.toISOString(), kind: 'doc-changed', wordsDelta: 40 });
});

const deps = (fetch: typeof globalThis.fetch) => ({
  db,
  ai: async () => ({ enabled: true, brokerOrigin: 'http://127.0.0.1:8787' }),
  proactive: async () => ({ enabled: true, delaySec: 90 }),
  typingAt: async () => null,
  fetch,
});
const useful = {
  useful: true,
  hint: 'How does the shade evidence support your claim?',
  quote: 'The city article says trees help.',
  issueKey: 'evidence-unexplained',
  requirementIndex: null,
  followUps: [] as { id: number; handled: boolean }[],
};

describe('proactiveStep', () => {
  it('shows one grounded hint after the pause and evaluates the same evidence only once', async () => {
    const f = broker(useful);
    expect(await proactiveStep(deps(f), at(20))).toBeNull(); // still inside the pause
    // The draft ends a full paragraph, so 30 s of pause is enough.
    const id = await proactiveStep(deps(f), at(35));
    expect(id).not.toBeNull();
    expect(await proactiveStep(deps(f), at(400))).toBeNull(); // hint showing, same evidence
    expect(f.calls).toBe(1);
  });

  it('drops a hint whose quote is not in the draft, and a dismissed issue type', async () => {
    expect(await proactiveStep(deps(broker({ ...useful, quote: 'Not in the draft at all.' })), at(95))).toBeNull();
    const id = (await proactiveStep(deps(broker(useful)), at(1_000)))!;
    expect(id).toBeNull(); // evidence already evaluated
    await db.sessions.update(1, { lastHintEval: undefined });
    const shown = (await proactiveStep(deps(broker(useful)), at(1_000)))!;
    await dismissHint(db, shown);
    await db.sessions.update(1, { lastHintEval: undefined, lastHintAt: undefined });
    expect(await proactiveStep(deps(broker(useful)), at(2_000))).toBeNull();
    expect((await db.studentContext.get(assignment.id))?.dismissedHintIssues).toEqual(['evidence-unexplained']);
  });

  it('keeps a hint whose passage was edited until the next call says it looks handled, and sends earlier hints', async () => {
    const id = (await proactiveStep(deps(broker(useful)), at(95)))!;
    const read = (await db.docReads.get(DOC))!;
    await db.docReads.put({ ...read, current: { ...read.current!, hash: 'h3', text: `${draft.replaceAll('The city article says trees help.', '')} The canopy study shows shade cut street heat by 5 degrees, which supports my claim.` } });
    // The edit marks the hint "changed"; the same step judges it, inside the cooldown, with the earlier hint in the request.
    let sent: { earlier?: { id: number; status: string }[] } = {};
    const judge = Object.assign(
      async (_: unknown, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, model: 'test', result: { ...useful, useful: false, hint: '', quote: '', followUps: [{ id, handled: true }] } }));
      },
      { calls: 0 },
    );
    await proactiveStep(deps(judge), at(100));
    expect(sent.earlier).toEqual([{ id, hint: useful.hint, status: 'changed' }]);
    expect((await db.hints.get(id))?.state).toBe('handled');
  });
});

describe('resume briefing', () => {
  it('writes a text-free packet at session end and shows facts on Home', async () => {
    await endSession(db, at(600));
    const packet = await db.resumePackets.get(assignment.id);
    expect(packet).toMatchObject({ edits: 1, wordsDelta: 40, docId: DOC, dismissed: false });
    expect(JSON.stringify(packet)).not.toContain('Trees cool');

    const home = buildHomeModel({
      connected: true,
      assignments: [assignment],
      courses: await db.courses.toArray(),
      analyses: [],
      context: [],
      ai: { enabled: false, brokerOrigin: '' },
      lastRun: { id: 1, sourceKey: 'k', origin: 'https://s.test', startedAt: t0.toISOString(), finishedAt: t0.toISOString(), outcome: 'ok', coverage: { courses: 1, plannerItems: 1, plannerTruncated: false, undatedCoursesChecked: 1, detailsFetched: 1, detailFailures: 0 }, error: null },
      now: at(700),
      packets: await db.resumePackets.toArray(),
      sources: [],
      docUrls: new Map([[assignment.id, 'https://docs.google.com/document/d/x/edit']]),
      activeSession: false,
      choice: null,
      snapshot: null,
      briefDismissedOn: null,
      room: [],
      planChanges: [],
      levelMinutes: { some: 120, little: 30 },
      sheetTopics: [],
      topicChecks: [],
    });
    expect(home.status !== 'not-connected' && home.resume).toMatchObject({ facts: ['You edited your draft 1 time and added 40 words.'], recommendationChanged: false });
  });
});

describe('session focus', () => {
  it('picks one focus per writing session, from the previous focus, and carries it into the resume packet', async () => {
    await db.resumePackets.put({ assignmentId: assignment.id, sessionId: 0, at: t0.toISOString(), docId: DOC, edits: 1, wordsDelta: 10, sourceIds: [], paragraphHashes: [], focus: 'Summarize both sources', handledHints: 2, dismissed: false });
    const bodies: { previous?: unknown }[] = [];
    const f = async (_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, model: 'test', result: { focus: 'Build the comparison', why: 'Both sources are summarized; none are compared yet.', requirementIndex: null } }));
    };
    const ai = async () => ({ enabled: true, brokerOrigin: 'http://127.0.0.1:8787' });
    await focusStep({ db, ai, fetch: f }, at(5));
    await focusStep({ db, ai, fetch: f }, at(10));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.previous).toEqual({ focus: 'Summarize both sources', handledHints: 2 });
    expect((await db.sessions.get(1))?.focus).toMatchObject({ text: 'Build the comparison' });
    await endSession(db, at(600));
    expect(await db.resumePackets.get(assignment.id)).toMatchObject({ focus: 'Build the comparison', handledHints: 0 });
  });
});
