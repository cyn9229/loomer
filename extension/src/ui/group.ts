// Grouping for "Other work": by class, then by bucket. Pure so it can be tested.
// Classes with the soonest dated work come first; a class with only undated or
// past items still appears, so a missing date never hides work.
import type { WorkItem } from '../model/home';

export type ClassGroup = {
  courseKey: string;
  label: string;
  soon: WorkItem[];
  later: WorkItem[];
  noDate: WorkItem[];
  past: WorkItem[];
  /** Visible items in the class, all buckets. */
  count: number;
};

/** Visible (not hidden) items grouped by class, each class ordered by due date. */
export function groupByClass(items: readonly WorkItem[]): ClassGroup[] {
  const groups = new Map<string, ClassGroup>();
  for (const item of items) {
    if (item.hidden) continue;
    let g = groups.get(item.courseKey);
    if (!g) {
      g = { courseKey: item.courseKey, label: item.courseName ?? 'No class', soon: [], later: [], noDate: [], past: [], count: 0 };
      groups.set(item.courseKey, g);
    }
    const target = item.bucket === 'soon' ? g.soon : item.bucket === 'later' ? g.later : item.bucket === 'no-date' ? g.noDate : g.past;
    target.push(item);
    g.count += 1;
  }
  const byDue = (a: WorkItem, b: WorkItem) => dueTime(a) - dueTime(b);
  for (const g of groups.values()) {
    g.soon.sort(byDue);
    g.later.sort(byDue);
    g.past.sort((a, b) => dueTime(b) - dueTime(a));
  }
  return [...groups.values()].sort((a, b) => firstDue(a) - firstDue(b) || a.label.localeCompare(b.label));
}

function dueTime(item: WorkItem): number {
  return item.due ? Date.parse(item.due.at) : Number.POSITIVE_INFINITY;
}

function firstDue(g: ClassGroup): number {
  return Math.min(...[...g.soon, ...g.later].map(dueTime), Number.POSITIVE_INFINITY);
}
