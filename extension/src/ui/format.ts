// Display formatting for dates and model states. Pure functions; `now` is passed
// in so fixtures and tests are deterministic. Dates render in the viewer's zone.
import type { EffortLabel, EvidenceKind, PolicyState, RequirementsState, WorkItem } from '../model/home';
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

/** Short due line for rows: "Mon 8:00 AM" this week, "Oct 29" later, "Was due Oct 9" when passed. */
export function dueWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (at.getTime() < now.getTime()) return `Was due ${day}`;
  const days = calendarDaysUntil(at, now);
  if (days === 0) return `Today ${time}`;
  if (days < 7) return `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return day;
}

/** "7:59 PM" */
export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Oct 29" */
export function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Agenda day heading: "Today", "Tomorrow", or "Mon 19". `soon` marks today and
 * tomorrow, which the agenda shows in the accent color.
 */
export function dayHeading(iso: string, now: Date): { label: string; soon: boolean } {
  const at = new Date(iso);
  const days = calendarDaysUntil(at, now);
  const short = `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${at.getDate()}`;
  if (days === 0) return { label: 'Today', soon: true };
  if (days === 1) return { label: 'Tomorrow', soon: true };
  return { label: short, soon: false };
}

/** The red badge, only for work due today or tomorrow. */
export function dueBadge(iso: string, now: Date): string | null {
  const at = new Date(iso);
  if (at.getTime() < now.getTime()) return null;
  const days = calendarDaysUntil(at, now);
  return days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : null;
}

/** The workload tile's word. Matches the planner's reasons ("heavy workload"). */
export const workloadWord: Record<EffortLabel, string> = {
  Short: 'Light',
  Moderate: 'Medium',
  Substantial: 'Heavy',
  Unknown: 'Not sure',
};

/** A number of minutes the student gave, as "45 min", "3 h" or "1 h 30 min". Never Loomer's own estimate. */
export function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Local calendar date as YYYY-MM-DD, the key DayRoom uses. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Thu" */
export function weekday(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
}

export function dueSourceLabel(item: WorkItem): string | null {
  if (!item.due) return null;
  return item.due.source === 'instructions' ? 'from instructions' : null;
}

export const requirementsLabel: Record<RequirementsState, string> = {
  checked: 'Read',
  checking: 'Reading…',
  unreadable: "Couldn't read it",
  'not-checked': 'Not read yet',
};

/** Short notice for a policy that limits AI help, or null when nothing needs saying. */
export const policyNotice: Record<PolicyState, { title: string; tone: 'amber' | 'accent' } | null> = {
  blocked: { title: 'No AI on this one', tone: 'amber' },
  limited: { title: 'Only some AI help on this one', tone: 'amber' },
  unresolved: { title: 'AI help is on hold until the rule is clear', tone: 'accent' },
  'none-found': null,
  permitted: null,
};

export const evidenceKindLabel: Record<EvidenceKind, string> = {
  'school-fact': 'From your school',
  'ai-interpretation': 'How Loomer read it',
  'student-context': 'From you',
  limitation: 'Couldn’t check',
};

/** What went wrong with the last Canvas check, or null when it was fine. */
export function checkProblem(outcome: RunOutcome): string | null {
  switch (outcome) {
    case 'ok':
      return null;
    case 'partial':
      return 'Some classes didn’t load.';
    case 'auth-expired':
      return 'Canvas signed you out. Sign in, then refresh.';
    case 'paused':
      return 'Loomer is paused, so it isn’t reading anything.';
    case 'no-permission':
      return 'Chrome took away access to Canvas. Reconnect in settings.';
    case 'not-connected':
      return 'Canvas isn’t connected.';
    case 'failed':
      return 'The sync didn’t work. Showing what we had before.';
  }
}
