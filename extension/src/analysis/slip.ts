// A start Loomer suggested that didn't happen. The worker records each day Home
// suggested starting an assignment today; a suggested day with no session on
// it, after the student last worked on it, is a missed start. Loomer names it
// once, asks "What got in the way?" once, and makes the next start smaller.
// Pure, except the two small writes at the end.
import type { LoomerDb, SlipReason, StudentContext } from '../core/db';
import type { Insight, NextAction } from '../model/home';
import { dayWords, localDay, lowerFirst } from './plan';

/** Suggested days kept per assignment. */
const KEEP_DAYS = 14;
export const QUICK_START_MINUTES = 10;

/**
 * The current missed start for one assignment, or null. `worked`: local days
 * with a session on it. An answer shows its after-state only on the day it was
 * given; after that the slip is settled until another suggested day is missed.
 */
export function slipOf(assignmentId: string, ctx: StudentContext | undefined, worked: string[], today: string): NextAction['slip'] {
  const lastWork = worked.reduce((max, d) => (d > max ? d : max), '');
  const missed = (ctx?.suggestedStarts ?? []).filter((d) => d < today && d > lastWork && !worked.includes(d));
  const missedOn = missed.at(-1);
  if (!missedOn) return null;
  const answer = ctx?.slipAnswer?.missedOn === missedOn ? ctx.slipAnswer : undefined;
  if (answer && (answer.reason === 'dismissed' || localDay(new Date(answer.at)) !== today)) return null;
  return { assignmentId, missedOn, count: missed.length, answer: answer ? (answer.reason as SlipReason) : null };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "yesterday" or "on Monday", for the day a start was missed. */
function missedWords(missedOn: string, now: Date): string {
  if (missedOn === localDay(new Date(now.getTime() - 86_400_000))) return 'yesterday';
  const [y, m, d] = missedOn.split('-').map(Number);
  return `on ${new Date(y!, m! - 1, d!, 12).toLocaleDateString(undefined, { weekday: 'long' })}`;
}

/** Home's line for a missed start: named once, then what Loomer did after the student's answer. */
export function slipInsight(slip: NonNullable<NextAction['slip']>, noun: string, due: string | null, plainWords: string | null, now: Date): Insight {
  const dueText = due ? dayWords(due, now) : null;
  const text = (() => {
    switch (slip.answer) {
      case 'too-big':
        return `You said ${noun} felt too big, so Loomer cut today's step down to ${QUICK_START_MINUTES} minutes.`;
      case 'not-feeling-it':
        return `Ten minutes on ${noun} is enough for today, and you can pick a day instead if that works better.`;
      case 'not-sure':
        return plainWords ? `Here's what ${noun} asks for in plain words, so you can talk it through before you start.` : `Talking ${noun} through with Loomer is a good way to find where to start.`;
      case 'no-time':
        return dueText ? `You said today has no time, so pick a day for ${noun} before it's due ${dueText}.` : `You said today has no time, so pick a day for ${noun}.`;
      case null:
        if (slip.count === 1) {
          const when = missedWords(slip.missedOn, now);
          return dueText ? `You didn't get to ${noun} ${when}, and it's due ${dueText}, so today's start matters more.` : `You didn't get to ${noun} ${when}, so today is a good day to start it.`;
        }
        // Missed more than once: smaller and more concrete, never louder.
        if (dueText === 'today') return `${cap(noun)} is due today, so ${QUICK_START_MINUTES} minutes now is the place to start.`;
        if (dueText === 'tomorrow') return `${cap(noun)} is due tomorrow, so a ${QUICK_START_MINUTES}-minute start today keeps it from all landing on one night.`;
        return dueText ? `${cap(noun)} is due ${dueText}, and a ${QUICK_START_MINUTES}-minute start today is enough to get it moving.` : `A ${QUICK_START_MINUTES}-minute start on ${noun} today is enough to get it moving.`;
    }
  })();
  return { kind: 'slipped', text, aiFound: false };
}

/** Whether the next start should be a short session: the student said it felt too big or didn't feel like it, or it was missed more than once. */
export const wantsQuickStart = (slip: NonNullable<NextAction['slip']>) => slip.answer === 'too-big' || slip.answer === 'not-feeling-it' || (slip.answer === null && slip.count > 1);

/** "Just 10 minutes: outline the comparison between your two sources". */
export const smallerStep = (action: string) => `Just ${QUICK_START_MINUTES} minutes: ${lowerFirst(action)}`;

/** Records that Home suggested starting this assignment today. The worker calls it after each plan update. */
export async function recordSuggestedStart(db: LoomerDb, assignmentId: string, today: string) {
  const ctx = await db.studentContext.get(assignmentId);
  if (ctx?.suggestedStarts?.at(-1) === today) return;
  await db.studentContext.put({ ...ctx, key: assignmentId, suggestedStarts: [...(ctx?.suggestedStarts ?? []), today].slice(-KEEP_DAYS) });
}

/** The student's answer to "What got in the way?", or dismissed. */
export async function answerSlip(db: LoomerDb, assignmentId: string, missedOn: string, reason: SlipReason | 'dismissed', now: Date) {
  const ctx = await db.studentContext.get(assignmentId);
  await db.studentContext.put({ ...ctx, key: assignmentId, slipAnswer: { missedOn, reason, at: now.toISOString() } });
}
