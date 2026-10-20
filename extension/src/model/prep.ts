// Data contract for test prep: the plan on the test's page, Home's step for
// the day, and the practice view. Logic owns this file; the UI reads it.
import type { PRACTICE_KINDS, PREP_FORMATS } from '../../../shared/ai-contract';

export type PrepFormat = (typeof PREP_FORMATS)[number];
export type PracticeKind = (typeof PRACTICE_KINDS)[number];
export type Standing = 'unchecked' | 'shaky' | 'solid';

/** On the test's page (AssignmentDetailModel.prep). */
export type TestPrep = {
  assignmentId: string;
  testAt: string;
  /** setup: Loomer is still finding topics (or couldn't: `error`). ready: the plan below is live. */
  status: 'setup' | 'ready';
  error: string | null;
  /** "5 of 8 topics on this test are solid, and Latin America still needs work." Never a grade. */
  readiness: string;
  counts: { solid: number; shaky: number; unchecked: number };
  topics: PrepTopic[];
  formats: {
    selected: PrepFormat[];
    /** Where Loomer saw each format named. */
    found: Partial<Record<PrepFormat, 'canvas' | 'guide' | 'notes'>>;
    /** The student answered "What's on this test?"; show the chips only while false and nothing was found. */
    asked: boolean;
  };
  plan: PrepDay[];
  mistakes: PrepMistake[];
  /** found: "From your notes, Loomer found 2 more topics and 7 key terms." */
  notes: { photos: number; found: string | null };
};

/** `new`: just found in notes, shown with an x until kept (prep:topics-edit keep). */
export type PrepTopic = { id: string; text: string; standing: Standing; lastCheck: { correct: number; total: number } | null; source: 'guide' | 'notes' | 'student'; new: boolean };

export type PrepDayKind = 'check-all' | 'focus' | 'practice-test' | 'warm-up';

/** One day of the plan, from the first prep day to the test day. */
export type PrepDay = {
  date: string;
  kind: PrepDayKind;
  /** "10 minutes on the Congo and Latin America" */
  step: string;
  /** "Done, 5 solid" / "Today" / "The day before" / "Morning of" / "Today · 2 topics come back so they stick" */
  sub: string;
  status: 'done' | 'today' | 'later' | 'missed';
};

/** A practice answer that was wrong. sub: "Missed Tue" or "Missed Tue, then right". */
export type PrepMistake = { id: string; topicId: string; topic: string; label: string; sub: string };

/** Home's step when the top item is a test with prep. The main button sends prep:start. */
export type PrepStep = { assignmentId: string; kind: PrepDayKind | 'comeback'; minutes: number; counts: TestPrep['counts']; readiness: string };

/** The one practice in progress or just finished (usePracticeModel). */
export type Practice = {
  id: string;
  assignmentId: string;
  title: string;
  /** 0-based position and the number of questions. */
  index: number;
  total: number;
  /** Null while Loomer writes the questions (or the next "Try one like it"). */
  question: PracticeQuestion | null;
  answer: PracticeAnswer | null;
  done: PracticeSummary | null;
  /** One sentence when writing the questions failed. */
  error: string | null;
};

export type PracticeQuestion = {
  id: string;
  topic: string;
  kind: PracticeKind;
  prompt: string;
  /** Multiple choice only. */
  options: string[];
  /** Vocabulary only: the term on the front, the definition on the back. */
  term: string | null;
  definition: string | null;
  /** Written by "Try one like it". */
  like: boolean;
};

export type PracticeAnswer =
  | { kind: 'mcq'; picked: number; correct: number; right: boolean; why: string }
  | { kind: 'vocab'; knew: boolean }
  | { kind: 'math'; right: boolean; answer: string; why: string; worked: { problem: string; steps: string[] } | null }
  | { kind: 'short' | 'explain'; status: 'pending' | 'ready'; met: { need: string; quote: string }[]; missing: { need: string; hint: string }[] }
  | { kind: 'frq'; status: 'pending' | 'ready'; needs: { need: string; met: boolean; note: string }[] };

export type PracticeSummary = {
  /** "You did 10 minutes on the Congo and Latin America." */
  line: string;
  /** "The Congo is solid now, and Latin America still needs one more round before Friday." */
  detail: string;
  topics: { text: string; standing: Standing; lastCheck: { correct: number; total: number } | null }[];
  mistakes: number;
};
