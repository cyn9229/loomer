// React hook for the work-session screen. All decisions live in loadSessionModel.
// The live query touches only Dexie, so worker writes show up immediately.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../core/db';
import { aiSettingsItem } from '../core/settings';
import { loadSessionModel } from '../session/model';
import type { SessionModel } from './session';
import { useStorageItem } from './useStorageItem';

/** Re-evaluates periodically so time-based states (pending replies) move on. */
const TICK_MS = 15_000;

export function useSessionModel(): SessionModel | undefined {
  const ai = useStorageItem(aiSettingsItem);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return useLiveQuery(() => (ai ? loadSessionModel(db, ai, new Date()) : undefined), [ai, tick]);
}
