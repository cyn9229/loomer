// React hook for the work-session screen. All decisions live in loadSessionModel;
// this hook re-runs it when the store or AI settings change.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../core/db';
import { aiSettingsItem } from '../core/settings';
import { loadSessionModel } from '../session/model';
import type { SessionModel } from './session';

/** Re-evaluates periodically so time-based states (pending replies) move on. */
const TICK_MS = 15_000;

export function useSessionModel(): SessionModel | undefined {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    const unwatch = aiSettingsItem.watch(() => setTick((t) => t + 1));
    return () => {
      clearInterval(id);
      unwatch();
    };
  }, []);
  return useLiveQuery(async () => loadSessionModel(db, await aiSettingsItem.getValue(), new Date()), [tick]);
}
