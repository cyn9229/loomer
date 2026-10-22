// Ending a session on purpose, from the end card: the recap it shows, one step
// for next time, and closing with where the assignment stands. Tapping End only
// opens the card; the session keeps running until the student picks.
import { noteTime } from '../core/waits';
import type { Assignment, LoomerDb, NextStep, SessionEvent, TopicCheckRecord, WorkSession } from '../core/db';
import type { AiSettings } from '../core/settings';
import type { SessionRecap } from '../model/session';
import { assignmentNoun } from '../analysis/insight';
import { minutesLong } from '../analysis/plan';
import { isQuiz, storedWorkType } from '../analysis/workType';
import { fetchFocus, focusRequest } from './focus';
import { workHelpDecision } from './help';
import { currentSession, endSession } from './session';
import { loadSheetTopics } from './topics';

const NEXT_STEP_CHARS = 140;

/** Active minutes: the time between start or resume and pause, plus the open stretch up to now. */
export function activeMinutes(events: Pick<SessionEvent, 'kind' | 'at'>[], now: Date): number {
  let ms = 0;
  let from: number | null = null;
  for (const e of [...events].sort((x, y) => x.at.localeCompare(y.at))) {
    const t = Date.parse(e.at);
    if ((e.kind === 'started' || e.kind === 'resumed') && from === null) from = t;
    if ((e.kind === 'paused' || e.kind === 'ended') && from !== null) {
      ms += t - from;
      from = null;
    }
  }
  if (from !== null) ms += now.getTime() - from;
  return Math.max(1, Math.round(ms / 60_000));
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The end card's recap: facts only, one sentence, naming the assignment. */
export function recapFor(
  a: Pick<Assignment, 'title' | 'kind'> & { quiz: boolean },
  session: Pick<WorkSession, 'id' | 'startedAt'>,
  events: SessionEvent[],
  sourcesSaved: number,
  checks: Pick<TopicCheckRecord, 'topic' | 'at'>[],
  now: Date,
  trail: Pick<SessionRecap, 'trail' | 'trailNext'> = { trail: null, trailNext: null },
): SessionRecap {
  const edits = events.filter((e) => e.kind === 'doc-changed');
  const wordsDelta = edits.reduce((sum, e) => sum + (e.wordsDelta ?? 0), 0);
  const topicsChecked = new Set(checks.filter((c) => c.at >= session.startedAt).map((c) => c.topic)).size;
  const minutes = activeMinutes(events, now);
  const noun = assignmentNoun(a);
  const time = minutesLong(minutes);
  const words = wordsDelta > 0 ? `added ${count(wordsDelta, 'word')}` : wordsDelta < 0 ? `cut ${count(-wordsDelta, 'word')}` : null;
  const saved = sourcesSaved > 0 ? `saved ${count(sourcesSaved, 'source')}` : null;
  let text: string;
  if (a.quiz) text = `You spent ${time} on ${noun}.`;
  else if (words && saved) text = `You ${words} and ${saved} in ${time}.`;
  else if (words) text = `You ${words} ${wordsDelta > 0 ? 'to' : 'from'} ${noun} in ${time}.`;
  else if (saved) text = `You ${saved} for ${noun} in ${time}.`;
  else if (topicsChecked > 0) text = `You did quick checks on ${count(topicsChecked, 'topic')} in ${time}.`;
  else if (edits.length > 0) text = `You worked on ${noun} for ${time} and made ${count(edits.length, 'edit')}.`;
  else text = `You spent ${time} on ${noun}, and reading and planning count even when the word count doesn't move.`;
  return { text, noun, minutes, wordsDelta, edits: edits.length, sourcesSaved, topicsChecked, ...trail };
}

export type NextStepDeps = { db: LoomerDb; ai: () => Promise<AiSettings>; fetch?: typeof fetch };

/**
 * Picks one step for next time and stores it on the session. Practice and study
 * work use the topic standings; writing asks the AI (the focus task, with this
 * session's focus as the one before); otherwise the plan's own first step. A
 * quiz gets none. The AI's answer replaces the plan's step only if it arrives.
 */
export async function nextStepStep({ db, ai, fetch: fetchImpl = fetch }: NextStepDeps, now: Date): Promise<boolean> {
  const s = await currentSession(db, now);
  const a = s && (await db.assignments.get(s.assignmentId));
  if (!s || !a || isQuiz(a)) return false;
  if (s.nextStep?.status === 'pending') return true;

  const type = await storedWorkType(db, a);
  const ready = async (step: NextStep) => {
    await db.sessions.update(s.id, { nextStep: { status: 'ready', ...step } });
    return true;
  };
  if (type === 'practice' || type === 'study') {
    const next = (await loadSheetTopics(db, a.id))?.next;
    if (next) return ready({ text: `${next.mode === 'explain' ? 'Review' : 'Check'} ${next.topic}`, aiGenerated: false });
  }

  const analysis = await db.analyses.get(a.id);
  const planStep: NextStep =
    s.focus?.text ? { text: s.focus.text, aiGenerated: true }
    : analysis?.status === 'ok' && analysis.detailHash === a.detail?.hash ? { text: analysis.firstStep, aiGenerated: true }
    : { text: `Open the instructions and list what ${assignmentNoun(a)} asks for`, aiGenerated: false };

  const settings = await ai();
  if (type !== 'writing' || !(await workHelpDecision(db, settings, a.id)).allowed) return ready(planStep);

  await db.sessions.update(s.id, { nextStep: { status: 'pending', at: now.toISOString() } });
  const started = Date.now();
  let step = planStep;
  try {
    const { request } = await focusRequest(db, a, s.focus?.text ? { focus: s.focus.text, handledHints: await db.hints.where('sessionId').equals(s.id).filter((h) => h.state === 'handled').count() } : null);
    const picked = await fetchFocus(settings, request, fetchImpl);
    if (picked) await noteTime(db, 'next-step', Date.now() - started);
    if (picked && (await workHelpDecision(db, await ai(), a.id)).allowed) step = { text: picked.focus.trim().slice(0, NEXT_STEP_CHARS), aiGenerated: true };
  } catch {
    // Keep the plan's step.
  }
  // The student may have closed the session while waiting.
  if ((await db.sessions.get(s.id))?.state === 'ended') return false;
  return ready(step);
}

export type CloseOutcome = 'turned-in' | 'for-today';

/**
 * Ends the session from the end card. "I turned it in" takes the assignment
 * off the plan (it comes back a day after the due date if Canvas never shows
 * it) and drops its Continue line. "Done for today" keeps the step the student
 * kept, which becomes Home's Continue line.
 */
export async function closeSession(db: LoomerDb, outcome: CloseOutcome, nextStep: NextStep | undefined, now: Date): Promise<boolean> {
  const s = await currentSession(db, now);
  if (!s) return false;
  const text = nextStep?.text.trim() ?? '';
  const step = outcome === 'for-today' && text ? { text: (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, NEXT_STEP_CHARS), aiGenerated: nextStep!.aiGenerated } : undefined;
  await endSession(db, now, step);
  if (outcome === 'turned-in') {
    const ctx = await db.studentContext.get(s.assignmentId);
    await db.studentContext.put({ ...ctx, key: s.assignmentId, correction: 'turned-in' });
    await db.resumePackets.update(s.assignmentId, { dismissed: true });
  }
  return true;
}
