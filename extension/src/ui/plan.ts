// Groups Home's items into the plan views. Pure; `now` is passed in. The
// planner gives every dated item a start-by date; these helpers only sort that
// into days. A day can hold several starts. A start date that has passed counts
// as today, because the work still needs a start.
import type { Checkpoint, WorkItem } from '../model/home';
import type { PlanPreview } from '../model/plan';
import { calendarDaysUntil } from './format';

/** Days shown in the plan: today and the next six. */
export const PLAN_DAYS = 7;

/** Calendar days from today until the item should start (0 for today or overdue), or null when it has no start date. */
export function startOffset(item: WorkItem, now: Date): number | null {
  return item.startBy ? Math.max(0, calendarDaysUntil(new Date(item.startBy.at), now)) : null;
}

/** Items that belong in the plan: visible, still open, and with a start date. Past due and undated work live in folds. */
export function planItems(items: WorkItem[]): WorkItem[] {
  return items.filter((i) => !i.hidden && i.bucket !== 'past' && i.bucket !== 'no-date' && i.startBy);
}

const byDue = (a: WorkItem, b: WorkItem) => (a.due ? Date.parse(a.due.at) : Infinity) - (b.due ? Date.parse(b.due.at) : Infinity);

/**
 * List view: plan items grouped by start day for the next week, earlier due
 * first inside a day. Items that start after that go to `later`.
 */
export function planByStart(items: WorkItem[], now: Date): { days: { offset: number; items: WorkItem[] }[]; later: WorkItem[] } {
  const days = new Map<number, WorkItem[]>();
  const later: WorkItem[] = [];
  for (const item of planItems(items)) {
    const offset = startOffset(item, now)!;
    if (offset >= PLAN_DAYS) later.push(item);
    else days.set(offset, [...(days.get(offset) ?? []), item]);
  }
  return {
    days: [...days.entries()].sort(([a], [b]) => a - b).map(([offset, dayItems]) => ({ offset, items: dayItems.sort(byDue) })),
    later: later.sort(byDue),
  };
}

export type WeekEvent =
  | { kind: 'start'; item: WorkItem }
  | { kind: 'checkpoint'; item: WorkItem; checkpoint: Checkpoint }
  | { kind: 'due'; item: WorkItem; at: string };

/** Week view: each of the next seven days with what starts, which checkpoints land, and what is due, in that order. */
export function weekDays(items: WorkItem[], now: Date): { date: Date; offset: number; events: WeekEvent[] }[] {
  const open = planItems(items);
  return Array.from({ length: PLAN_DAYS }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const on = (iso: string) => calendarDaysUntil(new Date(iso), now) === offset;
    const events: WeekEvent[] = [
      ...open.filter((i) => startOffset(i, now) === offset).map((item) => ({ kind: 'start' as const, item })),
      ...open.flatMap((item) => item.checkpoints.filter((c) => on(c.at)).map((checkpoint) => ({ kind: 'checkpoint' as const, item, checkpoint }))),
      ...open
        .filter((i) => i.due && on(i.due.at))
        .sort(byDue)
        .map((item) => ({ kind: 'due' as const, item, at: item.due!.at })),
    ];
    return { date, offset, events };
  });
}

/**
 * The seven days a plan-change card draws: from today, or from the first
 * changed day when that is a week or more away.
 */
export function stripDays(preview: PlanPreview, now: Date): Date[] {
  const changed = [...preview.days.map((d) => localDate(d.date)), ...preview.moves.flatMap((m) => [m.from, m.to].filter((x): x is string => x !== null).map((iso) => new Date(iso)))];
  const first = Math.min(...changed.map((d) => calendarDaysUntil(d, now)).filter((n) => n >= 0));
  const offset = Number.isFinite(first) && first >= PLAN_DAYS ? first : 0;
  return Array.from({ length: PLAN_DAYS }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + i));
}

/**
 * Starts on one strip day once the change applies: starts that stay, starts
 * moved in, and starts moved away (drawn hollow where they were). Moved items
 * are counted only through the moves, so this works before and after Apply.
 */
export function stripStarts(items: WorkItem[], moves: PlanPreview['moves'], day: Date, now: Date): { kept: number; movedIn: number; movedOut: number } {
  const moved = new Set(moves.map((m) => m.assignmentId));
  const offset = calendarDaysUntil(day, now);
  const onDay = (iso: string | null) => iso !== null && Math.max(0, calendarDaysUntil(new Date(iso), now)) === offset;
  return {
    kept: planItems(items).filter((i) => !moved.has(i.assignmentId) && startOffset(i, now) === offset).length,
    movedIn: moves.filter((m) => onDay(m.to)).length,
    movedOut: moves.filter((m) => onDay(m.from)).length,
  };
}

/** A YYYY-MM-DD key as a local date. */
export function localDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}
