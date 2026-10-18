// The data contract between Loomer's logic and its UI. The side panel renders a
// HomeModel and never queries the database or Canvas itself. Logic owns this
// file; UI code imports types from here and treats them as read-only.
import type { RunOutcome } from '../core/db';

export type EffortLabel = 'Short' | 'Moderate' | 'Substantial' | 'Unknown';

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
export type StartBy = { at: string; basis: 'due' | 'checkpoint' };

/** What the student told Loomer about this item. Shown in context, never as a progress status. */
export type StudentCorrection = 'done-offline' | 'kept-active' | null;

export type WorkItem = {
  assignmentId: string;
  title: string;
  /** Stable course key for grouping and filtering by class. */
  courseKey: string;
  courseName: string | null;
  /** Canvas page for the assignment. */
  url: string | null;
  due: { at: string; source: 'canvas' | 'instructions' } | null;
  /** Canvas and the instructions name different dates; show both, pick neither. */
  dueConflict: boolean;
  effort: { label: EffortLabel; reason: string | null };
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
};

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
    };
