// The data contract between Loomer's logic and its UI. The side panel renders a
// HomeModel and never queries the database or Canvas itself. Logic owns this
// file; UI code imports types from here and treats them as read-only.
import type { NextStep, RunOutcome, SlipReason } from '../core/db';
export type { SlipReason } from '../core/db';
import type { PlanChangeView } from './plan';
import type { TopicNext } from './session';

export type EffortLabel = 'Short' | 'Moderate' | 'Substantial' | 'Unknown';

/**
 * What kind of work an assignment is. The session shapes itself by it: writing
 * links a draft and gets writing hints; practice and study get concept help,
 * similar examples, quizzes, and a topic list; reading gets key terms and checks.
 */
export type WorkType = 'writing' | 'practice' | 'study' | 'reading';

/**
 * Effective AI policy for one assignment, from local rules over the syllabus and
 * instructions, plus any student answer. Only `permitted` allows help on the
 * student's own work; `blocked` turns every AI feature off for that assignment.
 */
export type PolicyState = 'blocked' | 'limited' | 'permitted' | 'none-found' | 'unresolved';

/** Where a statement came from. The UI may show these on demand ("Why this?"). */
export type EvidenceKind = 'school-fact' | 'ai-interpretation' | 'student-context' | 'limitation';

export type Evidence = {
  kind: EvidenceKind;
  /** One plain sentence, e.g. "Due Thu, Oct 22 at 7:59 PM". */
  text: string;
  /** Exact passage from the source, when there is one. Never invented. */
  quote?: string;
  /** e.g. "Canvas assignment", "Course syllabus", "Your answer". */
  sourceLabel: string;
  sourceUrl?: string;
  observedAt?: string;
};

export type RequirementsState = 'checked' | 'checking' | 'unreadable' | 'not-checked';

/**
 * Where an item belongs in "Other work". `no-date` and `past` are listed but
 * never ranked; a missing date does not mean unimportant, so keep them reachable.
 */
export type WorkBucket = 'soon' | 'later' | 'no-date' | 'past';

/**
 * An earlier date inside an assignment, taken from its instructions (for example
 * a draft due for peer review). `derived` means Loomer computed the date from a
 * relative phrase such as "the day before the final deadline"; quote shows it.
 */
export type Checkpoint = { text: string; at: string; quote: string; derived: boolean };

/**
 * When to begin, not just when it's due: the checkpoint (or due date) minus the
 * lead time for the requirement-based effort. A starting rule, not a time estimate.
 */
export type StartBy = { at: string; basis: 'due' | 'checkpoint' | 'student' };

/**
 * How much room the student said a day has. free is the default (no limit);
 * some is about 2 h, little about 30 min, busy means no starts that day.
 */
export type RoomLevel = 'free' | 'some' | 'little' | 'busy';

/**
 * One day's room as the planner uses it. `minutes` is the student's own number:
 * what they said for this day, or, on a free day, their normal day. Null when
 * they gave none. Show it only as their number, never as Loomer's estimate.
 */
export type DayRoom = {
  /** Local date, YYYY-MM-DD. */
  date: string;
  level: RoomLevel;
  minutes: number | null;
  /** Comes from a weekly rule ("Thursdays are busy"), not a one-day entry. */
  repeating: boolean;
};

/** What the student told Loomer about this item. Shown in context, never as a progress status. */
/** done-offline and turned-in both take it off the plan; turned-in comes back if Canvas never shows a submission. */
export type StudentCorrection = 'done-offline' | 'kept-active' | 'turned-in' | null;

export type WorkItem = {
  assignmentId: string;
  title: string;
  /** 'student': added by hand. Show "Added by you"; it can be edited and deleted, and Canvas never confirms it. */
  source: 'canvas' | 'student';
  /** For hand-added work: an open Canvas item that looks like the same assignment, so the student can remove their copy. */
  sameAsCanvas: { assignmentId: string; title: string } | null;
  /** Stable course key for grouping and filtering by class. */
  courseKey: string;
  courseName: string | null;
  /** Canvas page for the assignment. */
  url: string | null;
  due: { at: string; source: 'canvas' | 'instructions' } | null;
  /** Canvas and the instructions name different dates; show both, pick neither. */
  dueConflict: boolean;
  /** `student` means the student set the workload; show "You set this". Their label beats the AI's. */
  effort: { label: EffortLabel; reason: string | null; source: 'ai' | 'student' };
  /** The student's own guess for the whole task, in minutes. Loomer never makes this number. */
  guessMinutes: number | null;
  /** `student`: they set it ("You set this"). `ai`: from the requirement analysis. `rule`: from the Canvas kind, submission type, and title. */
  workType: { type: WorkType; source: 'student' | 'ai' | 'rule' };
  /**
   * The Canvas item is a quiz or test taken online. AI help on it is always off,
   * and Ask Loomer pauses while a session on it is active. Study for it in general chat beforehand.
   */
  quiz: boolean;
  policy: { state: PolicyState; quote?: string; sourceLabel?: string };
  requirements: RequirementsState;
  /** Labeled local replay data. The UI must mark it visibly. */
  replay: boolean;
  bucket: WorkBucket;
  /** The student hid it (item:hide). Show only in a "Hidden" group with Restore. */
  hidden: boolean;
  /** "I did this offline" leaves the queue; "Keep this active" keeps it ranked. */
  correction: StudentCorrection;
  startBy: StartBy | null;
  checkpoints: Checkpoint[];
  /** Plain-words reason for this item's place in the plan, e.g. "Second: start by Wed; the essay needs a start by Tue." */
  rankReason: string | null;
};

export type NextAction = {
  item: WorkItem;
  /** Specific verb and unit of work, e.g. "Outline the comparison between your two sources". The UI shows item.title under it, so the action never repeats the title. */
  action: string;
  /** One short, source-backed sentence for choosing it now. */
  reason: string;
  /** Expandable "Why this?" content. */
  evidence: Evidence[];
  /** False when the action is a fixed non-AI line (AI off, blocked, or unavailable). */
  aiGenerated: boolean;
  /** The student picked this (choice:set or starting a session); Loomer keeps it until evidence changes. */
  chosenByStudent: boolean;
  /** When the student's choice differs from Loomer's own pick, Loomer's pick and why. */
  loomerPick: { item: WorkItem; reason: string } | null;
  /** One line when the top of the plan moved since the last check, and why. Null when nothing moved. */
  change: string | null;
  /** The best thing Loomer found about this step, shown under it. Always set; 'countdown' is the fallback. */
  insight: Insight;
  /**
   * A start Loomer suggested that didn't happen. `count`: missed suggested days
   * since the student last worked on it. Ask "What got in the way?" only when
   * count is 1 and answer is null; slip:answer records it.
   */
  slip: { assignmentId: string; missedOn: string; count: number; answer: SlipReason | null } | null;
  /** Start with a short session: the main button reads "Start a 10-minute session" and sends session:start with these minutes. */
  quickStart: { minutes: number } | null;
  /** The instructions in plain words, set only after the student answered "Not sure how to start". */
  plainWords: string | null;
  /**
   * For practice or study work with a sheet: the topic to do next and why. When
   * set, `action` is "Review <topic>" (explain) or "Check <topic>" (quick
   * check); the primary button can send topic:help with this mode.
   */
  topic: TopicNext;
};

/**
 * What kind of find leads Home's why, picked in this order:
 * - slipped: Loomer suggested starting this on an earlier day and no session happened; `text` names it once, or what Loomer did after the student's answer.
 * - change: the top of the plan moved since the student last looked.
 * - continue: the student kept a next step at the end of their last session; `text` says what they did then.
 * - hidden-deadline: the instructions set a step before the due date.
 * - busy-day: the start moved earlier because the student said a day had little room.
 * - weak-topic: practice or study work with a shaky topic from quick checks.
 * - countdown: nothing new; the due date and days left.
 */
export type InsightKind = 'slipped' | 'change' | 'continue' | 'hidden-deadline' | 'busy-day' | 'weak-topic' | 'countdown';
/** One sentence that names the assignment and gives the concrete fact. `aiFound` is true only when the AI read the fact from the instructions. */
export type Insight = { kind: InsightKind; text: string; aiFound: boolean };

/** A class for the class picker. `key` is WorkItem.courseKey. */
export type CourseOption = { key: string; name: string };

/** Two or more bigger assignments need a start within two days of each other. */
export type CrowdedWeek = { text: string; assignmentIds: string[] } | null;

/** One sentence about today, shown on the first open each day until dismissed (brief:dismiss). */
export type DailyBrief = { date: string; text: string } | null;

/**
 * One quiet review of unresolved past-due work. Shown until the student acts on
 * each item (keep active, done offline, hide) or marks the review done; it comes
 * back only on new evidence, with the reason.
 */
export type OlderReview = { items: { item: WorkItem; reason: string }[] } | null;

export type CheckInfo = {
  at: string;
  outcome: RunOutcome;
  courses: number;
  /** True when Canvas paging hit its limit or a course failed: coverage is partial. */
  partial: boolean;
  replay: boolean;
};

/**
 * Shown on Home after a session ended or paused, until the student continues it,
 * starts another, or dismisses it (resume:dismiss). Facts only; no "you were away".
 */
export type ResumeBriefing = {
  assignment: WorkItem;
  /** When the last session paused or ended. */
  at: string;
  /** Factual lines, e.g. "Edited your draft 3 times (+240 words)", "Saved 2 sources". */
  facts: string[];
  sources: { title: string; url: string }[];
  docUrl: string | null;
  /** Requirements from the instructions, each with its quote (AI interpretation, may be empty). */
  requirements: { text: string; quote: string }[];
  /** Home's next action is a different assignment; the UI says why and keeps Continue one tap away. */
  recommendationChanged: boolean;
  /** Last session's focus, and how many hints the student handled in it. */
  focus: string | null;
  handledHints: number;
  /** The step the student kept for next time at the end card. */
  nextStep: NextStep | null;
};

export type HomeModel =
  /** No school connected yet. */
  | { status: 'not-connected' }
  /** First check still reading requirements. The list may show; no top action yet. */
  | {
      status: 'checking';
      progress: { checked: number; total: number };
      /** Items still being read, with what is pending, e.g. "Reading instructions". */
      pending: { title: string; detail: string }[];
      rest: WorkItem[];
      lastCheck: CheckInfo | null;
      resume: ResumeBriefing | null;
      olderReview: OlderReview;
      crowded: CrowdedWeek;
      brief: DailyBrief;
      /** Room for today and the next 13 days, for the Week view's day headers. */
      room: DayRoom[];
      /** The student's Canvas classes, for the class picker when adding work by hand. */
      courses: CourseOption[];
      /** Plan changes the student applied, newest first, each with Undo. Empty hides the line. */
      yourChanges: PlanChangeView[];
    }
  /** Unreadable or unchecked work could change the order, so no confident top pick. */
  | {
      status: 'cannot-compare';
      limitations: Evidence[];
      rest: WorkItem[];
      lastCheck: CheckInfo | null;
      resume: ResumeBriefing | null;
      olderReview: OlderReview;
      crowded: CrowdedWeek;
      brief: DailyBrief;
      /** Room for today and the next 13 days, for the Week view's day headers. */
      room: DayRoom[];
      /** The student's Canvas classes, for the class picker when adding work by hand. */
      courses: CourseOption[];
      /** Plan changes the student applied, newest first, each with Undo. Empty hides the line. */
      yourChanges: PlanChangeView[];
    }
  | {
      status: 'ready';
      next: NextAction;
      rest: WorkItem[];
      lastCheck: CheckInfo | null;
      resume: ResumeBriefing | null;
      olderReview: OlderReview;
      crowded: CrowdedWeek;
      brief: DailyBrief;
      /** Room for today and the next 13 days, for the Week view's day headers. */
      room: DayRoom[];
      /** The student's Canvas classes, for the class picker when adding work by hand. */
      courses: CourseOption[];
      /** Plan changes the student applied, newest first, each with Undo. Empty hides the line. */
      yourChanges: PlanChangeView[];
    }
  /** Connected and checked, nothing open in the decision window. */
  | {
      status: 'empty';
      rest: WorkItem[];
      lastCheck: CheckInfo | null;
      resume: ResumeBriefing | null;
      olderReview: OlderReview;
      crowded: CrowdedWeek;
      brief: DailyBrief;
      /** Room for today and the next 13 days, for the Week view's day headers. */
      room: DayRoom[];
      /** The student's Canvas classes, for the class picker when adding work by hand. */
      courses: CourseOption[];
      /** Plan changes the student applied, newest first, each with Undo. Empty hides the line. */
      yourChanges: PlanChangeView[];
    };
