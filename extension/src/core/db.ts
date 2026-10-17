// Local evidence store (IndexedDB via Dexie). Holds what sources reported and
// when. Student-provided context lives in its own table (studentContext) so a
// refresh can never overwrite it.
import Dexie, { type EntityTable } from 'dexie';
import type { CanvasFailureKind } from '../adapters/canvas/client';
import type { EffortLabel } from '../model/home';
import type { PolicyAnswer } from './gate';

export type PlannableKind = 'assignment' | 'quiz' | 'discussion_topic';

/** Only workflow flags. Grade-related fields from Canvas are dropped at parse time. */
export type SubmissionState = { submitted: boolean; excused: boolean; missing: boolean; late: boolean };

export type AssignmentDetail = {
  observedAt: string;
  /** Hash of text, links, and rubric; a change means requirements must be re-checked. */
  hash: string;
  text: string;
  links: string[];
  rubric: { description: string; points: number | null }[];
  submissionTypes: string[];
  canvasUpdatedAt: string | null;
};

export type Assignment = {
  /** `${sourceKey}#${kind}:${canvasId}`. Stable across refreshes and deadline changes. */
  id: string;
  /** `${origin}|user:${userId}`. Scopes data to one school account so accounts never mix. */
  sourceKey: string;
  origin: string;
  /** True for the labeled local replay. Never shown as live school data. */
  replay: boolean;
  kind: PlannableKind;
  canvasId: string;
  courseId: string;
  courseName: string | null;
  title: string;
  url: string | null;
  dueAt: string | null;
  pointsPossible: number | null;
  submission: SubmissionState | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Absence from a check is not deletion: the record stays, marked as missing. */
  presence: 'seen-in-last-check' | 'missing-from-last-check';
  detail: AssignmentDetail | null;
  detailError: CanvasFailureKind | null;
};

export type RunOutcome = 'ok' | 'partial' | 'auth-expired' | 'paused' | 'no-permission' | 'not-connected' | 'failed';

export type CollectionRun = {
  id: number;
  sourceKey: string | null;
  origin: string | null;
  startedAt: string;
  finishedAt: string;
  outcome: RunOutcome;
  coverage: {
    courses: number;
    plannerItems: number;
    plannerTruncated: boolean;
    undatedCoursesChecked: number;
    detailsFetched: number;
    detailFailures: number;
  };
  error: string | null;
};

export type Course = {
  /** `${sourceKey}#course:${canvasId}`. */
  id: string;
  sourceKey: string;
  canvasId: string;
  name: string;
  /** Course-level policy source. Null until read. */
  syllabus: { observedAt: string; hash: string; text: string } | null;
  syllabusError: CanvasFailureKind | null;
};

export type Quoted = { text: string; quote: string };

/**
 * One AI interpretation of an assignment's requirements. Valid only while the
 * assignment's detail.hash still equals detailHash; otherwise it is stale.
 */
export type Analysis =
  | {
      assignmentId: string;
      detailHash: string;
      status: 'ok';
      createdAt: string;
      model: string;
      effort: EffortLabel;
      effortReason: Quoted;
      deliverables: Quoted[];
      milestones: Quoted[];
      firstStep: string;
    }
  | { assignmentId: string; detailHash: string; status: 'failed'; createdAt: string; error: string };

/** What the student told Loomer. Refreshes never write here. */
export type StudentContext = {
  /** Assignment id, or a course id for course-wide answers. */
  key: string;
  policyAnswer?: { value: PolicyAnswer; answeredAt: string };
};

export class LoomerDb extends Dexie {
  assignments!: EntityTable<Assignment, 'id'>;
  runs!: EntityTable<CollectionRun, 'id'>;
  courses!: EntityTable<Course, 'id'>;
  analyses!: EntityTable<Analysis, 'assignmentId'>;
  studentContext!: EntityTable<StudentContext, 'key'>;

  constructor(name = 'loomer') {
    super(name);
    this.version(1).stores({
      assignments: 'id, sourceKey, dueAt',
      runs: '++id, sourceKey, startedAt',
    });
    this.version(2).stores({
      courses: 'id, sourceKey',
      analyses: 'assignmentId',
      studentContext: 'key',
    });
  }
}

export const db = new LoomerDb();
