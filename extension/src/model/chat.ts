// Data contract for "Ask Loomer": chat anywhere, not tied to a work session.
// Logic owns this file. A reply is a list of blocks; Markdown text streams in
// while the reply is being written. Visuals and quizzes come from tool calls
// the logic has validated; the UI renders them, never executes model HTML in
// the panel (interactive widgets go only to the sandboxed widget page).
import type { WorkItem } from './home';
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

/** Check-your-understanding questions on a concept. Answers are checked in the panel and never stored. */
export type Quiz = {
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
  | { kind: 'open-assignment'; assignmentId: string; title: string };

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
};
