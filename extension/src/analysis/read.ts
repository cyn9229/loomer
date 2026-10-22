// Whether Loomer has read an assignment's instructions, for the row and the
// assignment page. Uses the same rules the analysis queue uses, so the state
// shown is the state the worker acts on.
import type { Analysis, Assignment, WaitRecord } from '../core/db';
import { checkAiDispatch, type PolicyAnswer } from '../core/gate';
import { loadWaitTimes, overdue, pendingOf, waitKey, type WaitTimes } from '../core/waits';
import type { LoomerDb } from '../core/db';
import type { ReadState } from '../model/wait';
import { RETRY_FAILED_AFTER_MS } from './analyze';
import { HORIZON_DAYS, type EffectiveDue } from './facts';
import type { PolicyResult } from './policy';

const DAY_MS = 86_400_000;

/** What the read state needs beyond the assignment: AI on or off, the running call (if any), and usual times. */
export type ReadInputs = { aiEnabled: boolean; wait: WaitRecord | undefined; times: WaitTimes };

/** Read inputs for one assignment, for screens that build a single WorkItem. Dexie reads only. */
export async function loadReadInputs(db: LoomerDb, aiEnabled: boolean, assignmentId: string): Promise<ReadInputs> {
  const [wait, times] = await Promise.all([db.waits.get(waitKey('analysis', assignmentId)), loadWaitTimes(db)]);
  return { aiEnabled, wait, times };
}

/** Null for hand-added work: Loomer has nothing of the teacher's to read. */
export function readStateOf(
  a: Assignment,
  stored: Analysis | undefined,
  policy: PolicyResult,
  answer: PolicyAnswer | undefined,
  due: EffectiveDue,
  { aiEnabled, wait, times }: ReadInputs,
  now: Date,
): ReadState | null {
  if (a.addedBy) return null;
  const base = { at: null, retryAt: null, reason: null, found: null, pending: null } satisfies Omit<ReadState, 'state'>;
  if (!a.detail) return { ...base, state: 'empty', reason: a.detailError ? 'page-closed' : 'no-instructions' };
  if (!a.detail.text.trim() && a.detail.rubric.length === 0) return { ...base, state: 'empty', reason: 'no-instructions' };
  const decision = checkAiDispatch({ aiEnabled, policy, answer, purpose: 'requirements-analysis' });
  if (!decision.allowed) return { ...base, state: 'blocked', reason: decision.reason === 'ai-off' ? 'ai-off' : decision.reason === 'policy-blocked' ? 'rule-no-ai' : 'rule-unclear' };

  const current = stored?.detailHash === a.detail.hash ? stored : undefined;
  const changed = stored?.status === 'ok' && !current;
  if (wait && !wait.failed) {
    if (overdue('analysis', times, wait.startedAt, now)) return { ...base, state: 'failed', at: null };
    const pending = pendingOf('analysis', times, { title: changed ? 'Reading the new instructions' : 'Reading the instructions', about: a.title, startedAt: wait.startedAt });
    return { ...base, state: changed ? 'changed' : 'reading', pending };
  }
  if (current?.status === 'ok') return { ...base, state: 'read', at: current.createdAt, found: foundIn(current) };
  if (changed) return { ...base, state: 'changed' };
  if (current?.status === 'failed') {
    const retryAt = Date.parse(current.createdAt) + RETRY_FAILED_AFTER_MS;
    if (retryAt > now.getTime()) return { ...base, state: 'failed', at: current.createdAt, retryAt: new Date(retryAt).toISOString() };
  }
  // The queue reads only work due within the horizon; say why the rest waits.
  if (!due.at) return { ...base, state: 'waiting', reason: 'no-date' };
  const t = Date.parse(due.at);
  if (t < now.getTime()) return { ...base, state: 'waiting', reason: 'past-due' };
  if (t > now.getTime() + HORIZON_DAYS * DAY_MS) return { ...base, state: 'waiting', reason: 'later' };
  return { ...base, state: 'waiting' };
}

/** "Found 2 things to hand in and 1 checkpoint". Null when the reading found none of these. */
function foundIn(a: Extract<Analysis, { status: 'ok' }>): string | null {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    a.deliverables.length > 0 ? count(a.deliverables.length, 'thing to hand in', 'things to hand in') : null,
    a.milestones.length > 0 ? count(a.milestones.length, 'checkpoint', 'checkpoints') : null,
    a.pace ? `a step a day for ${a.pace.days} days` : null,
  ].filter((p) => p !== null);
  if (parts.length === 0) return null;
  return `Found ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}`;
}
