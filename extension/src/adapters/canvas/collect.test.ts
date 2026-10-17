import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb } from '../../core/db';
import type { GateState } from '../../core/gate';
import { collectCanvas } from './collect';
import { fakeFetch, json } from './testing';

const origin = 'https://school.instructure.com';
const gate: GateState = { paused: false, exclusions: [], grants: [{ purpose: 'school-metadata', origin, version: 1 }] };
const now = new Date('2026-10-17T12:00:00Z');

type FakeAssignment = { id: number; name: string; due_at: string | null; description?: string };

/** Minimal Canvas: one course whose assignments the test mutates between checks. */
function canvas(assignments: FakeAssignment[]) {
  return fakeFetch((url) => {
    const p = url.pathname;
    if (p === '/api/v1/users/self') return json({ id: 42, name: 'Student', primary_email: 'x@y.z' });
    if (p === '/api/v1/courses') return json([{ id: 1, name: 'English' }]);
    if (p === '/api/v1/planner/items') {
      return json(
        assignments
          .filter((a) => a.due_at)
          .map((a) => ({
            plannable_id: a.id,
            plannable_type: 'assignment',
            course_id: 1,
            plannable_date: a.due_at,
            plannable: { title: a.name, due_at: a.due_at, points_possible: 10 },
            submissions: { submitted: false, excused: false, missing: false, late: false, graded: true, has_feedback: true },
          })),
      );
    }
    if (p === '/api/v1/courses/1/assignments') {
      return json(assignments.filter((a) => !a.due_at).map((a) => ({ id: a.id, course_id: 1, name: a.name, due_at: null })));
    }
    const detail = p.match(/^\/api\/v1\/courses\/1\/assignments\/(\d+)$/);
    const a = detail && assignments.find((x) => x.id === Number(detail[1]));
    if (a) return json({ id: a.id, course_id: 1, name: a.name, due_at: a.due_at, description: a.description ?? '', submission_types: ['online_upload'] });
    return undefined;
  });
}

let db: LoomerDb;
beforeEach(() => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
});

describe('collectCanvas', () => {
  it('collects overview and unopened requirement details in one run', async () => {
    const run = await collectCanvas({
      db,
      origin,
      gate,
      now,
      fetch: canvas([{ id: 9, name: 'Essay', due_at: '2026-10-20T23:59:00Z', description: '<p>Compare <a href="/files/3?utm_source=x">two sources</a>.</p>' }]),
    });
    expect(run.outcome).toBe('ok');
    const [a] = await db.assignments.toArray();
    expect(a).toMatchObject({ sourceKey: `${origin}|user:42`, title: 'Essay', presence: 'seen-in-last-check', replay: false });
    expect(a?.detail?.text).toBe('Compare two sources.');
    expect(a?.detail?.links).toEqual([`${origin}/files/3`]);
    // Grade-related planner flags never reach storage.
    expect(a?.submission).toEqual({ submitted: false, excused: false, missing: false, late: false });
  });

  it('updates the same record when a deadline changes, and keeps first-seen time', async () => {
    const items: FakeAssignment[] = [{ id: 9, name: 'Essay', due_at: '2026-10-20T23:59:00Z' }];
    await collectCanvas({ db, origin, gate, now, fetch: canvas(items) });
    const first = await db.assignments.toArray();
    items[0]!.due_at = '2026-10-22T23:59:00Z';
    await collectCanvas({ db, origin, gate, now: new Date('2026-10-17T13:00:00Z'), fetch: canvas(items) });
    const second = await db.assignments.toArray();
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ dueAt: '2026-10-22T23:59:00Z', firstSeenAt: first[0]!.firstSeenAt });
  });

  it('marks covered records missing instead of deleting, and leaves uncovered ones alone', async () => {
    await collectCanvas({ db, origin, gate, now, fetch: canvas([{ id: 9, name: 'Essay', due_at: '2026-10-20T23:59:00Z' }]) });
    await db.assignments.add({
      ...(await db.assignments.toArray())[0]!,
      id: `${origin}|user:42#assignment:77`,
      canvasId: '77',
      dueAt: '2027-06-01T00:00:00Z', // outside the planner window
    });
    await collectCanvas({ db, origin, gate, now, fetch: canvas([]) });
    const byId = new Map((await db.assignments.toArray()).map((a) => [a.canvasId, a.presence]));
    expect(byId.get('9')).toBe('missing-from-last-check');
    expect(byId.get('77')).toBe('seen-in-last-check');
  });

  it('records an expired session as auth-expired and keeps known data', async () => {
    await collectCanvas({ db, origin, gate, now, fetch: canvas([{ id: 9, name: 'Essay', due_at: '2026-10-20T23:59:00Z' }]) });
    const run = await collectCanvas({ db, origin, gate, now, fetch: fakeFetch(() => json({ errors: [] }, { status: 401 })) });
    expect(run.outcome).toBe('auth-expired');
    expect(await db.assignments.count()).toBe(1);
  });
});
