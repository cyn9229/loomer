// Local evidence store (IndexedDB via Dexie). Holds what sources reported and
// when. Student-provided context lives in its own table (studentContext) so a
// refresh can never overwrite it.
import Dexie, { type EntityTable } from 'dexie';
import type { CanvasFailureKind } from '../adapters/canvas/client';
import type { Attachment, ChatBlock } from '../model/chat';
import type { PracticeAnswer, PracticeKind, PracticeSkill, PrepFormat, PrepSessionKind, TeachBlock } from '../model/prep';
import type { EffortLabel, RoomLevel, WorkType } from '../model/home';
import type { PlanPreview } from '../model/plan';
import type { PolicyAnswer } from './gate';

export type PlannableKind = 'assignment' | 'quiz' | 'discussion_topic';

/**
 * Only workflow flags. Scores and other grade fields from Canvas are dropped at
 * parse time. `graded` says only that the teacher marked it (for work handed in
 * on paper, `submitted` stays false). `markedDone` is the student's own "Mark as
 * done" in Canvas. Both are absent on records stored before they existed.
 */
export type SubmissionState = { submitted: boolean; excused: boolean; missing: boolean; late: boolean; graded?: boolean; markedDone?: boolean };

/** Canvas shows this work as finished: turned in, excused, graded without being missing, or checked off by the student. */
export function doneInCanvas(s: SubmissionState | null): boolean {
  return Boolean(s && (s.submitted || s.excused || s.markedDone || (s.graded && !s.missing)));
}

export type AssignmentDetail = {
  observedAt: string;
  /** Hash of text, links, and rubric; a change means requirements must be re-checked. */
  hash: string;
  text: string;
  links: string[];
  rubric: { description: string; points: number | null }[];
  submissionTypes: string[];
  canvasUpdatedAt: string | null;
  /** Google Docs embedded in the instructions (the teacher's sheets), by Doc id. Absent on older records. */
  embeddedDocs?: string[];
  /** The frame title the page gave an embedded Doc, by Doc id. */
  embedTitles?: Record<string, string>;
  /** Each link's visible text in the instructions, by link address (the teacher's name for it). */
  linkLabels?: Record<string, string>;
  /**
   * Up to MAX_SHEETS embedded Docs as Loomer read them, in page order. Their
   * text counts as part of the instructions (see instructionText), and their
   * hashes are part of `hash`.
   */
  sheets?: EmbeddedSheet[];
};

/** Embedded sheets read per assignment. */
export const MAX_SHEETS = 3;

/**
 * The teacher's instructions as AI and local rules see them: the Canvas text,
 * plus the embedded sheet's text when Loomer read it.
 */
export function instructionText(detail: AssignmentDetail | null | undefined): string {
  if (!detail) return '';
  const sheets = (detail.sheets ?? []).flatMap((s) => (s.text ? [`Sheet embedded in the instructions${s.title ? ` ("${s.title}")` : ''}:\n${s.text}`] : []));
  return [detail.text, ...sheets].join('\n\n');
}

export type EmbeddedSheet = {
  docId: string;
  state: 'ok' | 'no-access' | 'unreadable' | 'rate-limited' | 'needs-permission';
  /** A name for the sheet: the frame's title, else the first line of its text. Null until known. */
  title: string | null;
  text: string | null;
  textHash: string | null;
  attemptAt: string;
};

/** A sheet's name from its frame title or its first line of text. */
export function sheetTitle(frameTitle: string | undefined, text: string | null): string | null {
  if (frameTitle) return frameTitle.slice(0, 80);
  const first = text?.split('\n').map((l) => l.trim()).find((l) => l.length >= 3);
  return first ? first.slice(0, 80) : null;
}

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
  /** Added by the student, not read from Canvas. Canvas checks never touch it; the student edits and deletes it. */
  addedBy?: 'student';
  /** The Ask Loomer card it was added from, so the card shows it as added. */
  draftId?: string;
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
      /** The AI's reading of the kind of work; absent on older analyses. */
      workType?: WorkType;
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
  /** done-offline: "Did it on paper" (leaves the queue). kept-active: stays ranked. turned-in: the student said they submitted it; it leaves the plan, and comes back a day after the due date if Canvas never shows it. */
  correction?: 'done-offline' | 'kept-active' | 'turned-in';
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
  /** The student's own work type. Beats the AI's and the rules'. */
  workType?: WorkType;
  /** Sheet topics the student skipped (for example the teacher dropped them), by topic key. */
  topicsSkipped?: string[];
  /** Local dates (YYYY-MM-DD) Home suggested starting this today, newest last, at most 14. */
  suggestedStarts?: string[];
  /** The student's answer to "What got in the way?" for the start missed on `missedOn`. */
  slipAnswer?: { missedOn: string; reason: SlipReason | 'dismissed'; at: string };
};

/** Why a suggested start didn't happen, in the student's own pick. */
export type SlipReason = 'too-big' | 'not-sure' | 'no-time' | 'not-feeling-it';

/**
 * One answer on a quick check about a sheet topic: right or wrong only, never
 * the question or answer text. The latest check per topic sets its standing.
 */
export type TopicCheckRecord = { id: number; assignmentId: string; topic: string; quizId: string; question: number; correct: boolean; at: string };

/** Topics read from the linked sheet of practice or study work, each with its quote from the sheet. */
export type SheetTopicsRecord =
  | { assignmentId: string; status: 'pending'; docHash: string; createdAt: string }
  | { assignmentId: string; status: 'ok'; docHash: string; createdAt: string; topics: { text: string; quote: string; sheetId: string }[] }
  | { assignmentId: string; status: 'failed'; docHash: string; createdAt: string; error: string };

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
  | { kind: 'work-type'; assignmentId: string; type: WorkType }
  | { kind: 'normal-day'; minutes: number }
  | { kind: 'time-left'; minutes: number }
  | { kind: 'hide' | 'done-offline' | 'keep-active'; assignmentId: string };

/** StudentContext fields a plan change may write. */
export type PlanContextField = 'workload' | 'startOn' | 'guessMinutes' | 'hidden' | 'correction' | 'workType';

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
  /** The session's focus. Absent until picked; null when none could be. */
  focus?: SessionFocus;
  /** One step for next time, asked for from the end card. Pending while the AI writes it. */
  nextStep?: { status: 'pending'; at: string } | ({ status: 'ready' } & NextStep);
};

/** A step for the next session. aiGenerated is false once the student edits it. */
export type NextStep = { text: string; aiGenerated: boolean };

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
  /** The session's focus, and how many hints the student handled in it. Absent on older packets. */
  focus?: string;
  handledHints?: number;
  /** The step the student kept at "Done for today". Home's Continue line uses it. */
  nextStep?: NextStep;
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
  /**
   * shown: on screen. changed: the student edited the passage; the next hint
   * call judges it. handled: the edit addresses it ("Looks handled").
   * withdrawn: the edit did not, or it went stale. dismissed: the student said no.
   */
  state: 'shown' | 'changed' | 'handled' | 'dismissed' | 'withdrawn';
  /** The requirement it serves, by its text, when the model named one. */
  requirement?: string;
  /** When the state last changed (for changed and handled). */
  settledAt?: string;
};

/** What a writing session works toward. Null when no focus could be picked. */
export type SessionFocus = { text: string; why: string; requirement: string | null; at: string } | null;

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
  /** Set by "Start fresh": the turn is out of the conversation (and the AI's history) until restored. */
  setAsideId?: string;
};

/** A file attached to a chat message, kept whole on this computer. The chat shows its AttachmentView. */
export type ChatFileRecord = { id: number; threadKey: string; attachment: Attachment };

/** Test prep for one test: its topics, key terms, and formats. Plan days and standings are computed, not stored. */
export type PrepRecord = {
  assignmentId: string;
  /** Local date the plan starts (the first day Loomer set it up). */
  startDay: string;
  status: 'setup' | 'ready' | 'failed';
  error?: string;
  /** When setup last failed, for the hourly retry. */
  failedAt?: string;
  topics: { id: string; text: string; source: 'guide' | 'notes' | 'student'; new: boolean; removed: boolean }[];
  terms: { term: string; definition: string }[];
  formats: { selected: PrepFormat[]; found: Partial<Record<PrepFormat, 'canvas' | 'guide' | 'notes'>>; asked: boolean };
  notes: { photos: number; found: string | null };
  /** The time the student gave this test on `day` (prep:time). */
  today?: { day: string; minutes: number };
  /** Session ids with a reminder set (prep:remind). */
  reminders?: string[];
};

/** A teaching block after a miss, shown before its check questions. Pending while the AI writes it. */
export type TeachRecord = { afterQuestionId: string; status: 'pending' | 'ready' | 'failed'; shown: boolean; block: TeachBlock };

/** One practice question as written, with its answer key (never shown before the student answers). */
export type PracticeQuestionRecord = {
  id: string;
  topicId: string;
  topic: string;
  kind: PracticeKind;
  skill: PracticeSkill;
  label: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  why: string;
  term: string;
  definition: string;
  answer: string;
  worked: { problem: string; steps: string[] } | null;
  needs: string[];
  like: boolean;
  /** A check after this teaching block (TeachBlock.id). */
  checkOf?: string;
};

/** A practice run: its questions, the student's answers, and when it ended. `dayKind` ties it to the plan. */
export type PracticeRecord = {
  id: string;
  assignmentId: string;
  /** mistake: practice on one earlier wrong answer (prep:start with mistakeId). */
  dayKind: PrepSessionKind | 'mistake';
  /** The plan session it belongs to (PrepSession.id), or null for a mistake. */
  sessionId: string | null;
  day: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** The student closed the finished practice (prep:close), or started another. */
  closed: boolean;
  /** Loomer is writing questions (the first batch, or "Try one like it"). */
  writing: boolean;
  error: string | null;
  index: number;
  questions: PracticeQuestionRecord[];
  answers: Record<string, PracticeAnswer>;
  blocks: TeachRecord[];
  /** The teaching block on screen (prep:next shows it, then moves to its check). */
  showing: string | null;
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
  chatFiles!: EntityTable<ChatFileRecord, 'id'>;
  preps!: EntityTable<PrepRecord, 'assignmentId'>;
  practices!: EntityTable<PracticeRecord, 'id'>;
  dayRoom!: EntityTable<DayRoomRecord, 'key'>;
  planChanges!: EntityTable<PlanChangeRecord, 'id'>;
  sheetTopics!: EntityTable<SheetTopicsRecord, 'assignmentId'>;
  topicChecks!: EntityTable<TopicCheckRecord, 'id'>;

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
    this.version(8).stores({ sheetTopics: 'assignmentId' });
    this.version(9).stores({ topicChecks: '++id, assignmentId, quizId' });
    // One conversation per assignment: the old session help messages move into the assignment's chat thread.
    this.version(10).upgrade(async (tx) => {
      const old = await tx.table<ChatRecord>('chat').toArray();
      const turns = old
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id - y.id)
        .map((m) => ({
          threadKey: m.assignmentId,
          role: m.role,
          blocks: [{ kind: 'markdown' as const, text: [m.text, ...m.references.map((r) => `> ${r.quote}`)].join('\n\n') }],
          status: 'done' as const,
          createdAt: m.createdAt,
        }));
      await tx.table('chatTurns').bulkAdd(turns);
      await tx.table('chat').clear();
    });
    this.version(11).stores({ chatFiles: '++id, threadKey' });
    this.version(12).stores({ preps: 'assignmentId', practices: 'id, assignmentId' });
  }
}

export const db = new LoomerDb();
