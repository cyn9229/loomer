// Data contract for the work-session screen (pick 3B). Logic owns this file; the
// UI renders a SessionModel from useSessionModel() and acts only via messages.
import type { NextStep } from '../core/db';
import type { WorkItem } from './home';

export type DocReadState =
  /** Reading normally. */
  | 'ok'
  /** Google asked Loomer to slow down; reads resume automatically. */
  | 'rate-limited'
  /** Signed out of Google or no access to this Doc. */
  | 'no-access'
  /** Network or unexpected failure. */
  | 'unreadable'
  /** Linked, not read yet. */
  | 'waiting';

export type DocState =
  | {
      status: 'not-linked';
      /**
       * Google Docs linked (not embedded) in the instructions, offered for one-tap
       * linking. `label`: the teacher's link text, when there was one.
       */
      candidates: { docId: string; url: string; label: string | null }[];
    }
  | {
      status: 'linked';
      docId: string;
      url: string;
      readState: DocReadState;
      lastReadAt: string | null;
      /** Words the student wrote, excluding lines that match the assignment instructions. */
      studentWords: number | null;
    };

export type SourceItem = {
  id: string;
  title: string;
  url: string;
  capturedAt: string;
  excerptChars: number;
  /** A deliberate screenshot (partial visual evidence) rather than page text. */
  kind: 'page' | 'screenshot';
  /** Cropped image as a data URL, for screenshots only. */
  image: string | null;
  /**
   * Whether the linked draft mentions this source (its site's name, or two of
   * its own title words), by local word matching. `matched` shows the words.
   * Null when no draft is linked and read.
   */
  inDraft: { used: boolean; matched: string[] } | null;
};

/** The teacher asks for a number of sources ("at least 3 sources"): how many, how many are saved, and the words that ask. */
export type SourceNeed = { required: number; saved: number; quote: string } | null;

/** Factual activity only, e.g. "Edited your draft (+120 words)". Never time spent or progress. */
export type ActivityItem = { at: string; text: string };

export type ChatReference = { quote: string; from: 'your draft' | 'the instructions' };

export type ChatMessage = {
  id: number;
  role: 'student' | 'loomer';
  text: string;
  kind: 'question' | 'hint' | 'explanation' | 'example' | 'redirect' | 'review' | 'notice';
  references: ChatReference[];
  createdAt: string;
};

/**
 * Whether Loomer may help with this assignment's work. `needs-policy-answer` means
 * the UI should ask the one-time policy question (send policy:answer) before help.
 */
export type HelpAvailability = 'available' | 'needs-policy-answer' | 'ai-off' | 'blocked' | 'limited' | 'unresolved' | 'quiz';

export type HelpState = {
  availability: HelpAvailability;
  /** Passage behind a blocked or limited state, with its source label. */
  policyQuote?: string;
  policySource?: string;
  messages: ChatMessage[];
  /** A help or review request is in flight. */
  pending: boolean;
};

/** One proactive hint. Null until the pause rules make one eligible. `requirement`: the requirement it serves, when known. */
export type ProactiveHint = { id: number; text: string; reference: ChatReference | null; createdAt: string; requirement: string | null } | null;

/**
 * What this writing session works toward, picked near the start ("Build the
 * comparison between your two sources") with a one-line why. Null until picked,
 * or when none could be. Hints prefer to serve it.
 */
export type SessionFocusView = { text: string; why: string; requirement: string | null } | null;

/** A hint whose passage the student edited so that it now addresses it: show "Looks handled". Newest first, at most 3. */
export type HandledHint = { id: number; text: string; at: string };

/**
 * Research discovery (opt-in): the foreground tab's title and address share
 * distinctive words with the assignment. Never a claim the page is relevant;
 * the UI says "Researching for this assignment? Add this page."
 */
export type DiscoverySuggestion = {
  tabId: number;
  title: string;
  url: string;
  /** Assignment words found in the tab's title or address, for transparency. */
  matched: string[];
} | null;

/**
 * Topics on the sheet of practice or study work. `reading`: Loomer is reading
 * the sheet. Each quote is from the sheet. Topics are shortcuts to help and a
 * picture of where the student stands; there is nothing to tick.
 */
export type SheetTopics = {
  status: 'reading' | 'ok' | 'failed';
  /** In sheet order. Group by `sheet` when there is more than one sheet. */
  items: TopicItem[];
  /** What to do next, for the "Next:" line. Null when every topic is solid or skipped. */
  next: TopicNext;
} | null;

/**
 * One topic on the sheet. Tap opens Explain / Example / Quick check
 * (topic:help). `standing` comes from the student's own quick checks, never
 * from ticking: shaky is under 80% right on the latest check.
 */
export type TopicItem = {
  text: string;
  quote: string;
  /** The sheet's name, null if unknown. */
  sheet: string | null;
  standing: 'unchecked' | 'shaky' | 'solid';
  lastCheck: { correct: number; total: number; at: string } | null;
  /** The student skipped it (topic:skip), for example because the teacher dropped it. */
  skipped: boolean;
};

/** `mode`: the best first action (explain for a shaky topic, check for an unchecked one). */
export type TopicNext = { topic: string; reason: string; mode: 'explain' | 'check' } | null;

/**
 * A teacher's sheet embedded in the instructions. Loomer reads it on its own
 * (it counts as instructions), so the student never needs to link it. `title`:
 * the frame title or the sheet's first line. `state`: as AssignmentDetail's
 * sheet; needs-permission means offer "Allow Google Docs" (DOCS_ORIGINS, then
 * canvas:refresh). `topics`: how many topics were found on it, when known.
 */
export type TeacherSheet = {
  docId: string;
  url: string;
  title: string | null;
  state: 'ok' | 'no-access' | 'unreadable' | 'rate-limited' | 'needs-permission';
  topics: number | null;
};

/**
 * A suggestion to start, resume, or switch the session, from typing in a linked
 * Doc or the panel staying open on one assignment. Loomer never acts on it: show
 * [Start] / [Resume] / [Switch] (session:start or session:resume) and [Not now]
 * (nudge:dismiss, mutes it for 2 h). Read it with useNudge().
 */
export type WorkNudge = {
  assignmentId: string;
  title: string;
  action: 'start' | 'resume' | 'switch';
  reason: 'typing' | 'viewing';
  at: string;
} | null;

export type SessionModel =
  | { status: 'none' }
  | {
      status: 'active' | 'paused';
      sessionId: number;
      assignment: WorkItem;
      startedAt: string;
      /**
       * The student said they have time until then (chips at Start working, or chat).
       * Show "28 min left" instead of time so far, updated once a minute. At 5 min left,
       * a quiet note; at 0, [Stop here] (session:end) [Keep going] (session:time null).
       * Never stop the session automatically.
       */
      plannedUntil: string | null;
      /** Null unless the work is practice or study with a sheet that Loomer has started reading. */
      topics: SheetTopics;
      /** The teacher's sheets embedded in the instructions, already read by Loomer. Empty when there are none. */
      teacherSheets: TeacherSheet[];
      /** "2 of 3 sources saved" when the instructions ask for a number of sources. */
      sourceNeed: SourceNeed;
      doc: DocState;
      sources: SourceItem[];
      activity: ActivityItem[];
      help: HelpState;
      hint: ProactiveHint;
      focus: SessionFocusView;
      handledHints: HandledHint[];
      suggestion: DiscoverySuggestion;
      /** Facts for the end card: what this session did so far. */
      recap: SessionRecap;
      /**
       * The step for next time, after session:next-step. Null before it is asked
       * for, and for a quiz. `pending` while the AI writes it (a few seconds).
       */
      nextStep: { status: 'pending' } | ({ status: 'ready' } & NextStep) | null;
    };

/**
 * The end card's recap. `text` is the sentence to show, e.g. "You added 240
 * words and saved 2 sources in 35 minutes." Minutes count active time only.
 */
export type SessionRecap = {
  text: string;
  /** How sentences name the assignment: "this essay". */
  noun: string;
  minutes: number;
  wordsDelta: number;
  edits: number;
  sourcesSaved: number;
  topicsChecked: number;
};
