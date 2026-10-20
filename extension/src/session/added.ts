// Work the student adds by hand, for assignments that aren't on Canvas. It is
// stored next to Canvas items under the same school account, marked
// addedBy 'student', so it ranks and gets help the same way. Canvas checks
// never touch it, and only the student edits or deletes it.
import type { Assignment, AssignmentDetail, LoomerDb } from '../core/db';
import type { WorkType } from '../model/home';
import type { EditableFields } from '../model/detail';
import { detailHash } from '../adapters/canvas/collect';
import { courseKey } from '../analysis/facts';
import { deleteAssignmentData } from '../privacy/privacy';

export type AddedFields = Omit<EditableFields, 'docUrl'>;

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/g;

/** The instructions the student pasted, as a detail Loomer can analyze. Null when they pasted none. */
async function pastedDetail(instructions: string | null, now: Date): Promise<AssignmentDetail | null> {
  const text = instructions?.trim();
  if (!text) return null;
  const links = [...new Set(text.match(URL_IN_TEXT) ?? [])];
  return { observedAt: now.toISOString(), hash: await detailHash({ text, links, rubric: [] }), text, links, rubric: [], submissionTypes: [], canvasUpdatedAt: null, embeddedDocs: [] };
}

/** The Canvas course for a class key, or none for "Other". Only this account's courses. */
async function courseFor(db: LoomerDb, sourceKey: string, key: string | null) {
  const course = key ? await db.courses.get(key) : undefined;
  return course?.sourceKey === sourceKey ? { courseId: course.canvasId, courseName: course.name } : { courseId: '', courseName: null };
}

async function setWorkType(db: LoomerDb, id: string, workType: WorkType | null) {
  const ctx = await db.studentContext.get(id);
  await db.studentContext.put({ ...ctx, key: id, workType: workType ?? undefined });
}

/** Adds one assignment for the current school account. Returns its id. */
export async function addAssignment(db: LoomerDb, account: { sourceKey: string; origin: string }, fields: AddedFields, draftId: string | null, now: Date): Promise<string> {
  const id = `${account.sourceKey}#added:${crypto.randomUUID()}`;
  await db.assignments.put({
    id,
    sourceKey: account.sourceKey,
    origin: account.origin,
    replay: false,
    kind: 'assignment',
    canvasId: '',
    ...(await courseFor(db, account.sourceKey, fields.courseKey)),
    title: fields.title.trim(),
    url: null,
    dueAt: fields.dueAt,
    pointsPossible: null,
    submission: null,
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    presence: 'seen-in-last-check',
    detail: await pastedDetail(fields.instructions, now),
    detailError: null,
    addedBy: 'student',
    draftId: draftId ?? undefined,
  });
  if (fields.workType) await setWorkType(db, id, fields.workType);
  return id;
}

/** Changes a hand-added assignment. False for Canvas items, which the student can't edit. */
export async function editAssignment(db: LoomerDb, id: string, fields: AddedFields, now: Date): Promise<boolean> {
  const a = await db.assignments.get(id);
  if (a?.addedBy !== 'student') return false;
  const detail = await pastedDetail(fields.instructions, now);
  await db.assignments.put({
    ...a,
    ...(await courseFor(db, a.sourceKey, fields.courseKey)),
    title: fields.title.trim(),
    dueAt: fields.dueAt,
    // Same text keeps the old detail, so its analysis stays current.
    detail: detail?.hash === a.detail?.hash ? a.detail : detail,
  });
  await setWorkType(db, id, fields.workType);
  return true;
}

/** Removes a hand-added assignment and everything Loomer kept about it. False for Canvas items. */
export async function deleteAddedAssignment(db: LoomerDb, id: string): Promise<boolean> {
  if ((await db.assignments.get(id))?.addedBy !== 'student') return false;
  await deleteAssignmentData(db, id);
  await db.assignments.delete(id);
  await db.studentContext.delete(id);
  return true;
}

/** The edit form's fields for a hand-added assignment; null for Canvas items. */
export function editableFields(a: Assignment, workType: WorkType | null, docUrl: string | null): EditableFields | null {
  if (a.addedBy !== 'student') return null;
  return { title: a.title, courseKey: a.courseId ? courseKey(a) : null, dueAt: a.dueAt, workType, instructions: a.detail?.text ?? null, docUrl };
}

const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameDay = (x: string, y: string) => new Date(x).toDateString() === new Date(y).toDateString();

/**
 * An open Canvas item that looks like this hand-added one: one title contains
 * the other, and the due days match when both have one. Loomer only points it
 * out; the student decides whether to remove their copy.
 */
export function sameAsCanvas(added: Assignment, canvas: Assignment[]): Assignment | null {
  const title = normalize(added.title);
  if (title.length < 4) return null;
  return (
    canvas.find((c) => {
      const other = normalize(c.title);
      const titles = other === title || other.includes(title) || title.includes(other);
      return titles && (!added.dueAt || !c.dueAt || sameDay(added.dueAt, c.dueAt));
    }) ?? null
  );
}
