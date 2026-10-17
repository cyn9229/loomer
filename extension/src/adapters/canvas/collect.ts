// Canvas collection: overview (planner + undated assignments), then requirement
// details for work in the decision window. Writes only to the local store.
import type { Assignment, AssignmentDetail, CollectionRun, LoomerDb, PlannableKind, RunOutcome } from '../../core/db';
import type { GateState } from '../../core/gate';
import { contentHash } from '../../core/hash';
import { extractHtml } from '../../core/html';
import { isLoopback } from '../../core/url';
import { canvasGet, canvasGetAll, type CanvasContext, type CanvasFailure } from './client';
import { assignmentSchema, courseSchema, plannerItemSchema, selfSchema, type CanvasAssignment, type PlannerItem } from './schemas';

const DAY_MS = 86_400_000;
const PLANNER_BACK_DAYS = 14;
const PLANNER_AHEAD_DAYS = 60;
const DETAIL_HORIZON_DAYS = 14;
const DETAIL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DETAIL_CONCURRENCY = 3;
const KINDS = new Set<string>(['assignment', 'quiz', 'discussion_topic']);

export type CollectOptions = { db: LoomerDb; origin: string; gate: GateState; now?: Date; fetch?: typeof fetch };

/** Runs one full collection and records it as a CollectionRun. Never throws. */
export async function collectCanvas({ db, origin, gate, now = new Date(), fetch }: CollectOptions): Promise<CollectionRun> {
  const ctx: CanvasContext = { origin, gate, fetch };
  const startedAt = now.toISOString();
  const coverage: CollectionRun['coverage'] = {
    courses: 0,
    plannerItems: 0,
    plannerTruncated: false,
    undatedCoursesChecked: 0,
    detailsFetched: 0,
    detailFailures: 0,
  };
  const finish = async (outcome: RunOutcome, sourceKey: string | null, error: string | null = null) => {
    const run: Omit<CollectionRun, 'id'> = { sourceKey, origin, startedAt, finishedAt: new Date().toISOString(), outcome, coverage, error };
    const id = await db.runs.add(run);
    return { ...run, id };
  };
  const failed = (f: CanvasFailure, sourceKey: string | null) =>
    finish(f.kind === 'auth-expired' ? 'auth-expired' : f.kind === 'denied' && f.reason === 'paused' ? 'paused' : 'failed', sourceKey, describe(f));

  const self = await canvasGet(ctx, '/api/v1/users/self', selfSchema);
  if (!self.ok) return failed(self.failure, null);
  const sourceKey = `${origin}|user:${self.data.id}`;

  const courses = await canvasGetAll(ctx, '/api/v1/courses?enrollment_state=active&per_page=100', courseSchema);
  if (!courses.ok) return failed(courses.failure, sourceKey);
  const courseNames = new Map(courses.items.map((c) => [c.id, c.name]));
  coverage.courses = courses.items.length;

  const windowStart = new Date(now.getTime() - PLANNER_BACK_DAYS * DAY_MS);
  const windowEnd = new Date(now.getTime() + PLANNER_AHEAD_DAYS * DAY_MS);
  const planner = await canvasGetAll(
    ctx,
    `/api/v1/planner/items?start_date=${encodeURIComponent(windowStart.toISOString())}&end_date=${encodeURIComponent(windowEnd.toISOString())}&per_page=100`,
    plannerItemSchema,
  );
  if (!planner.ok) return failed(planner.failure, sourceKey);
  coverage.plannerTruncated = planner.truncated;

  const seen = new Map<string, Omit<Assignment, 'firstSeenAt' | 'detail' | 'detailError' | 'presence'>>();
  const base = { sourceKey, origin, replay: isLoopback(new URL(origin)), lastSeenAt: startedAt };
  for (const item of planner.items) {
    if (!KINDS.has(item.plannable_type) || !item.course_id) continue;
    const record = fromPlanner(item, courseNames, base);
    seen.set(record.id, record);
  }
  coverage.plannerItems = seen.size;

  // Planner items need a date, so undated work comes from each course's list.
  const undatedChecked = new Set<string>();
  let partial = planner.truncated;
  for (const course of courses.items) {
    const undated = await canvasGetAll(ctx, `/api/v1/courses/${course.id}/assignments?bucket=undated&per_page=100`, assignmentSchema);
    if (!undated.ok) {
      partial = true;
      continue;
    }
    undatedChecked.add(course.id);
    for (const a of undated.items) {
      const record = fromAssignment(a, courseNames, base);
      if (!seen.has(record.id)) seen.set(record.id, record);
    }
  }
  coverage.undatedCoursesChecked = undatedChecked.size;

  await upsertOverview(db, sourceKey, seen, startedAt, (a) =>
    a.dueAt ? Date.parse(a.dueAt) >= windowStart.getTime() && Date.parse(a.dueAt) <= windowEnd.getTime() : undatedChecked.has(a.courseId),
  );

  const failures = await collectDetails(db, ctx, sourceKey, now);
  coverage.detailsFetched = failures.fetched;
  coverage.detailFailures = failures.failed;
  return finish(partial || failures.failed > 0 ? 'partial' : 'ok', sourceKey);
}

type OverviewRecord = Omit<Assignment, 'firstSeenAt' | 'detail' | 'detailError' | 'presence'>;
type Base = Pick<Assignment, 'sourceKey' | 'origin' | 'replay' | 'lastSeenAt'>;

function fromPlanner(item: PlannerItem, courseNames: Map<string, string>, base: Base): OverviewRecord {
  const kind = item.plannable_type as PlannableKind;
  const courseId = item.course_id ?? '';
  return {
    ...base,
    id: `${base.sourceKey}#${kind}:${item.plannable_id}`,
    kind,
    canvasId: item.plannable_id,
    courseId,
    courseName: courseNames.get(courseId) ?? item.context_name ?? null,
    title: item.plannable.title,
    url: item.html_url ? new URL(item.html_url, base.origin).toString() : null,
    dueAt: item.plannable.due_at ?? null,
    pointsPossible: item.plannable.points_possible ?? null,
    submission: item.submissions ? item.submissions : null,
  };
}

function fromAssignment(a: CanvasAssignment, courseNames: Map<string, string>, base: Base): OverviewRecord {
  return {
    ...base,
    id: `${base.sourceKey}#assignment:${a.id}`,
    kind: 'assignment',
    canvasId: a.id,
    courseId: a.course_id,
    courseName: courseNames.get(a.course_id) ?? null,
    title: a.name,
    url: a.html_url ?? null,
    dueAt: a.due_at ?? null,
    pointsPossible: a.points_possible ?? null,
    submission: null,
  };
}

/**
 * Updates records in place by stable id. Records this check should have covered
 * but did not return are marked missing, never deleted. Records outside the
 * covered range are left untouched.
 */
async function upsertOverview(
  db: LoomerDb,
  sourceKey: string,
  seen: Map<string, OverviewRecord>,
  checkedAt: string,
  wasCovered: (a: Assignment) => boolean,
) {
  await db.transaction('rw', db.assignments, async () => {
    const existing = new Map((await db.assignments.where('sourceKey').equals(sourceKey).toArray()).map((a) => [a.id, a]));
    for (const record of seen.values()) {
      const prior = existing.get(record.id);
      await db.assignments.put({
        ...record,
        // Planner submission flags are the better source; keep them if the undated list lacked them.
        submission: record.submission ?? prior?.submission ?? null,
        firstSeenAt: prior?.firstSeenAt ?? checkedAt,
        presence: 'seen-in-last-check',
        detail: prior?.detail ?? null,
        detailError: prior?.detailError ?? null,
      });
    }
    for (const prior of existing.values()) {
      if (!seen.has(prior.id) && wasCovered(prior) && prior.presence !== 'missing-from-last-check') {
        await db.assignments.update(prior.id, { presence: 'missing-from-last-check' });
      }
    }
  });
}

/** Fetches requirement details for open assignments due within the horizon, or undated. */
async function collectDetails(db: LoomerDb, ctx: CanvasContext, sourceKey: string, now: Date) {
  const horizon = now.getTime() + DETAIL_HORIZON_DAYS * DAY_MS;
  const candidates = (await db.assignments.where('sourceKey').equals(sourceKey).toArray()).filter(
    (a) =>
      a.kind === 'assignment' &&
      a.presence === 'seen-in-last-check' &&
      !a.submission?.submitted &&
      !a.submission?.excused &&
      (!a.dueAt || Date.parse(a.dueAt) <= horizon) &&
      (!a.detail || now.getTime() - Date.parse(a.detail.observedAt) > DETAIL_MAX_AGE_MS),
  );

  let fetched = 0;
  let failed = 0;
  const queue = [...candidates];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const result = await canvasGet(ctx, `/api/v1/courses/${a.courseId}/assignments/${a.canvasId}`, assignmentSchema);
      if (!result.ok) {
        failed += 1;
        await db.assignments.update(a.id, { detailError: result.failure.kind });
        continue;
      }
      fetched += 1;
      await db.assignments.update(a.id, { detail: await toDetail(result.data, ctx.origin, now), detailError: null });
    }
  };
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
  return { fetched, failed };
}

async function toDetail(a: CanvasAssignment, origin: string, now: Date): Promise<AssignmentDetail> {
  const { text, links } = extractHtml(a.description ?? '', origin);
  const rubric = (a.rubric ?? []).map((r) => ({
    description: [r.description, r.long_description].filter(Boolean).join(': '),
    points: r.points ?? null,
  }));
  return {
    observedAt: now.toISOString(),
    hash: await contentHash({ text, links, rubric }),
    text,
    links,
    rubric,
    submissionTypes: a.submission_types,
    canvasUpdatedAt: a.updated_at ?? null,
  };
}

function describe(f: CanvasFailure): string {
  return [f.kind, f.reason, f.status, f.detail].filter((x) => x !== undefined).join(' ');
}
