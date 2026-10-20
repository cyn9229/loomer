import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment, type CollectionRun } from '../core/db';
import { buildHomeModel } from '../analysis/recommend';
import { DEFAULT_LEVEL_MINUTES } from '../analysis/plan';
import { loadHomeData } from '../model/homeData';
import { runTool } from '../chat/tools';
import { addAssignment, deleteAddedAssignment, editAssignment } from './added';

const now = new Date('2026-10-19T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const account = { sourceKey: 'k', origin: 'https://s.test' };
const run: CollectionRun = { id: 1, sourceKey: 'k', origin: 'https://s.test', startedAt: now.toISOString(), finishedAt: inDays(-1), outcome: 'ok', coverage: { courses: 1, plannerItems: 1, plannerTruncated: false, undatedCoursesChecked: 1, detailsFetched: 1, detailFailures: 0 }, error: null };
const fields = { title: 'Bio lab write-up', courseKey: 'k#course:1', dueAt: inDays(3), workType: null, instructions: null };

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.runs.add(run);
  await db.courses.put({ id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'Biology', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null });
});

const home = async (at = now) =>
  buildHomeModel({ ...(await loadHomeData(db)), connected: true, ai: { enabled: false, brokerOrigin: '' }, choice: null, snapshot: null, briefDismissedOn: null, levelMinutes: DEFAULT_LEVEL_MINUTES, now: at });

describe('work added by hand', () => {
  it('ranks like Canvas work, marked as the student\'s, with its class and no instructions needed', async () => {
    const id = await addAssignment(db, account, fields, null, now);
    const m = await home();
    expect(m.status === 'ready' && m.next.item).toMatchObject({ assignmentId: id, source: 'student', courseName: 'Biology', requirements: 'checked' });
    expect(m.status !== 'not-connected' && m.courses).toEqual([{ key: 'k#course:1', name: 'Biology' }]);
  });

  it('can be edited and deleted only when the student added it', async () => {
    const id = await addAssignment(db, account, fields, null, now);
    expect(await editAssignment(db, id, { ...fields, title: 'Bio lab', courseKey: null, workType: 'practice', instructions: 'Answer questions 1-5.' }, now)).toBe(true);
    expect(await db.assignments.get(id)).toMatchObject({ title: 'Bio lab', courseId: '', courseName: null, detail: { text: 'Answer questions 1-5.' } });
    expect((await db.studentContext.get(id))?.workType).toBe('practice');

    const canvas: Assignment = { ...(await db.assignments.get(id))!, id: 'k#assignment:9', addedBy: undefined };
    await db.assignments.put(canvas);
    expect(await editAssignment(db, canvas.id, fields, now)).toBe(false);
    expect(await deleteAddedAssignment(db, canvas.id)).toBe(false);
    expect(await deleteAddedAssignment(db, id)).toBe(true);
    expect(await db.assignments.get(id)).toBeUndefined();
  });

  it('points out a Canvas item that looks like the same work, and stays off the plan once marked done', async () => {
    const id = await addAssignment(db, account, fields, null, now);
    await db.assignments.put({ ...(await db.assignments.get(id))!, id: 'k#assignment:9', title: 'Bio Lab Write-up (Period 3)', addedBy: undefined, canvasId: '9', detail: { observedAt: now.toISOString(), hash: 'h', text: 'Write up the lab.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null } });
    const m = await home();
    const added = m.status === 'ready' ? [m.next.item, ...m.rest].find((i) => i.assignmentId === id) : undefined;
    expect(added?.sameAsCanvas).toEqual({ assignmentId: 'k#assignment:9', title: 'Bio Lab Write-up (Period 3)' });

    // "Mark as done" on hand-added work never comes back to wait for Canvas.
    await db.studentContext.put({ key: id, correction: 'turned-in' });
    const later = await home(new Date(Date.parse(inDays(10))));
    expect(later.status !== 'not-connected' ? (later.olderReview?.items.map((i) => i.item.assignmentId) ?? []) : []).not.toContain(id);
  });
});

describe('Ask Loomer add card', () => {
  const settings = { connected: true, ai: { enabled: true, brokerOrigin: 'http://127.0.0.1:8787' }, choice: null, snapshot: null, levelMinutes: DEFAULT_LEVEL_MINUTES };

  it('proposes a card with the class matched by name and 11:59 PM when no time was said', async () => {
    const r = await runTool(db, settings, 'propose_add_assignment', JSON.stringify({ title: 'Lab report', class_name: 'bio', due_date: '2026-10-23', due_time: null, work_type: null }), now);
    expect(r.block).toMatchObject({ kind: 'add-assignment', draft: { title: 'Lab report', courseKey: 'k#course:1', courseName: 'Biology', dueAt: new Date(2026, 9, 23, 23, 59).toISOString(), workType: null } });
    expect(await db.assignments.count()).toBe(0);
  });

  it('refuses a due date that has passed', async () => {
    const r = await runTool(db, settings, 'propose_add_assignment', JSON.stringify({ title: 'Lab', class_name: null, due_date: '2026-10-01', due_time: null, work_type: null }), now);
    expect(r.block).toBeUndefined();
    expect(r.forModel).toContain('already passed');
  });
});
