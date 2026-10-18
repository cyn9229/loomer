import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { draftScreenshot, saveScreenshot, screenshotDraftItem } from '../capture/screenshot';
import { LoomerDb, type Assignment } from '../core/db';
import type { GateState } from '../core/gate';
import { notifyDeadlineChanges } from '../notify/notify';
import { loadAssignmentDetail } from './detail';
import { checkRequirements } from './requirements';
import { startSession } from './session';

const t0 = new Date('2026-10-17T12:00:00Z');
const DOC = 'z'.repeat(30);
const gate: GateState = { paused: false, exclusions: [], grants: [] };
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
  dueAt: null,
  pointsPossible: null,
  submission: null,
  firstSeenAt: '',
  lastSeenAt: '',
  presence: 'seen-in-last-check',
  detail: {
    observedAt: '',
    hash: 'h',
    text: 'You may use AI for feedback. Compare two sources.',
    links: [],
    rubric: [
      { description: 'Summary of both sources', points: 20 },
      { description: 'Comparison of evidence', points: 30 },
    ],
    submissionTypes: [],
    canvasUpdatedAt: null,
  },
  detailError: null,
};
const draft = 'The EPA brief says downtown nights are 5 degrees warmer. The canopy study found shaded blocks were cooler.';
const ai = async () => ({ enabled: true, brokerOrigin: 'http://127.0.0.1:8787' });

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.put(assignment);
  await db.courses.put({ id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'English', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null });
  await db.docLinks.put({ assignmentId: assignment.id, docId: DOC, url: 'https://docs.google.com/document/d/x/edit', linkedAt: '' });
  await db.docReads.put({ docId: DOC, readState: 'ok', lastAttemptAt: null, nextReadAt: '', backoffMs: 0, current: { observedAt: '', hash: 'd1', text: draft }, previous: null });
});

const broker = (result: object) => async () => new Response(JSON.stringify({ ok: true, model: 'test', result }));

describe('requirement checks', () => {
  it('keeps Observed and Needs review only with a quote from the draft, otherwise Unknown, and marks stale on edit', async () => {
    await checkRequirements(
      {
        db,
        ai,
        fetch: broker({
          items: [
            { index: 0, state: 'observed', quote: 'downtown nights are 5 degrees warmer', note: '' },
            { index: 1, state: 'needs-review', quote: 'Not in the draft.', note: 'No comparison.' },
          ],
        }),
      },
      assignment.id,
      t0,
    );
    const detail = await loadAssignmentDetail(db, await ai(), assignment.id, t0);
    expect(detail.status === 'ok' && detail.requirements.map((r) => r.state)).toEqual(['observed', 'unknown']);
    expect(detail.status === 'ok' && detail.check?.stale).toBe(false);

    const read = (await db.docReads.get(DOC))!;
    await db.docReads.put({ ...read, current: { ...read.current!, hash: 'd2' } });
    const after = await loadAssignmentDetail(db, await ai(), assignment.id, t0);
    expect(after.status === 'ok' && after.check?.stale).toBe(true);
  });
});

describe('notifyDeadlineChanges', () => {
  it('notifies each change once and coalesces several into one', async () => {
    const sent: string[] = [];
    const notify = async (_id: string, _title: string, message: string) => void sent.push(message);
    const change = { assignmentId: 'a', title: 'Essay', from: '2026-10-20T23:59:00Z', to: '2026-10-22T23:59:00Z' };
    await notifyDeadlineChanges([change], notify);
    await notifyDeadlineChanges([change], notify);
    await notifyDeadlineChanges([{ ...change, assignmentId: 'b' }, { ...change, assignmentId: 'c' }], notify);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^2 due dates changed/);
  });
});

describe('screenshots', () => {
  const tab = { id: 1, windowId: 1, url: 'https://news.test/article', title: 'Article' };
  const tools = (password = false) => ({
    hasPasswordField: async () => password,
    captureVisible: async () => 'data:image/jpeg;base64,AAAA',
    imageSize: async () => ({ width: 800, height: 600 }),
  });

  it('refuses without a session, on sign-in pages, and on excluded hosts, and saves nothing', async () => {
    expect(await draftScreenshot(db, gate, tab, t0, tools())).toEqual({ ok: false, reason: 'no-session' });
    await startSession(db, assignment.id, t0);
    expect(await draftScreenshot(db, gate, tab, t0, tools(true))).toEqual({ ok: false, reason: 'sign-in-page' });
    expect(await draftScreenshot(db, gate, { ...tab, url: 'https://mail.google.com/mail/u/0' }, t0, tools())).toEqual({ ok: false, reason: 'excluded' });
    expect(await db.sources.count()).toBe(0);
  });

  it('saves only after confirm, cropped within bounds, and not if the site was blocked during preview', async () => {
    await startSession(db, assignment.id, t0);
    expect(await draftScreenshot(db, gate, tab, t0, tools())).toEqual({ ok: true });
    let cropped: unknown;
    const crop = async (_d: string, c: unknown) => {
      cropped = c;
      return 'data:image/jpeg;base64,BBBB';
    };
    expect(await saveScreenshot(db, gate, { x: 700, y: 500, width: 400, height: 400 }, t0, crop)).toEqual({ ok: true });
    expect(cropped).toEqual({ x: 700, y: 500, width: 100, height: 100 });
    expect(await db.sources.toArray()).toMatchObject([{ kind: 'screenshot', excerpt: '', image: 'data:image/jpeg;base64,BBBB' }]);
    expect(await screenshotDraftItem.getValue()).toBeNull();

    await draftScreenshot(db, gate, tab, t0, tools());
    const blocked: GateState = { ...gate, exclusions: [{ kind: 'host', host: 'news.test', includeSubdomains: false }] };
    expect(await saveScreenshot(db, blocked, { x: 0, y: 0, width: 10, height: 10 }, t0, crop)).toMatchObject({ ok: false });
    expect(await db.sources.count()).toBe(1);
  });
});

describe('requirementList', () => {
  it('drops AI-read deliverables that repeat a rubric criterion, keeps new ones', async () => {
    const { requirementList } = await import('./requirements');
    const a = {
      ...assignment,
      detail: {
        ...assignment.detail!,
        rubric: [
          { description: 'Comparison of evidence', points: 30 },
          { description: 'Citations and conventions', points: 20 },
        ],
      },
    };
    const deliverable = (text: string) => ({ text, quote: 'q' });
    const list = requirementList(a, {
      assignmentId: a.id,
      detailHash: a.detail.hash,
      status: 'ok',
      createdAt: '',
      model: 'm',
      effort: 'Substantial',
      effortReason: { text: '', quote: '' },
      deliverables: [deliverable('MLA citations for both sources.'), deliverable('An essay that compares the evidence.'), deliverable('A full draft in the linked document for peer review.')],
      milestones: [],
      firstStep: '',
    });
    expect(list.map((r) => r.text)).toEqual(['Comparison of evidence', 'Citations and conventions', 'A full draft in the linked document for peer review.']);
  });
});
