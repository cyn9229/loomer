// Data contract for the assignment detail screen inside the panel. Logic owns
// this file; the UI renders useAssignmentDetail(assignmentId).
import type { EmbeddedSheet } from '../core/db';
import type { StudentCorrection, WorkItem } from './home';
import type { HelpAvailability, SourceItem } from './session';

/**
 * Requirement-level evidence. Observed: relevant content was found (not proof of
 * quality or correctness). Needs review: a specific possible issue with a quoted
 * passage. Unknown: not enough was observed; it never means "not started".
 */
export type RequirementState = 'observed' | 'needs-review' | 'unknown';

export type RequirementItem = {
  text: string;
  /** Passage in the instructions or rubric that states this requirement. */
  source: { quote: string; label: string };
  state: RequirementState;
  /** For observed / needs-review: the passage from the student's draft, and a short note. */
  evidence: { quote: string; note: string } | null;
};

export type RequirementsCheck = {
  at: string;
  /** How much of the draft was readable when checked. */
  scope: 'full' | 'partial' | 'none';
  /** The draft changed after this check; states may be out of date. */
  stale: boolean;
} | null;

export type AssignmentDetailModel =
  | { status: 'missing' }
  | {
      status: 'ok';
      item: WorkItem;
      /** Start of the instructions as Loomer read them (plain text, bounded). */
      descriptionExcerpt: string;
      requirements: RequirementItem[];
      check: RequirementsCheck;
      /** Whether "Check my draft against the requirements" may run (uses AI on the student's work). */
      checkAvailability: HelpAvailability | 'no-doc';
      checkPending: boolean;
      effort: { label: WorkItem['effort']['label']; reason: string | null; quote: string | null };
      /** The instructions rewritten simply (AI interpretation; explains the task, never does it). Null when AI is off or blocked. */
      plainWords: string | null;
      links: { instructions: string[]; doc: string | null; sources: SourceItem[] };
      correction: StudentCorrection;
      /**
       * The teacher's Google Doc embedded in the instructions. `ok`: Loomer read it
       * (it counts as instructions). `needs-permission`: offer "Allow Google Docs"
       * (permissions.request for DOCS_ORIGINS, then canvas:refresh). `no-access`:
       * Google refused (signed out, or the teacher turned off download).
       */
      sheet: { url: string; state: EmbeddedSheet['state'] } | null;
      /** The student's own explanation, shown in context only. */
      note: string | null;
    };
