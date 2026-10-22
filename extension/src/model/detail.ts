// Data contract for the assignment detail screen inside the panel. Logic owns
// this file; the UI renders useAssignmentDetail(assignmentId).
import type { Failed, Pending } from './wait';
import type { StudentCorrection, WorkItem, WorkType } from './home';
import type { HelpAvailability, SourceItem, SourceNeed, TeacherSheet } from './session';
import type { TestPrep } from './prep';

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
  /** The latest hint that served this requirement: still open, or it looks handled. */
  hint: { text: string; state: 'open' | 'handled' } | null;
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
      /** The draft check while it runs; null otherwise. */
      checkPending: Pending | null;
      /** The last draft check ended badly (or stopped); shown where checkPending was. */
      checkFailed: Failed | null;
      effort: { label: WorkItem['effort']['label']; reason: string | null; quote: string | null };
      /** The instructions rewritten simply (AI interpretation; explains the task, never does it). Null when AI is off or blocked. */
      plainWords: string | null;
      /** plainWords in one short sentence (about 12 words), shown first; plainWords sits behind More. */
      plainShort: string | null;
      links: { instructions: string[]; doc: string | null; sources: SourceItem[] };
      correction: StudentCorrection;
      /**
       * The teacher's Google Docs embedded in the instructions (up to 3), each
       * named. `ok`: Loomer read it (it counts as instructions). `needs-permission`:
       * offer "Allow Google Docs" (permissions.request for DOCS_ORIGINS, then
       * canvas:refresh). `no-access`: Google refused (signed out, or the teacher
       * turned off download).
       */
      sheets: TeacherSheet[];
      /** "2 of 3 sources saved" when the instructions ask for a number of sources. */
      sourceNeed: SourceNeed;
      /** The student's own explanation, shown in context only. */
      note: string | null;
      /** For hand-added work: its current fields, for the edit form (assignment:edit). Null for Canvas items. */
      editable: EditableFields | null;
      /** Test prep, for a test or quiz due in the next two weeks once Loomer starts setting it up. */
      prep: TestPrep | null;
    };

/** The fields a student can set on hand-added work. */
export type EditableFields = { title: string; courseKey: string | null; dueAt: string | null; workType: WorkType | null; instructions: string | null; docUrl: string | null };
