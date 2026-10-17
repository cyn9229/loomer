// Opt-in desktop notifications. Only verified deadline changes (one per change,
// coalesced) and at most one research reminder per session. Writing hints never
// notify. Loomer works fully without any of this; the OS may suppress them.
import { storage } from 'wxt/utils/storage';
import type { DeadlineChange } from '../core/db';

/** Change keys already notified, so a refresh never repeats one. Bounded. */
const notifiedItem = storage.defineItem<string[]>('local:notified', { fallback: [] });
const MAX_REMEMBERED = 200;

export type Notifier = (id: string, title: string, message: string) => Promise<void>;

/** Notifies each change once. Several changes in one check become one notification. */
export async function notifyDeadlineChanges(changes: DeadlineChange[], notify: Notifier) {
  const seen = new Set(await notifiedItem.getValue());
  const fresh = changes.filter((c) => !seen.has(`${c.assignmentId}|${c.to}`));
  if (fresh.length === 0) return;
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const message =
    fresh.length === 1
      ? `${fresh[0]!.title}: now due ${when(fresh[0]!.to)} (was ${when(fresh[0]!.from)}).`
      : `${fresh.length} due dates changed in Canvas. Open Loomer to see which.`;
  await notify(`deadline-${Date.now()}`, 'Canvas due date changed', message);
  await notifiedItem.setValue([...seen, ...fresh.map((c) => `${c.assignmentId}|${c.to}`)].slice(-MAX_REMEMBERED));
}
