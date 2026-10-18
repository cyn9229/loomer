// React hook that turns the local store into a HomeModel. All decisions live in
// buildHomeModel; this hook only gathers inputs and re-runs on store changes.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { buildHomeModel } from '../analysis/recommend';
import { db } from '../core/db';
import { aiSettingsItem, briefDismissedItem, choiceItem, planSnapshotItem, settingsItem } from '../core/settings';
import { loadHomeData } from './homeData';
import type { HomeModel } from './home';
import { useStorageItem } from './useStorageItem';

/** Re-evaluates every 30 s so time-based states (waiting for analysis, due dates) move on. */
const TICK_MS = 30_000;

export function useHomeModel(): HomeModel | undefined {
  const settings = useStorageItem(settingsItem);
  const ai = useStorageItem(aiSettingsItem);
  const choice = useStorageItem(choiceItem);
  const snapshot = useStorageItem(planSnapshotItem);
  const briefDismissedOn = useStorageItem(briefDismissedItem);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Dexie reads only: a non-Dexie await here would stop live updates from the worker.
  return useLiveQuery(async () => {
    if (!settings || !ai || choice === undefined || snapshot === undefined || briefDismissedOn === undefined) return undefined;
    const data = await loadHomeData(db);
    return buildHomeModel({ ...data, connected: Boolean(settings.canvasOrigin), ai, choice, snapshot, briefDismissedOn, now: new Date() });
  }, [settings, ai, choice, snapshot, briefDismissedOn, tick]);
}
