// Work-session lifecycle. One session at a time. Only an active session reads
// the linked Doc or accepts captured pages; pause and end stop both at once.
import { readDocPaced, studentText, wordCount } from '../adapters/docs/reader';
import { instructionText, type LoomerDb, type SessionEvent, type WorkSession } from '../core/db';
import type { GateState } from '../core/gate';
import { localDay } from '../analysis/plan';
import { writeResumePacket } from './resume';

/** No edit, capture, or panel action for this long suspends the session. */
export const IDLE_SUSPEND_MS = 15 * 60 * 1000;
/** A session paused this long, or since before today, is over: it ended when it was paused. */
export const PAUSE_CLOSES_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a paused session is over. Coming back after a long break, or the next
 * day, starts a fresh session instead of reopening one that started hours ago.
 */
export function pausedTooLong(s: WorkSession, now: Date): boolean {
  if (s.state !== 'paused') return false;
  const pausedAt = new Date(s.lastActivityAt);
  return now.getTime() - pausedAt.getTime() > PAUSE_CLOSES_MS || localDay(pausedAt) !== localDay(now);
}
/** With the typing signal, read once typing has paused this long. */
const TYPING_SETTLE_MS = 3_000;
/** With the typing signal, still read this often in case a keystroke was missed. */
const SIGNAL_FALLBACK_MS = 60_000;

/** The open session, if any. A session paused too long counts as over, even before closeStaleSessions records it. */
export async function currentSession(db: LoomerDb, now = new Date()): Promise<WorkSession | undefined> {
  return (await db.sessions.where('state').anyOf('active', 'paused').toArray()).filter((s) => !pausedTooLong(s, now)).at(-1);
}

/**
 * Records sessions paused too long as ended at the moment they were paused.
 * Their resume packet was already written at the pause, so nothing is lost.
 */
export async function closeStaleSessions(db: LoomerDb, now: Date) {
  const stale = (await db.sessions.where('state').equals('paused').toArray()).filter((s) => pausedTooLong(s, now));
  for (const s of stale) {
    await db.sessions.update(s.id, { state: 'ended', endedAt: s.lastActivityAt });
    await log(db, s, s.lastActivityAt, 'ended');
  }
}

async function log(db: LoomerDb, s: WorkSession, at: string, kind: SessionEvent['kind'], extra: Partial<SessionEvent> = {}) {
  await db.sessionEvents.add({ sessionId: s.id, assignmentId: s.assignmentId, at, kind, ...extra });
}

/** Starts a session for the assignment, ending any other one. `minutes` is the time the student said they have. Returns it. */
export async function startSession(db: LoomerDb, assignmentId: string, now: Date, minutes?: number): Promise<WorkSession> {
  await closeStaleSessions(db, now);
  const at = now.toISOString();
  const plannedUntil = minutes ? new Date(now.getTime() + minutes * 60_000).toISOString() : undefined;
  const assignment = await db.assignments.get(assignmentId);
  if (!assignment) throw new Error("Loomer couldn't find that assignment.");
  const existing = await currentSession(db, now);
  if (existing?.assignmentId === assignmentId) {
    if (existing.state === 'paused') await setState(db, existing, 'active', now);
    if (plannedUntil) await db.sessions.update(existing.id, { plannedUntil });
    return (await db.sessions.get(existing.id))!;
  }
  if (existing) await endSession(db, now);
  const id = await db.sessions.add({
    sourceKey: assignment.sourceKey,
    assignmentId,
    state: 'active',
    startedAt: at,
    endedAt: null,
    lastActivityAt: at,
    plannedUntil,
  });
  const session = (await db.sessions.get(id))!;
  await log(db, session, at, 'started');
  return session;
}

export async function setState(db: LoomerDb, s: WorkSession, state: 'active' | 'paused', now: Date) {
  if (s.state === state) return;
  const at = now.toISOString();
  await db.sessions.update(s.id, { state, lastActivityAt: at });
  await log(db, s, at, state === 'active' ? 'resumed' : 'paused');
  if (state === 'paused') await writeResumePacket(db, s, now);
}

export async function endSession(db: LoomerDb, now: Date) {
  const s = await currentSession(db, now);
  if (!s) return;
  const at = now.toISOString();
  await db.sessions.update(s.id, { state: 'ended', endedAt: at });
  await log(db, s, at, 'ended');
  await writeResumePacket(db, s, now);
}

/** Sets or clears the time the student has. Clearing is "Keep going"; nothing ends the session by itself. */
export async function setPlannedTime(db: LoomerDb, minutes: number | null, now: Date): Promise<boolean> {
  const s = await currentSession(db, now);
  if (!s) return false;
  await db.sessions.update(s.id, { plannedUntil: minutes ? new Date(now.getTime() + minutes * 60_000).toISOString() : undefined });
  return true;
}

export async function touch(db: LoomerDb, s: WorkSession, now: Date) {
  await db.sessions.update(s.id, { lastActivityAt: now.toISOString() });
}

/**
 * One session step: suspend after idle time, otherwise read the linked Doc if
 * pacing allows and record a factual edit event when the student's text changed.
 * Returns true while the session still needs ticking.
 */
export async function tickSession(
  db: LoomerDb,
  gate: GateState,
  now: Date,
  typingAt: (docId: string) => Promise<number | null> = async () => null,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const s = await currentSession(db, now);
  if (!s || s.state !== 'active') return false;
  const link = await db.docLinks.get(s.assignmentId);
  const typed = link ? await typingAt(link.docId) : null;
  // Typing counts as activity even before a read confirms the change.
  const lastActive = Math.max(Date.parse(s.lastActivityAt), typed ?? 0);
  if (now.getTime() - lastActive > IDLE_SUSPEND_MS) {
    await setState(db, s, 'paused', now);
    return false;
  }
  if (!link) return true;

  // With a typing signal, read after a burst of typing settles instead of on a timer.
  const prior = await db.docReads.get(link.docId);
  if (typed !== null && prior?.lastAttemptAt) {
    const lastAttempt = Date.parse(prior.lastAttemptAt);
    const settledAfterTyping = typed > lastAttempt && now.getTime() - typed >= TYPING_SETTLE_MS;
    if (!settledAfterTyping && now.getTime() - lastAttempt < SIGNAL_FALLBACK_MS) return true;
  }

  const result = await readDocPaced(db, gate, link.docId, now, fetchImpl);
  if (!result?.changed || !result.read.current || !result.read.previous) return true;

  const instructions = instructionText((await db.assignments.get(s.assignmentId))?.detail);
  const words = (t: string) => wordCount(studentText(t, instructions));
  const wordsDelta = words(result.read.current.text) - words(result.read.previous.text);
  await log(db, s, now.toISOString(), 'doc-changed', { wordsDelta });
  await touch(db, s, now);
  return true;
}
