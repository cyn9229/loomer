// Canvas collection: overview (planner + undated assignments), then requirement
// details for work in the decision window. Writes only to the local store.
import { doneInCanvas, type Assignment, type AssignmentDetail, type CollectionRun, type DeadlineChange, type LoomerDb, type PlannableKind, type RunOutcome, type SubmissionState } from '../../core/db';
import type { GateState } from '../../core/gate';
import { contentHash } from '../../core/hash';
import { mapLimit } from '../../core/concurrency';
import { extractHtml } from '../../core/html';
import { embeddedDocId } from '../docs/reader';
import { isLoopback } from '../../core/url';
import { canvasGet, canvasGetAll, type CanvasContext, type CanvasFailure } from './client';
import {
  assignmentSchema,
  courseSchema,
  courseSyllabusSchema,
  discussionSchema,
  plannerItemSchema,
  quizSchema,
  selfSchema,
  type CanvasAssignment,
  type PlannerItem,
} from './schemas';

const DAY_MS = 86_400_000;
const PLANNER_BACK_DAYS = 14;
const PLANNER_AHEAD_DAYS = 60;
const DETAIL_HORIZON_DAYS = 14;
const DETAIL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Parallel Canvas reads per collection. Bounded to stay polite to the school's server. */
const CANVAS_CONCURRENCY = 4;
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
  let deadlineChanges: DeadlineChange[] = [];
  const finish = async (outcome: RunOutcome, sourceKey: string | null, error: string | null = null) => {
    const run: Omit<CollectionRun, 'id'> = { sourceKey, origin, startedAt, finishedAt: new Date().toISOString(), outcome, coverage, error, deadlineChanges };
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
  const undatedLists = await mapLimit(courses.items, CANVAS_CONCURRENCY, async (course) => ({
    course,
    result: await canvasGetAll(ctx, `/api/v1/courses/${course.id}/assignments?bucket=undated&per_page=100`, assignmentSchema),
  }));
  for (const { course, result } of undatedLists) {
    if (!result.ok) {
      partial = true;
      continue;
    }
    undatedChecked.add(course.id);
    for (const a of result.items) {
      const record = fromAssignment(a, courseNames, base);
      if (!seen.has(record.id)) seen.set(record.id, record);
    }
  }
  coverage.undatedCoursesChecked = undatedChecked.size;

  deadlineChanges = await upsertOverview(db, sourceKey, seen, startedAt, (a) =>
    a.dueAt ? Date.parse(a.dueAt) >= windowStart.getTime() && Date.parse(a.dueAt) <= windowEnd.getTime() : undatedChecked.has(a.courseId),
  );

  const syllabusFailures = await collectSyllabi(db, ctx, sourceKey, courses.items, now);
  const failures = await collectDetails(db, ctx, sourceKey, now);
  coverage.detailsFetched = failures.fetched;
  coverage.detailFailures = failures.failed;
  return finish(partial || failures.failed > 0 || syllabusFailures > 0 ? 'partial' : 'ok', sourceKey);
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
    dueAt: plannerDue(item),
    pointsPossible: item.plannable.points_possible ?? null,
    submission: plannerSubmission(item),
  };
}

/** Workflow flags plus the student's own "Mark as done", which applies even when Canvas takes no submissions. */
function plannerSubmission(item: PlannerItem): SubmissionState | null {
  const markedDone = item.planner_override?.marked_complete === true;
  if (item.submissions) return { ...item.submissions, markedDone };
  return markedDone ? { submitted: false, excused: false, missing: false, late: false, graded: false, markedDone } : null;
}

/**
 * The student's due date. A teacher who sets dates per section leaves the base
 * due_at empty, but plannable_date still holds this student's date. A "to do"
 * date on ungraded work is not a deadline, so it never counts as due.
 */
function plannerDue(item: PlannerItem): string | null {
  if (item.plannable.due_at) return item.plannable.due_at;
  return item.plannable.todo_date ? null : item.plannable_date;
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
): Promise<DeadlineChange[]> {
  const changes: DeadlineChange[] = [];
  await db.transaction('rw', db.assignments, async () => {
    const existing = new Map((await db.assignments.where('sourceKey').equals(sourceKey).toArray()).map((a) => [a.id, a]));
    for (const record of seen.values()) {
      const prior = existing.get(record.id);
      const moved = Boolean(prior?.dueAt && record.dueAt && prior.dueAt !== record.dueAt);
      if (moved) changes.push({ assignmentId: record.id, title: record.title, from: prior!.dueAt!, to: record.dueAt! });
      await db.assignments.put({
        ...record,
        // Planner submission flags are the better source; keep them if the undated list lacked them.
        submission: record.submission ?? prior?.submission ?? null,
        firstSeenAt: prior?.firstSeenAt ?? checkedAt,
        presence: 'seen-in-last-check',
        // A moved deadline may come with new instructions: re-read them in this check.
        detail: prior?.detail && moved ? { ...prior.detail, observedAt: new Date(0).toISOString() } : (prior?.detail ?? null),
        detailError: prior?.detailError ?? null,
      });
    }
    for (const prior of existing.values()) {
      if (!seen.has(prior.id) && wasCovered(prior) && prior.presence !== 'missing-from-last-check') {
        await db.assignments.update(prior.id, { presence: 'missing-from-last-check' });
      }
    }
  });
  return changes;
}

/** Fetches requirement details for open work due within the horizon, or undated. */
async function collectDetails(db: LoomerDb, ctx: CanvasContext, sourceKey: string, now: Date) {
  const horizon = now.getTime() + DETAIL_HORIZON_DAYS * DAY_MS;
  const candidates = (await db.assignments.where('sourceKey').equals(sourceKey).toArray()).filter(
    (a) =>
      a.presence === 'seen-in-last-check' &&
      !doneInCanvas(a.submission) &&
      (!a.dueAt || Date.parse(a.dueAt) <= horizon) &&
      // A detail read before embedded Docs were recorded is read again once.
      (!a.detail || a.detail.embeddedDocs === undefined || now.getTime() - Date.parse(a.detail.observedAt) > DETAIL_MAX_AGE_MS),
  );

  let fetched = 0;
  let failed = 0;
  await mapLimit(candidates, CANVAS_CONCURRENCY, async (a) => {
    const result = await fetchDetail(ctx, a, now);
    if (!result.ok) {
      failed += 1;
      await db.assignments.update(a.id, { detailError: result.failure.kind });
      return;
    }
    fetched += 1;
    // Keep sheets already read for Docs still embedded; the sheet reader refreshes them on its own schedule.
    const sheets = (a.detail?.sheets ?? []).filter((s) => result.detail.embeddedDocs?.includes(s.docId));
    const detail = sheets.length ? { ...result.detail, sheets, hash: await detailHash({ ...result.detail, sheets }) } : result.detail;
    await db.assignments.update(a.id, { detail, detailError: null });
  });
  return { fetched, failed };
}

/** One detail read per kind. Each kind's instructions live in a different field. */
async function fetchDetail(ctx: CanvasContext, a: Assignment, now: Date) {
  const base = `/api/v1/courses/${a.courseId}`;
  switch (a.kind) {
    case 'assignment': {
      const r = await canvasGet(ctx, `${base}/assignments/${a.canvasId}`, assignmentSchema);
      if (!r.ok) return r;
      const rubric = (r.data.rubric ?? []).map((c) => ({
        description: [c.description, c.long_description].filter(Boolean).join(': '),
        points: c.points ?? null,
      }));
      return { ok: true as const, detail: await toDetail(r.data.description, rubric, r.data.submission_types, r.data.updated_at, ctx.origin, now) };
    }
    case 'quiz': {
      const r = await canvasGet(ctx, `${base}/quizzes/${a.canvasId}`, quizSchema);
      if (!r.ok) return r;
      return { ok: true as const, detail: await toDetail(r.data.description, [], ['online_quiz'], r.data.updated_at, ctx.origin, now) };
    }
    case 'discussion_topic': {
      const r = await canvasGet(ctx, `${base}/discussion_topics/${a.canvasId}`, discussionSchema);
      if (!r.ok) return r;
      return { ok: true as const, detail: await toDetail(r.data.message, [], ['discussion_topic'], r.data.updated_at, ctx.origin, now) };
    }
  }
}

/** Reads each course syllabus (a course-level AI policy source) when missing or old. Returns failures. */
async function collectSyllabi(db: LoomerDb, ctx: CanvasContext, sourceKey: string, courses: { id: string; name: string }[], now: Date) {
  let failed = 0;
  await mapLimit(courses, CANVAS_CONCURRENCY, async (course) => {
    const id = `${sourceKey}#course:${course.id}`;
    const prior = await db.courses.get(id);
    const fresh = prior?.syllabus && now.getTime() - Date.parse(prior.syllabus.observedAt) <= DETAIL_MAX_AGE_MS;
    if (fresh) {
      await db.courses.update(id, { name: course.name });
      return;
    }
    const result = await canvasGet(ctx, `/api/v1/courses/${course.id}?include[]=syllabus_body`, courseSyllabusSchema);
    if (!result.ok) {
      failed += 1;
      await db.courses.put({ id, sourceKey, canvasId: course.id, name: course.name, syllabus: prior?.syllabus ?? null, syllabusError: result.failure.kind });
      return;
    }
    const { text } = extractHtml(result.data.syllabus_body ?? '', ctx.origin);
    await db.courses.put({
      id,
      sourceKey,
      canvasId: course.id,
      name: course.name,
      syllabus: { observedAt: now.toISOString(), hash: await contentHash(text), text },
      syllabusError: null,
    });
  });
  return failed;
}

async function toDetail(
  html: string | null | undefined,
  rubric: AssignmentDetail['rubric'],
  submissionTypes: string[],
  canvasUpdatedAt: string | null | undefined,
  origin: string,
  now: Date,
): Promise<AssignmentDetail> {
  const { text, links, labels, embeds } = extractHtml(html ?? '', origin);
  const embedTitles: Record<string, string> = {};
  const embeddedDocs: string[] = [];
  for (const e of embeds) {
    const id = embeddedDocId(e.url);
    if (!id || embeddedDocs.includes(id)) continue;
    embeddedDocs.push(id);
    if (e.title) embedTitles[id] = e.title;
  }
  // An embedded Doc is also offered as a link, so the student can pick it as their sheet (a published copy cannot be linked).
  const allLinks = [...new Set([...links, ...embeddedDocs.filter((id) => !id.startsWith('e/')).map((id) => `https://docs.google.com/document/d/${id}/edit`)])];
  const detail = { observedAt: now.toISOString(), hash: '', text, links: allLinks, rubric, submissionTypes, canvasUpdatedAt: canvasUpdatedAt ?? null, embeddedDocs, embedTitles, linkLabels: labels };
  return { ...detail, hash: await detailHash(detail) };
}

/**
 * Hash of everything that defines the requirements: text, links, rubric, and the
 * embedded sheet's text when one was read. Without a sheet it equals the older
 * hash, so existing analyses stay valid.
 */
export function detailHash(d: Pick<AssignmentDetail, 'text' | 'links' | 'rubric' | 'sheets'>): Promise<string> {
  const base = { text: d.text, links: d.links, rubric: d.rubric };
  const sheets = (d.sheets ?? []).flatMap((s) => s.textHash ?? []);
  return contentHash(sheets.length ? { ...base, sheets } : base);
}

function describe(f: CanvasFailure): string {
  return [f.kind, f.reason, f.status, f.detail].filter((x) => x !== undefined).join(' ');
}
