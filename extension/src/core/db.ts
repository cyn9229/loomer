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
  /** Student hid this item from "Other work". Survives refreshes until restored. */
  hidden?: boolean;
};

/** A Doc the student linked to an assignment: the only Doc Loomer may read for it. */
export type DocLink = { assignmentId: string; docId: string; url: string; linkedAt: string };

export type DocSnapshot = { observedAt: string; hash: string; text: string };

/** Read state per Doc, persisted so pacing and backoff survive a worker restart. */
export type DocRead = {
  docId: string;
  readState: 'ok' | 'rate-limited' | 'no-access' | 'unreadable' | 'waiting';
  lastAttemptAt: string | null;
  /** Earliest time the next read may start (pacing and 429 backoff). */
  nextReadAt: string;
  backoffMs: number;
  current: DocSnapshot | null;
  previous: DocSnapshot | null;
};

export type WorkSession = {
  id: number;
  sourceKey: string;
  assignmentId: string;
  state: 'active' | 'paused' | 'ended';
  startedAt: string;
  endedAt: string | null;
  lastActivityAt: string;
};

export type SessionEvent = {
  id: number;
  sessionId: number;
  assignmentId: string;
  at: string;
  kind: 'started' | 'paused' | 'resumed' | 'ended' | 'doc-changed' | 'source-added';
  /** For doc-changed: change in words the student wrote. */
  wordsDelta?: number;
  /** For source-added: page title. */
  title?: string;
};

/** A research page saved with one explicit action. Bounded excerpt, no raw HTML. */
export type Source = {
  id: string;
  assignmentId: string;
  sessionId: number;
  url: string;
  title: string;
  capturedAt: string;
  excerpt: string;
  hash: string;
};

export type ChatRecord = {
  id: number;
  assignmentId: string;
  role: 'student' | 'loomer';
  text: string;
  kind: 'question' | 'hint' | 'explanation' | 'example' | 'redirect' | 'review' | 'notice';
  references: { quote: string; from: 'your draft' | 'the instructions' }[];
  createdAt: string;
};

export class LoomerDb extends Dexie {
  assignments!: EntityTable<Assignment, 'id'>;
  runs!: EntityTable<CollectionRun, 'id'>;
  courses!: EntityTable<Course, 'id'>;
  analyses!: EntityTable<Analysis, 'assignmentId'>;
  studentContext!: EntityTable<StudentContext, 'key'>;
  docLinks!: EntityTable<DocLink, 'assignmentId'>;
  docReads!: EntityTable<DocRead, 'docId'>;
  sessions!: EntityTable<WorkSession, 'id'>;
  sessionEvents!: EntityTable<SessionEvent, 'id'>;
  sources!: EntityTable<Source, 'id'>;
  chat!: EntityTable<ChatRecord, 'id'>;

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
    this.version(3).stores({
      docLinks: 'assignmentId, docId',
      docReads: 'docId',
      sessions: '++id, state, assignmentId',
      sessionEvents: '++id, sessionId, assignmentId, at',
      sources: 'id, assignmentId',
      chat: '++id, assignmentId',
    });
  }
}

export const db = new LoomerDb();
