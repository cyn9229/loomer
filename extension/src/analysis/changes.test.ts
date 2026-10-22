import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Analysis, type Assignment } from '../core/db';
import { runTool, type ToolSettings } from '../chat/tools';
import { applyChange, undoChange } from './changes';
import { localDay } from './plan';

const now = new Date(2026, 9, 17, 12, 0); // Saturday noon, local
const settings: ToolSettings = { connected: true, ai: { enabled: true, brokerOrigin: 'http://127.0.0.1:8787' }, choice: null, snapshot: null, levelMinutes: { some: 120, little: 30 } };
const dateIn = (d: number) => localDay(new Date(now.getTime() + d * 86_400_000));

const assignment = (id: string, dueDays: number): Assignment => ({
  id,
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: id,
  courseId: '1',
  courseName: 'English',
  title: `Title ${id}`,
  url: null,
  dueAt: new Date(now.getTime() + dueDays * 86_400_000).toISOString(),
  pointsPossible: null,
  submission: null,
  firstSeenAt: '',
  lastSeenAt: '',
  presence: 'seen-in-last-check',
  detail: { observedAt: '', hash: `h-${id}`, text: 'Write it.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
});

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  // Unknown workload, due in 6 days: starts in 4 days (Wed).
  await db.assignments.put(assignment('essay', 6));
  await db.runs.add({
    sourceKey: 'k',
    origin: 'https://s.test',
    startedAt: now.toISOString(),
    finishedAt: new Date(now.getTime() - 60_000).toISOString(),
    outcome: 'ok',
    coverage: { courses: 1, plannerItems: 1, plannerTruncated: false, undatedCoursesChecked: 1, detailsFetched: 1, detailFailures: 0 },
    error: null,
  });
});

const propose = (changes: object[]) => runTool(db, settings, 'propose_plan_change', JSON.stringify({ changes }), now, { threadKey: 'general', topic: null });
const busy = (date: string) => ({ kind: 'room', date, weekday: null, repeat: false, level: 'busy', minutes: 0 });

describe('propose_plan_change', () => {
  it('rejects unknown ids and past dates without storing anything', async () => {
    expect((await propose([{ kind: 'workload', assignment_id: 'nope', label: 'Heavy' }])).forModel).toMatch(/^Not proposed: Loomer couldn't find that assignment/);
    expect((await propose([busy(dateIn(-1))])).forModel).toMatch(/has already passed/);
    expect((await propose([{ kind: 'start_on', assignment_id: 'essay', date: dateIn(9), during: null }])).forModel).toMatch(/is due before/);
    expect(await db.planChanges.count()).toBe(0);
  });

  it('previews with the real planner, applies on tap, and undo restores the plan', async () => {
    const r = await propose([busy(dateIn(4))]);
    expect(r.block?.kind).toBe('plan-change');
    const [change] = await db.planChanges.toArray();
    expect(change!.status).toBe('proposed');
    expect(change!.preview.lines[0]).not.toMatch(/you have/);
    expect(change!.preview.days).toEqual([{ date: dateIn(4), before: expect.objectContaining({ level: 'free' }), after: expect.objectContaining({ level: 'busy' }) }]);
    expect(change!.preview.moves.map((m) => [m.assignmentId, localDay(new Date(m.from!)), localDay(new Date(m.to!))])).toEqual([['essay', dateIn(4), dateIn(3)]]);
    // Nothing is written until apply.
    expect(await db.dayRoom.count()).toBe(0);

    expect(await applyChange(db, change!.id, settings, now)).toEqual({ ok: true });
    expect(await db.dayRoom.get(`date:${dateIn(4)}`)).toMatchObject({ level: 'busy' });

    expect(await undoChange(db, change!.id, now)).toEqual({ ok: true });
    expect(await db.dayRoom.count()).toBe(0);
    expect((await db.planChanges.get(change!.id))!.status).toBe('undone');
  });

  it('checks again on apply and shows the new preview first when the plan moved', async () => {
    await propose([{ kind: 'workload', assignment_id: 'essay', label: 'Heavy' }]);
    const [change] = await db.planChanges.toArray();
    // Meanwhile the student marks the start day busy some other way.
    await db.dayRoom.put({ key: `date:${dateIn(2)}`, level: 'busy', minutes: null, setAt: '' });
    const first = await applyChange(db, change!.id, settings, now);
    expect(first).toMatchObject({ ok: false, previewChanged: true });
    expect((await db.studentContext.get('essay'))?.workload).toBeUndefined();
    expect(await applyChange(db, change!.id, settings, now)).toEqual({ ok: true });
    expect((await db.studentContext.get('essay'))?.workload).toBe('Substantial');
  });

  it('undo keeps a value a later change wrote', async () => {
    const idOf = (r: Awaited<ReturnType<typeof propose>>) => (r.block?.kind === 'plan-change' ? r.block.changeId : '');
    const heavy = idOf(await propose([{ kind: 'workload', assignment_id: 'essay', label: 'Heavy' }]));
    const light = idOf(await propose([{ kind: 'workload', assignment_id: 'essay', label: 'Light' }]));
    await applyChange(db, heavy, settings, now);
    await applyChange(db, light, settings, now, false);
    await undoChange(db, heavy, now);
    expect((await db.studentContext.get('essay'))?.workload).toBe('Short');
  });

  it('takes what the student says about progress, stakes, and when, and undo puts it all back', async () => {
    // Project due in 8 days, "one step each night" over 5 nights, with an outline checkpoint.
    await db.assignments.put(assignment('project', 8));
    await db.assignments.put(assignment('vocab', 3));
    const analysis: Analysis = {
      assignmentId: 'project', detailHash: 'h-project', status: 'ok', createdAt: '', model: 'm', version: 3,
      effort: 'Moderate', effortReason: { text: '', quote: '' }, deliverables: [], firstStep: 'Pick your topic',
      milestones: [{ text: 'Outline', quote: 'outline by Monday', date: dateIn(2), daysBeforeDue: null }],
      pace: { days: 5, quote: 'complete one step each night' },
    };
    await db.analyses.put(analysis);
    const r = await propose([
      { kind: 'checkpoint_done', assignment_id: 'project', checkpoint: 'Outline' },
      { kind: 'steps_done', assignment_id: 'project', count: 2 },
      { kind: 'start_on', assignment_id: 'essay', date: dateIn(1), during: 'study hall' },
      { kind: 'stakes', assignment_id: 'essay', level: 'high' },
      { kind: 'mark', assignment_id: 'vocab', as: 'turned_in' },
      { kind: 'note', assignment_id: 'vocab', text: 'Teacher said it is optional' },
    ]);
    const id = r.block?.kind === 'plan-change' ? r.block.changeId : '';
    const change = (await db.planChanges.get(id))!;
    expect(change.preview.lines).toEqual([
      'Title project: outline is done',
      'Title project: 2 steps done',
      expect.stringMatching(/^Start Title essay on .+ \(study hall\)$/),
      'Title essay counts a lot',
      'Mark Title vocab turned in',
      'Note on Title vocab: “Teacher said it is optional”',
    ]);
    // 3 steps left: the project starts 3 days before it's due, not 5, and the vocab sheet leaves the plan.
    const move = (aid: string) => change.preview.moves.find((m) => m.assignmentId === aid);
    expect(localDay(new Date(move('project')!.to!))).toBe(dateIn(5));
    expect(move('vocab')!.to).toBeNull();

    expect(await applyChange(db, id, settings, now)).toEqual({ ok: true });
    expect(await db.studentContext.get('project')).toMatchObject({ checkpointsDone: ['Outline'], stepsDone: 2 });
    expect(await db.studentContext.get('essay')).toMatchObject({ startOn: dateIn(1), startDuring: 'study hall', stakes: 'high' });
    expect(await db.studentContext.get('vocab')).toMatchObject({ correction: 'turned-in', note: 'Teacher said it is optional' });

    await undoChange(db, id, now);
    const after = await db.studentContext.bulkGet(['project', 'essay', 'vocab']);
    expect(after.map((c) => [c?.checkpointsDone, c?.stepsDone, c?.startOn, c?.stakes, c?.correction, c?.note])).toEqual(Array(3).fill(Array(6).fill(undefined)));
  });

  it('refuses a checkpoint the assignment does not have', async () => {
    expect((await propose([{ kind: 'checkpoint_done', assignment_id: 'essay', checkpoint: 'Outline' }])).forModel).toMatch(/no checkpoint called/);
  });
});
