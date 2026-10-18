// Local evidence store (IndexedDB via Dexie). Holds what sources reported and
// when. Student-provided context lives in its own table (studentContext) so a
// refresh can never overwrite it.
import Dexie, { type EntityTable } from 'dexie';
import type { CanvasFailureKind } from '../adapters/canvas/client';
import type { ChatBlock } from '../model/chat';
import type { EffortLabel, RoomLevel } from '../model/home';
import type { PlanPreview } from '../model/plan';
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
  /** Existing assignments whose Canvas due date changed in this check. */
  deadlineChanges?: DeadlineChange[];
};

export type DeadlineChange = { assignmentId: string; title: string; from: string; to: string };

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

/** A checkpoint as the model read it. Date fields are absent on analyses stored before they existed. */
export type Milestone = Quoted & { date?: string | null; daysBeforeDue?: number | null };

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
      milestones: Milestone[];
      firstStep: string;
      /** Instructions in plain words; absent on older analyses. */
      plainWords?: string;
    }
  | { assignmentId: string; detailHash: string; status: 'failed'; createdAt: string; error: string };

/** What the student told Loomer. Refreshes never write here. */
export type StudentContext = {
  /** Assignment id, or a course id for course-wide answers. */
  key: string;
  policyAnswer?: { value: PolicyAnswer; answeredAt: string };
  /** Student hid this item from "Other work". Survives refreshes until restored. */
  hidden?: boolean;
  /** Hint issue types the student dismissed for this assignment; not raised again. */
  dismissedHintIssues?: string[];
  /** "I did this offline" (leaves the queue) or "Keep this active" (stays ranked). */
  correction?: 'done-offline' | 'kept-active';
  /** The student's own explanation, shown in context only. */
  note?: string;
  /** The older-work review was shown for this item; `missing` is what Canvas said then. */
  olderReview?: { at: string; missing: boolean };
  /** The student's workload label. Beats the AI's label. */
  workload?: StudentWorkload;
  /** Local date (YYYY-MM-DD) the student picked to start. Used as given. */
  startOn?: string;
  /** The student's own guess for the whole task, in minutes. */
  guessMinutes?: number;
};

export type StudentWorkload = Exclude<EffortLabel, 'Unknown'>;

/**
 * Room the student gave a day. Key `date:YYYY-MM-DD` (one day), `weekday:0`-`6`
 * (every week, 0 is Sunday), or `default` (their normal day). A dated entry beats
 * a weekly one. Only the level and their own minutes are stored, never the reason.
 */
export type DayRoomRecord = { key: string; level: RoomLevel; minutes: number | null; setAt: string };

/** One requested plan edit, after validation. Due dates and the teacher's AI rule are never editable. */
export type PlanEdit =
  | { kind: 'room'; key: string; level: RoomLevel; minutes: number | null }
  | { kind: 'workload'; assignmentId: string; label: StudentWorkload }
  | { kind: 'start-on'; assignmentId: string; date: string }
  | { kind: 'guess'; assignmentId: string; minutes: number }
  | { kind: 'normal-day'; minutes: number }
  | { kind: 'time-left'; minutes: number }
  | { kind: 'hide' | 'done-offline' | 'keep-active'; assignmentId: string };

/** StudentContext fields a plan change may write. */
export type PlanContextField = 'workload' | 'startOn' | 'guessMinutes' | 'hidden' | 'correction';

/** One stored value a change replaced, so undo can put it back. */
export type PlanWrite =
  | { slot: 'room'; key: string; before: DayRoomRecord | null; after: DayRoomRecord | null }
  | { [F in PlanContextField]: { slot: 'context'; key: string; field: F; before: StudentContext[F] | null; after: StudentContext[F] | null } }[PlanContextField]
  | { slot: 'session'; id: number; before: string | null; after: string | null };

/**
 * A plan change. The AI (or a panel control) proposes it; nothing is written
 * until the student applies it. `writes` records what apply replaced, for undo.
 */
export type PlanChangeRecord = {
  id: string;
  /** Chat thread that proposed it, or null for a panel control. */
  threadKey: string | null;
  edits: PlanEdit[];
  status: 'proposed' | 'applied' | 'undone' | 'dismissed';
  preview: PlanPreview;
  writes: PlanWrite[];
  createdAt: string;
  appliedAt: string | null;
  undoneAt: string | null;
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
  /** Draft state at the last proactive-hint evaluation, to require new evidence. */
  lastHintEval?: { hash: string; studentWords: number; at: string };
  /** When the last unprompted hint was shown, for the cooldown. */
  lastHintAt?: string;
  /** The student said they have time until then. Loomer never stops the session by itself. */
  plannedUntil?: string;
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
  /** Absent for page text. A screenshot stores its cropped image instead of text. */
  kind?: 'page' | 'screenshot';
  /** Cropped JPEG data URL for screenshots. */
  image?: string;
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

/**
 * Where the student left off on one assignment. Deliberately one small record
 * with no draft or page text, so opt-in cross-device sync can carry it later.
 */
export type ResumePacket = {
  assignmentId: string;
  sessionId: number;
  /** When the session paused or ended. */
  at: string;
  docId: string | null;
  edits: number;
  wordsDelta: number;
  sourceIds: string[];
  /** Fingerprints of the draft's paragraphs at that time; not reversible to text. */
  paragraphHashes: string[];
  dismissed: boolean;
};

/** A proactive hint shown during a session. */
export type HintRecord = {
  id: number;
  sessionId: number;
  assignmentId: string;
  text: string;
  /** Passage from the student's draft the hint points to. */
  quote: string;
  issueKey: string;
  /** Draft version the hint was made from. */
  docHash: string;
  createdAt: string;
  state: 'shown' | 'dismissed' | 'withdrawn';
};

/** Result of checking the draft against the requirement list, tied to one draft version. */
export type RequirementCheck =
  | { assignmentId: string; status: 'pending'; startedAt: string }
  | {
      assignmentId: string;
      status: 'ok';
      docHash: string;
      scope: 'full' | 'partial';
      createdAt: string;
      /** Indexes refer to the requirement list built by requirementList(). */
      items: { index: number; state: 'observed' | 'needs-review' | 'unknown'; quote: string; note: string }[];
    }
  | { assignmentId: string; status: 'failed'; createdAt: string; error: string };

/** One Ask Loomer turn. Replies stream into `blocks` while status is 'streaming'. */
export type ChatTurnRecord = {
  id: number;
  threadKey: string;
  role: 'student' | 'loomer';
  blocks: ChatBlock[];
  status: 'streaming' | 'done' | 'error' | 'stopped';
  error?: string;
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
  resumePackets!: EntityTable<ResumePacket, 'assignmentId'>;
  hints!: EntityTable<HintRecord, 'id'>;
  requirementChecks!: EntityTable<RequirementCheck, 'assignmentId'>;
  chatTurns!: EntityTable<ChatTurnRecord, 'id'>;
  dayRoom!: EntityTable<DayRoomRecord, 'key'>;
  planChanges!: EntityTable<PlanChangeRecord, 'id'>;

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
    this.version(4).stores({
      resumePackets: 'assignmentId, at',
      hints: '++id, sessionId, assignmentId, state',
    });
    this.version(5).stores({ requirementChecks: 'assignmentId' });
    this.version(6).stores({ chatTurns: '++id, threadKey' });
    this.version(7).stores({ dayRoom: 'key', planChanges: 'id, status' });
  }
}

export const db = new LoomerDb();
