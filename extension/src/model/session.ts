// Data contract for the work-session screen (pick 3B). Logic owns this file; the
// UI renders a SessionModel from useSessionModel() and acts only via messages.
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
      /** Google Docs linked from the assignment's instructions, offered for one-click linking. */
      candidates: { docId: string; url: string }[];
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
};

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

/** One proactive hint (M4). Null until the pause rules make one eligible. */
export type ProactiveHint = { id: number; text: string; reference: ChatReference | null; createdAt: string } | null;

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
 * Topics on the linked sheet of practice or study work, for the student to tick
 * off (topic:toggle). `reading`: Loomer is reading the sheet. Each quote is from
 * the sheet. Ticks are the student's own; Loomer never marks a topic done.
 */
export type SheetTopics = {
  status: 'reading' | 'ok' | 'failed';
  items: { text: string; quote: string; done: boolean }[];
} | null;

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
      /** Null unless the work is practice or study with a linked sheet that Loomer has started reading. */
      topics: SheetTopics;
      doc: DocState;
      sources: SourceItem[];
      activity: ActivityItem[];
      help: HelpState;
      hint: ProactiveHint;
      suggestion: DiscoverySuggestion;
    };
