// Data contract for "Ask Loomer": chat anywhere, not tied to a work session.
// Logic owns this file. A reply is a list of blocks; Markdown text streams in
// while the reply is being written. Visuals and quizzes come from tool calls
// the logic has validated; the UI renders them, never executes model HTML in
// the panel (interactive widgets go only to the sandboxed widget page).
import type { WorkItem, WorkType } from './home';
import type { PlanChangeView } from './plan';
import type { HelpAvailability } from './session';

/** "general" for concept questions, or an assignment id to ask about that assignment. */
export type ThreadKey = string;
export const GENERAL_THREAD: ThreadKey = 'general';

export type ChartSpec = {
  kind: 'bar' | 'line';
  labels: string[];
  series: { name: string; values: number[] }[];
  xLabel?: string;
  yLabel?: string;
};

export type Visual =
  /** Static diagram. The logic strips scripts and event handlers; the UI sanitizes again before inserting. */
  | { type: 'svg'; title: string; svg: string }
  | { type: 'chart'; title: string; chart: ChartSpec }
  /** Small self-contained HTML demo. Render ONLY inside the sandboxed widget page (no extension access, no network). */
  | { type: 'interactive'; title: string; html: string; height: number };

/**
 * Check-your-understanding questions on a concept. Answers are checked in the
 * panel. When `topic` is set (a quick check on a sheet topic), send
 * quiz:answer { quizId: id, questionIndex, correct } after each check; only
 * right or wrong is stored, to set the topic's standing.
 */
export type Quiz = {
  id: string;
  topic: string | null;
  concept: string;
  questions: { prompt: string; choices: string[]; answerIndex: number; explanation: string }[];
};

export type ChatBlock =
  /** Markdown (no raw HTML). May still be growing while the turn is streaming. */
  | { kind: 'markdown'; text: string }
  /** A tool the AI used, shown as a quiet status line, e.g. "Looked at your week". */
  | { kind: 'tool'; label: string; status: 'running' | 'done' | 'error' }
  | { kind: 'visual'; visual: Visual }
  | { kind: 'quiz'; quiz: Quiz }
  /** A link to open an assignment in the panel (the AI suggests; the student clicks). */
  | { kind: 'open-assignment'; assignmentId: string; title: string }
  /** A proposed plan change. Render ChatModel.planChanges[changeId]: Apply (plan:apply) / Not now (plan:dismiss), Undo once applied. */
  | { kind: 'plan-change'; changeId: string }
  /**
   * Work the student mentioned that isn't on their list. Add sends
   * assignment:add with these fields and draftId; ChatModel.added[draftId] is
   * the new assignment once added. The AI never adds anything itself.
   */
  | { kind: 'add-assignment'; draftId: string; draft: AddDraft }
  /** A file or screenshot the student attached to their message. The full file stays in chatFiles; this is what the chat shows. */
  | { kind: 'attachment'; fileId: number; file: AttachmentView }
  /** A finished test-prep practice, as one line in the test's chat. */
  | { kind: 'practice-result'; practiceId: string; line: string; detail: string; mistakes: number }
  /** "Review my draft" (help:review): findings, each quoting the student's own text. */
  | { kind: 'draft-check'; summary: string; findings: DraftFinding[]; scope: 'full' | 'partial' };

/**
 * A file read on this computer, ready to send (chat:send attachments, max 5).
 * Images are shrunk JPEGs with a thumbnail; PDFs go to the model as they are;
 * text is read up to 100,000 characters (`truncated` when cut).
 */
export type Attachment =
  | { kind: 'image'; name: string; dataUrl: string; width: number; height: number; thumb: string }
  | { kind: 'pdf'; name: string; dataUrl: string; bytes: number }
  | { kind: 'text'; name: string; text: string; truncated: boolean };

/** How a sent attachment shows: `detail` is e.g. "1200 × 800", "2.4 MB", or "Read the first 100,000 characters". */
export type AttachmentView = { kind: Attachment['kind']; name: string; thumb: string | null; detail: string };

/** One review finding. `quote` is from the student's draft; `question` helps them fix it themselves. */
export type DraftFinding = { issue: string; criterion: string; question: string; quote: string };

/**
 * One row in the chat switcher. General first; then current work (open, not
 * hidden, not done), newest message first, then the rest by due date; then
 * "earlier" (past due, done, turned in, or hidden) when it has messages.
 */
export type ThreadSummary = {
  threadKey: ThreadKey;
  title: string;
  courseName: string | null;
  /** The last message as one line; null when the thread has none yet. */
  lastText: string | null;
  lastAt: string | null;
  group: 'general' | 'current' | 'earlier';
};

/** A conversation set aside by "Start fresh". chat:restore brings its messages back in time order; nothing is replaced. */
export type SetAsideChat = { id: string; threadKey: ThreadKey; title: string; startedAt: string; endedAt: string; count: number; preview: string };

/** A proposed hand-added assignment. `courseName` is for display; null fields were not said. */
export type AddDraft = { title: string; courseKey: string | null; courseName: string | null; dueAt: string | null; workType: WorkType | null };

export type ChatTurn = {
  id: number;
  role: 'student' | 'loomer';
  blocks: ChatBlock[];
  status: 'streaming' | 'done' | 'error' | 'stopped';
  error?: string;
  createdAt: string;
};

export type ChatModel = {
  threadKey: ThreadKey;
  /** The assignment this thread is about, if any. */
  assignment: WorkItem | null;
  /**
   * General threads need only AI consent. Assignment threads also pass the
   * assignment's AI policy; 'needs-policy-answer' means ask the one-time question.
   */
  availability: HelpAvailability;
  turns: ChatTurn[];
  /** A reply is being written; offer Stop. */
  streaming: boolean;
  /** Plan changes proposed in this thread, by id, with their current status and preview. */
  planChanges: Record<string, PlanChangeView>;
  /** Add cards already applied: draftId to the new assignment's id. */
  added: Record<string, string>;
  /** Every thread the switcher lists. */
  threads: ThreadSummary[];
  /** Conversations set aside in any thread, newest first. */
  setAside: SetAsideChat[];
};
