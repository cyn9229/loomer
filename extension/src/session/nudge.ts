// Work nudges: "Working on X? Start a session." Loomer notices two signals that
// already exist and carry no content: typing in a Doc the student linked to an
// assignment, and the panel staying open on one assignment. It only suggests;
// it never starts, resumes, or reads anything, and keeps no history. State lives
// in chrome.storage.session (memory only, cleared when the browser closes).
import { storage } from 'wxt/utils/storage';
import type { WorkNudge } from '../model/session';

/** A typing burst must have this many pings (at most one per 2 s) spread over this long. */
const TYPING_MIN_PINGS = 3;
const TYPING_MIN_SPAN_MS = 45_000;
/** The panel open on one assignment this long. */
const VIEWING_MIN_MS = 3 * 60_000;
/** A gap this long starts a new burst or a new viewing stretch. */
const SIGNAL_GAP_MS = 3 * 60_000;
/** "Not now" mutes that assignment this long. */
export const MUTE_MS = 2 * 60 * 60_000;
/** A nudge with no new signal for this long disappears. */
export const NUDGE_STALE_MS = 15 * 60_000;

export type NudgeSignal = { kind: 'typing' | 'viewing'; assignmentId: string; title: string; at: number };
export type SessionNow = { assignmentId: string; state: 'active' | 'paused' } | null;

type Stretch = { first: number; last: number; count: number };
export type NudgeState = {
  nudge: WorkNudge;
  typing: Record<string, Stretch>;
  viewing: Record<string, Stretch>;
  /** Assignment id to the time its mute ends. */
  muted: Record<string, number>;
};

export const EMPTY_NUDGE_STATE: NudgeState = { nudge: null, typing: {}, viewing: {}, muted: {} };
/** The signal counts. Not watched by the panel, so typing pings cause no re-rendering. */
const signalsItem = storage.defineItem<Omit<NudgeState, 'nudge'>>('session:nudgeSignals', { fallback: { typing: {}, viewing: {}, muted: {} } });
/** The nudge itself. The panel watches this; it changes only when the nudge does. */
export const nudgeItem = storage.defineItem<WorkNudge>('session:nudge', { fallback: null });

export async function loadNudgeState(): Promise<NudgeState> {
  const [signals, nudge] = await Promise.all([signalsItem.getValue(), nudgeItem.getValue()]);
  return { ...signals, nudge };
}

/** Saves the state; writes the watched nudge only when it changed. Returns true when a new nudge appeared. */
export async function saveNudgeState(prev: NudgeState, next: NudgeState): Promise<boolean> {
  const { nudge, ...signals } = next;
  await signalsItem.setValue(signals);
  if (JSON.stringify(prev.nudge) === JSON.stringify(nudge)) return false;
  await nudgeItem.setValue(nudge);
  return nudge !== null && (prev.nudge?.assignmentId !== nudge.assignmentId || prev.nudge.action !== nudge.action);
}
/** On by default: a nudge only suggests. Off stops all nudges. */
export const nudgesItem = storage.defineItem<{ enabled: boolean }>('local:nudges', { fallback: { enabled: true } });

const extend = (s: Stretch | undefined, at: number): Stretch => (s && at - s.last <= SIGNAL_GAP_MS ? { first: s.first, last: at, count: s.count + 1 } : { first: at, last: at, count: 1 });

/**
 * Records one signal and decides the nudge. Pure. A nudge needs a real stretch
 * of work (not one stray key), an assignment that is not muted, and a session
 * that is not already active on it.
 */
export function nudgeAfter(state: NudgeState, signal: NudgeSignal, session: SessionNow): NudgeState {
  const { assignmentId: id, at } = signal;
  const typing = signal.kind === 'typing' ? { ...state.typing, [id]: extend(state.typing[id], at) } : state.typing;
  const viewing = signal.kind === 'viewing' ? { ...state.viewing, [id]: extend(state.viewing[id], at) } : state.viewing;
  const next = { ...state, typing, viewing };

  if (session?.assignmentId === id && session.state === 'active') return { ...next, nudge: null };
  if ((state.muted[id] ?? 0) > at) return next;

  const t = typing[id];
  const v = viewing[id];
  const typed = Boolean(t && t.count >= TYPING_MIN_PINGS && t.last - t.first >= TYPING_MIN_SPAN_MS);
  const viewed = Boolean(v && v.last - v.first >= VIEWING_MIN_MS);
  if (!typed && !viewed) return next;

  const action = session?.assignmentId === id ? 'resume' : session ? 'switch' : 'start';
  return { ...next, nudge: { assignmentId: id, title: signal.title, action, reason: typed ? 'typing' : 'viewing', at: new Date(at).toISOString() } };
}

/** "Not now": clears the nudge and mutes that assignment for a while. */
export function muted(state: NudgeState, assignmentId: string, now: number): NudgeState {
  return { ...state, nudge: state.nudge?.assignmentId === assignmentId ? null : state.nudge, muted: { ...state.muted, [assignmentId]: now + MUTE_MS } };
}

/** The session now covers this assignment (started, resumed, or switched): no nudge for it. */
export function covered(state: NudgeState, assignmentId: string): NudgeState {
  return {
    ...state,
    nudge: state.nudge?.assignmentId === assignmentId ? null : state.nudge,
    typing: without(state.typing, assignmentId),
    viewing: without(state.viewing, assignmentId),
  };
}

const without = (r: Record<string, Stretch>, id: string) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== id));
