// Waits on the AI: each call site marks its call while it runs, records how
// long it took, and keeps a failure where the student can see it. Models turn
// these records (or their own pending records) into a Pending with the usual
// time for that kind of call. A wait past three times its usual high is over:
// models show it as failed, so a stopped worker never leaves a wait forever.
import type { LoomerDb, WaitRecord, WaitTimeRecord } from './db';
import type { Failed, Pending, WaitStep, WaitTask } from '../model/wait';

/** Starting times, in seconds, until there are enough live timings. Measured on the dev account where noted. */
const DEFAULT_USUAL: Record<WaitTask, [number, number]> = {
  analysis: [14, 90], // measured
  check: [10, 40],
  focus: [10, 30], // measured
  hint: [10, 30], // measured
  'next-step': [3, 10],
  topics: [5, 5], // measured
  'prep-setup': [10, 40],
  'prep-notes': [10, 40],
  questions: [9, 9], // measured
  like: [5, 10],
  teach: [5, 10], // measured
  grade: [2, 2], // measured
  review: [10, 40],
  reply: [2, 6],
  tool: [1, 3],
  visual: [8, 25],
  quiz: [6, 15],
};
const SAMPLES = 10;
const MIN_SAMPLES = 3;
/** A wait this many times past its usual high is treated as failed. */
const OVERDUE_FACTOR = 3;

export type WaitTimes = Map<WaitTask, number[]>;

export async function loadWaitTimes(db: LoomerDb): Promise<WaitTimes> {
  return new Map((await db.waitTimes.toArray()).map((r) => [r.task, r.samples]));
}

/** Usual time for a kind of call: the low and high of recent timings, or the starting guess. */
export function usualSec(times: WaitTimes, task: WaitTask): [number, number] {
  const samples = times.get(task) ?? [];
  if (samples.length < MIN_SAMPLES) return DEFAULT_USUAL[task];
  return [Math.max(1, Math.round(Math.min(...samples))), Math.max(1, Math.round(Math.max(...samples)))];
}

/** Records one finished call's time. Keeps the last few. */
export async function noteTime(db: LoomerDb, task: WaitTask, ms: number) {
  await db.transaction('rw', db.waitTimes, async () => {
    const prev = (await db.waitTimes.get(task))?.samples ?? [];
    const record: WaitTimeRecord = { task, samples: [...prev, Math.round(ms / 100) / 10].slice(-SAMPLES) };
    await db.waitTimes.put(record);
  });
}

export type PendingParts = { title: string; about?: string | null; startedAt: string; steps?: WaitStep[] | null; canCancel?: boolean };

export function pendingOf(task: WaitTask, times: WaitTimes, parts: PendingParts): Pending {
  return { title: parts.title, about: parts.about ?? null, startedAt: parts.startedAt, usualSec: usualSec(times, task), steps: parts.steps ?? null, canCancel: parts.canCancel ?? false };
}

/** Past three times the usual high: the worker stopped or the call hung. */
export function overdue(task: WaitTask, times: WaitTimes, startedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(startedAt) > OVERDUE_FACTOR * usualSec(times, task)[1] * 1000;
}

export const waitKey = (task: WaitTask, id: string | number) => `${task}:${id}`;

/** How one waited call ended. A failure's sentence stays on the record for the panel. */
export type WaitOutcome<T> = { ok: true; value: T } | { ok: false; failed: Failed };

/**
 * Runs one AI call as a wait. Ended well: the record goes, and the time counts
 * toward the usual time. Ended badly: the record keeps the failure until the
 * next try. A throw counts as `fallback`.
 */
export async function runWait<T>(db: LoomerDb, task: WaitTask, id: string | number, fallback: Failed, run: () => Promise<WaitOutcome<T>>): Promise<WaitOutcome<T>> {
  const started = await startWait(db, task, id);
  let result: WaitOutcome<T>;
  try {
    result = await run();
  } catch {
    result = { ok: false, failed: fallback };
  }
  await endWait(db, task, id, started, result.ok ? null : result.failed);
  return result;
}

/** Marks a call as running, with its words if the call site knows them. Returns its start, for endWait. */
export async function startWait(db: LoomerDb, task: WaitTask, id: string | number, words: { title?: string; about?: string | null } = {}): Promise<number> {
  const started = Date.now();
  await db.waits.put({ key: waitKey(task, id), task, startedAt: new Date(started).toISOString(), failed: null, ...words });
  return started;
}

/**
 * A call whose own record keeps any failure (prep, practice): shown while it
 * runs, timed when `ok`, and gone either way.
 */
export async function quietWait<T>(db: LoomerDb, task: WaitTask, id: string | number, words: { title?: string; about?: string | null }, run: () => Promise<T>, ok: (r: T) => boolean): Promise<T> {
  const started = await startWait(db, task, id, words);
  try {
    const r = await run();
    if (ok(r)) await endWait(db, task, id, started, null);
    else await db.waits.delete(waitKey(task, id));
    return r;
  } catch (error) {
    await db.waits.delete(waitKey(task, id));
    throw error;
  }
}

/** A running wait from its record's own words, or null when it is gone, failed, or past its time. */
export function runningWait(w: WaitRecord | undefined, times: WaitTimes, fallback: { title: string; about?: string | null; steps?: WaitStep[] | null; canCancel?: boolean }, now: Date): Pending | null {
  if (!w || w.failed || overdue(w.task, times, w.startedAt, now)) return null;
  return pendingOf(w.task, times, { ...fallback, title: w.title ?? fallback.title, about: w.about ?? fallback.about ?? null, startedAt: w.startedAt });
}

/** Ends a call: gone and timed when it went well, kept with its failure when not. */
export async function endWait(db: LoomerDb, task: WaitTask, id: string | number, started: number, failed: Failed | null) {
  const key = waitKey(task, id);
  if (failed) {
    await db.waits.update(key, { failed: { at: new Date().toISOString(), ...failed } });
  } else {
    await db.waits.delete(key);
    await noteTime(db, task, Date.now() - started);
  }
}

/** A stored wait as the panel sees it: running (Pending), failed, or nothing. Overdue counts as failed with `overdueText`. */
export function waitView(
  w: WaitRecord | undefined,
  times: WaitTimes,
  parts: Omit<PendingParts, 'startedAt'>,
  overdueText: string,
  now: Date,
): { pending: Pending | null; failed: Failed | null } {
  if (!w) return { pending: null, failed: null };
  if (w.failed) return { pending: null, failed: { text: w.failed.text, retry: w.failed.retry } };
  if (overdue(w.task, times, w.startedAt, now)) return { pending: null, failed: { text: overdueText, retry: true } };
  return { pending: pendingOf(w.task, times, { ...parts, startedAt: w.startedAt }), failed: null };
}
