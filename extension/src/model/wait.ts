// What the panel shows while the student waits on the AI, and when a wait ends
// badly. Built by the logic side from stored records and live timings; the UI
// never guesses a state or a time.

/** The kinds of AI work a student can wait on. Each has its own usual time. */
export const WAIT_TASKS = [
  'analysis',
  'check',
  'focus',
  'hint',
  'next-step',
  'topics',
  'prep-setup',
  'prep-notes',
  'questions',
  'like',
  'teach',
  'grade',
  'review',
  'reply',
  'tool',
  'visual',
  'quiz',
] as const;
export type WaitTask = (typeof WAIT_TASKS)[number];

export type WaitStep = { label: string; detail: string | null; status: 'done' | 'now' | 'next' };

/** A wait in progress. */
export type Pending = {
  /** A few words: "Writing 6 questions", "Reading the instructions". */
  title: string;
  /** What it is about, in general words: "Hawaii and the Congo". Null when there is nothing useful to say. */
  about: string | null;
  startedAt: string;
  /** How long this kind of wait usually takes, low and high, in seconds. From live timings when there are enough. */
  usualSec: [number, number];
  /** Real steps only; null when the work has no steps the extension can see. */
  steps: WaitStep[] | null;
  canCancel: boolean;
};

/** A wait that ended badly: one sentence with the reason. Shown where the Pending was. */
export type Failed = { text: string; retry: boolean };

/** Whether Loomer has read an assignment's instructions. */
export type ReadState = {
  state: 'waiting' | 'reading' | 'read' | 'changed' | 'failed' | 'blocked' | 'empty';
  /** read: when it finished. failed: when it failed. */
  at: string | null;
  /** failed: when Loomer tries again on its own. Null when it won't (use read:now). */
  retryAt: string | null;
  /**
   * blocked: ai-off, rule-no-ai, rule-unclear. empty: no-instructions, page-closed.
   * waiting: later (Loomer reads it within 14 days of the due date), past-due or no-date (read only when asked, with read:now); null when it is next in line.
   */
  reason: 'ai-off' | 'rule-no-ai' | 'rule-unclear' | 'no-instructions' | 'page-closed' | 'later' | 'past-due' | 'no-date' | null;
  /** After a read: what Loomer found, for Home's first-read list ("Found 3 things to hand in and 1 checkpoint"). */
  found: string | null;
  /** reading or changed while the call runs. */
  pending: Pending | null;
};
