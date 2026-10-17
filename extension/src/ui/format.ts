// Display formatting for dates and model states. Pure functions; `now` is passed
// in so fixtures and tests are deterministic. Dates render in the viewer's zone.
import type { EvidenceKind, PolicyState, RequirementsState, WorkItem } from '../model/home';
import type { RunOutcome } from '../core/db';

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `now` to `at`, in local time. Negative when past. */
export function calendarDaysUntil(at: Date, now: Date): number {
  return Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
}

/** "Thu, Oct 22, 11:59 PM" */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Thu, Oct 22" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "4:12 PM" today, "Sat 4:12 PM" this week, otherwise "Oct 12". */
export function observedAt(iso: string, now: Date): string {
  const at = new Date(iso);
  const days = calendarDaysUntil(at, now);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return time;
  if (days > -7 && days < 0) return `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Relative deadline label from the date alone. A passed deadline is not a claim
 * that work is missing, so it says "Deadline passed", never "Missing" or "Late".
 */
export function deadlineLabel(iso: string, now: Date): { text: string; soon: boolean } {
  const at = new Date(iso);
  if (at.getTime() < now.getTime()) return { text: 'Deadline passed', soon: true };
  const days = calendarDaysUntil(at, now);
  if (days === 0) return { text: 'Due today', soon: true };
  if (days === 1) return { text: 'Tomorrow', soon: true };
  return { text: `${days} days left`, soon: days <= 2 };
}

export function dueSourceLabel(item: WorkItem): string | null {
  if (!item.due) return null;
  return item.due.source === 'instructions' ? 'from instructions' : null;
}

export const requirementsLabel: Record<RequirementsState, string> = {
  checked: 'Read',
  checking: 'Reading',
  unreadable: "Can't read",
  'not-checked': 'Not checked',
};

/** Short notice for a policy that limits AI help, or null when nothing needs saying. */
export const policyNotice: Record<PolicyState, { title: string; tone: 'amber' | 'accent' } | null> = {
  blocked: { title: 'AI help is off for this assignment.', tone: 'amber' },
  limited: { title: 'AI help is limited for this assignment.', tone: 'amber' },
  unresolved: { title: 'AI help is paused until the AI policy is clear.', tone: 'accent' },
  'none-found': null,
  permitted: null,
};

export const evidenceKindLabel: Record<EvidenceKind, string> = {
  'school-fact': 'From your school',
  'ai-interpretation': "Loomer's reading",
  'student-context': 'From you',
  limitation: 'Not checked',
};

/** What went wrong with the last Canvas check, or null when it was fine. */
export function checkProblem(outcome: RunOutcome): string | null {
  switch (outcome) {
    case 'ok':
      return null;
    case 'partial':
      return 'Some courses could not be read.';
    case 'auth-expired':
      return 'Canvas sign-in expired. Sign in to Canvas, then refresh.';
    case 'paused':
      return 'Paused. Loomer is not reading anything.';
    case 'no-permission':
      return 'Chrome access to Canvas was removed. Reconnect in settings.';
    case 'not-connected':
      return 'Canvas is not connected.';
    case 'failed':
      return 'The check failed. Showing what Loomer had before.';
  }
}
