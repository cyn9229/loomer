// React hook for the work nudge. Reads memory-only session storage, so it costs
// nothing when idle. Stale nudges and nudges turned off in settings are hidden.
import { NUDGE_STALE_MS, nudgeItem, nudgesItem } from '../session/nudge';
import type { WorkNudge } from './session';
import { useStorageItem } from './useStorageItem';

export function useNudge(now: Date): WorkNudge {
  const nudge = useStorageItem(nudgeItem) ?? null;
  const settings = useStorageItem(nudgesItem);
  if (!nudge || !settings?.enabled || now.getTime() - Date.parse(nudge.at) > NUDGE_STALE_MS) return null;
  return nudge;
}
