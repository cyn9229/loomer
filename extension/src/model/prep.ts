// Data contract for test prep: the plan on the test's page, Home's step,
// the practice view, the diagnosis, and teaching blocks. Logic owns this file;
// the UI reads it.
import type { PRACTICE_KINDS, PRACTICE_SKILLS, PREP_FORMATS, TEACH_KINDS } from '../../../shared/ai-contract';

export type PrepFormat = (typeof PREP_FORMATS)[number];
export type PracticeKind = (typeof PRACTICE_KINDS)[number];
export type PracticeSkill = (typeof PRACTICE_SKILLS)[number];
export type Standing = 'unchecked' | 'shaky' | 'solid';
/** One multiple-choice answer with the student's confidence: right and sure, right but a guess, wrong but sure, wrong and a guess. */
export type Outcome = 'solid' | 'shaky' | 'mixup' | 'gap';
export type Confidence = 'sure' | 'guessing';

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
  /** The time the student gave this test today (prep:time). Ask once a day while asked is false. */
  today: { minutes: number | null; asked: boolean };
  /** "Fits your 1 hour", when today's sessions were fit to the student's time. */
  fits: string | null;
  /** The sleep line when the test is tomorrow: Loomer plans nothing late tonight. */
  note: string | null;
  /** Study sessions from now to the test. */
  plan: PrepSession[];
  mistakes: PrepMistake[];
  /** Teaching blocks from practice, newest first: "Reread before the test". */
  blocks: TeachBlock[];
  /** found: "From your notes, Loomer found 2 more topics and 7 key terms." */
  notes: { photos: number; found: string | null };
};

/** `new`: just found in notes, shown with an x until kept (prep:topics-edit keep). `mixup`: the latest check had a sure-but-wrong answer. */
export type PrepTopic = { id: string; text: string; standing: Standing; lastCheck: { correct: number; total: number } | null; source: 'guide' | 'notes' | 'student'; new: boolean; mixup: boolean };

/**
 * What a session does. diagnostic: 2 or 3 questions per topic with Sure or
 * Guessing. focus: teach and practice the weakest topics. mixed-check: a short
 * mixed check later the same day. practice-test: the test's formats.
 * review: a light review the day before. warm-up: the morning of. rescue:
 * 10 minutes on the weakest topics when the test is today.
 */
export type PrepSessionKind = 'diagnostic' | 'focus' | 'mixed-check' | 'practice-test' | 'review' | 'warm-up' | 'rescue';

export type PrepSession = {
  id: string;
  date: string;
  when: 'now' | 'next' | 'later-today' | 'morning' | 'day';
  /** "Now", "Next", "After dinner, around 7 PM", "Tomorrow morning", "Saturday" */
  label: string;
  kind: PrepSessionKind;
  minutes: number;
  /** "10 minutes on the Congo and Latin America" */
  step: string;
  /** "Done, 5 solid" / "Skipped" / "" */
  sub: string;
  status: 'done' | 'today' | 'later' | 'missed';
  /** "Back after 3 days", when the session brings topics back. */
  back: string | null;
  /** For a later-today session: when it opens, and whether a reminder is set (prep:remind). */
  remindAt: string | null;
  reminder: boolean;
};

/** A practice answer that was wrong. sub: "Missed Tue" or "Missed Tue, then right". */
export type PrepMistake = { id: string; topicId: string; topic: string; label: string; sub: string };

/**
 * Home's step when the top item is a test with prep. The main button sends
 * prep:start. `waiting`: the next session is later today; show it with
 * "Start it now anyway" (prep:start).
 */
export type PrepStep = {
  assignmentId: string;
  kind: PrepSessionKind;
  minutes: number;
  counts: TestPrep['counts'];
  readiness: string;
  waiting: { label: string; step: string; remindAt: string; reminder: boolean } | null;
};

/** The one practice in progress or just finished (usePracticeModel). */
export type Practice = {
  id: string;
  assignmentId: string;
  title: string;
  mode: 'diagnostic' | 'practice' | 'mistake';
  /** 0-based position and the number of questions. */
  index: number;
  total: number;
  /** Null while Loomer writes the questions, a check, or a teaching block. */
  question: PracticeQuestion | null;
  answer: PracticeAnswer | null;
  /** A teaching block shown as its own step instead of a question; "Check it" sends prep:next. */
  teach: TeachBlock | null;
  done: PracticeSummary | null;
  /** One sentence when writing failed. */
  error: string | null;
};

export type PracticeQuestion = {
  id: string;
  topic: string;
  kind: PracticeKind;
  skill: PracticeSkill;
  prompt: string;
  /** Multiple choice only. */
  options: string[];
  /** Vocabulary only: the term on the front, the definition on the back. */
  term: string | null;
  definition: string | null;
  /** Written by "Try one like it", or a check after a teaching block. */
  like: boolean;
};

/**
 * `text`: what the student wrote, kept so "Your answer" survives a reload.
 * Multiple choice: `why` is the AI's reason; `next` says what happens now
 * ("You were sure, and the answer was “…”, so Loomer explains it next.").
 */
export type PracticeAnswer =
  | { kind: 'mcq'; picked: number; correct: number; right: boolean; confidence: Confidence | null; outcome: Outcome; why: string; next: string }
  | { kind: 'vocab'; knew: boolean }
  | { kind: 'math'; text: string; right: boolean; answer: string; why: string; worked: { problem: string; steps: string[] } | null }
  | { kind: 'short' | 'explain'; text: string; status: 'pending' | 'ready'; met: { need: string; quote: string }[]; missing: { need: string; hint: string }[] }
  | { kind: 'frq'; text: string; status: 'pending' | 'ready'; needs: { need: string; met: boolean; note: string }[] };

export type PracticeSummary = {
  /** "You did 10 minutes on the Congo and Latin America." / "Here's where you are for tomorrow's Unit 5 Test." */
  line: string;
  /** "The Congo is solid now, and Latin America still needs one more round before Friday." */
  detail: string;
  topics: { text: string; standing: Standing; lastCheck: { correct: number; total: number } | null }[];
  mistakes: number;
  /** After a diagnostic: one calm line per topic, mix-ups and gaps first. */
  diagnosis: { topicId: string; topic: string; outcome: Outcome; line: string }[] | null;
};

export type TeachKind = (typeof TEACH_KINDS)[number];

/** A short lesson after a miss. Only the fields its kind uses are set. */
export type TeachBlock = {
  id: string;
  topic: string;
  kind: TeachKind;
  title: string;
  /** "You picked “Hawaii's people voted to join the United States”, and the answer is “American planters overthrew the queen”." */
  miss: string | null;
  text: string | null;
  /** A passage from the study guide that backs it. */
  quote: { text: string; source: string } | null;
  compare: { heads: [string, string]; rows: { label: string; a: string; b: string }[] } | null;
  /** Timeline events, or the boxes of a visual. */
  steps: { when: string; text: string }[] | null;
  /** FRQ skill: fixed wording and labeled blanks, never filled in. */
  frame: (string | { blank: string })[] | null;
  /** A second, different explanation after another miss. */
  again: boolean;
};
