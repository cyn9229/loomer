// Data contract for plan changes ("Thursday is busy", "make the essay Heavy").
// Logic owns this file. The AI proposes a change in chat; the logic checks it
// and computes a before-and-after preview with the real planner; nothing is
// written until the student taps Apply (plan:apply). Undo is plan:undo.
import type { DayRoom } from './home';

export type PlanPreview = {
  /** One plain line per edit, e.g. "Thursdays: busy, every week" or "Essay workload: Heavy (was Medium)". */
  lines: string[];
  /** Days in the next two weeks whose room changes. */
  days: { date: string; before: DayRoom; after: DayRoom }[];
  /** Start days that change, e.g. "start Thu → Wed". Dates are ISO times on the local day. */
  moves: { assignmentId: string; title: string; from: string | null; to: string | null }[];
};

export type PlanChangeView = {
  id: string;
  /** proposed: show Apply / Not now. applied: show Undo. */
  status: 'proposed' | 'applied' | 'undone' | 'dismissed';
  preview: PlanPreview;
  createdAt: string;
  appliedAt: string | null;
};
