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

export type WorkItem = {
  assignmentId: string;
  title: string;
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
};

export type NextAction = {
  item: WorkItem;
  /** Specific verb and unit of work, e.g. "Outline the comparison between your two sources". */
  action: string;
  /** One short, source-backed sentence for choosing it now. */
  reason: string;
  /** Expandable "Why this?" content. */
  evidence: Evidence[];
  /** False when the action is a fixed non-AI line (AI off, blocked, or unavailable). */
  aiGenerated: boolean;
};

export type CheckInfo = {
  at: string;
  outcome: RunOutcome;
  courses: number;
  /** True when Canvas paging hit its limit or a course failed: coverage is partial. */
  partial: boolean;
  replay: boolean;
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
    }
  /** Unreadable or unchecked work could change the order, so no confident top pick. */
  | { status: 'cannot-compare'; limitations: Evidence[]; rest: WorkItem[]; lastCheck: CheckInfo | null }
  | { status: 'ready'; next: NextAction; rest: WorkItem[]; lastCheck: CheckInfo | null }
  /** Connected and checked, nothing open in the decision window. */
  | { status: 'empty'; rest: WorkItem[]; lastCheck: CheckInfo | null };
