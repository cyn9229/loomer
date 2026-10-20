// Per-assignment facts derived locally from stored evidence. Shared by the
// analysis runner and the recommendation so both judge an assignment the same way.
import { instructionText, doneInCanvas, type Assignment, type Course, type StudentContext } from '../core/db';
import type { PolicyAnswer } from '../core/gate';
import { findInstructionDeadlines, localDate, type InstructionDeadline } from './deadlines';
import { resolvePolicy, type PolicyResult } from './policy';

export const HORIZON_DAYS = 14;
const DAY_MS = 86_400_000;

export type EffectiveDue = {
  /** ISO timestamp from Canvas, or end of the local day named in the instructions. */
  at: string | null;
  source: 'canvas' | 'instructions' | null;
  /** Instructions name a date later than Canvas, or several dates with no Canvas date. */
  conflict: boolean;
  instructionDates: InstructionDeadline[];
};

/**
 * Canvas date wins when present. Instruction dates earlier than it may be
 * milestones; a later one is a conflict. Without a Canvas date, exactly one
 * instruction date is used; several are a conflict.
 */
export function effectiveDue(a: Assignment, now: Date): EffectiveDue {
  const instructionDates = a.detail ? findInstructionDeadlines(a.detail.text, now) : [];
  if (a.dueAt) {
    const canvasDay = localDate(a.dueAt);
    return { at: a.dueAt, source: 'canvas', conflict: instructionDates.some((d) => d.date > canvasDay), instructionDates };
  }
  if (instructionDates.length === 1) {
    const [y, m, d] = instructionDates[0]!.date.split('-').map(Number);
    return { at: new Date(y!, m! - 1, d!, 23, 59).toISOString(), source: 'instructions', conflict: false, instructionDates };
  }
  return { at: null, source: null, conflict: instructionDates.length > 1, instructionDates };
}

/** Open means still possibly to do: seen in the last check, not submitted, not excused. */
export function isOpen(a: Assignment): boolean {
  return a.presence === 'seen-in-last-check' && !doneInCanvas(a.submission);
}

/** Open work due between now and the horizon. Past-due and undated work is listed, not ranked. */
export function inDecisionSet(a: Assignment, due: EffectiveDue, now: Date): boolean {
  if (!isOpen(a) || !due.at) return false;
  const t = Date.parse(due.at);
  return t >= now.getTime() && t <= now.getTime() + HORIZON_DAYS * DAY_MS;
}

/** The student took it off the plan: did it on paper, or turned it in. */
export const offPlan = (correction: StudentContext['correction'] | null) => correction === 'done-offline' || correction === 'turned-in';

export function courseKey(a: Assignment): string {
  return `${a.sourceKey}#course:${a.courseId}`;
}

/** Policy from the course syllabus plus the assignment's own text and rubric. */
export function assignmentPolicy(a: Assignment, course: Course | undefined): PolicyResult {
  const assignmentText = a.detail ? [instructionText(a.detail), ...a.detail.rubric.map((r) => r.description)].join('\n') : null;
  return resolvePolicy([
    { label: 'Course syllabus', text: course?.syllabus?.text ?? null },
    { label: 'Canvas assignment', text: assignmentText },
  ]);
}

/** An assignment-level answer overrides a course-level one. */
export function policyAnswer(a: Assignment, context: Map<string, StudentContext>): PolicyAnswer | undefined {
  return (context.get(a.id) ?? context.get(courseKey(a)))?.policyAnswer?.value;
}
