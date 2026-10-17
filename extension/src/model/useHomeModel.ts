// React hook that turns the local store into a HomeModel. All decisions live in
// buildHomeModel; this hook only gathers inputs and re-runs on store changes.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { buildHomeModel } from '../analysis/recommend';
import { db } from '../core/db';
import { aiSettingsItem, settingsItem } from '../core/settings';
import type { HomeModel } from './home';
import { useStorageItem } from './useStorageItem';

/** Re-evaluates every 30 s so time-based states (waiting for analysis, due dates) move on. */
const TICK_MS = 30_000;

export function useHomeModel(): HomeModel | undefined {
  const settings = useStorageItem(settingsItem);
  const ai = useStorageItem(aiSettingsItem);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Dexie reads only: a non-Dexie await here would stop live updates from the worker.
  return useLiveQuery(async () => {
    if (!settings || !ai) return undefined;
    const [lastRun, assignments, courses, analyses, context, packets, sources, links, active] = await Promise.all([
      db.runs.orderBy('startedAt').last(),
      db.assignments.toArray(),
      db.courses.toArray(),
      db.analyses.toArray(),
      db.studentContext.toArray(),
      db.resumePackets.toArray(),
      db.sources.toArray(),
      db.docLinks.toArray(),
      db.sessions.where('state').equals('active').count(),
    ]);
    return buildHomeModel({
      connected: Boolean(settings.canvasOrigin),
      assignments,
      courses,
      analyses,
      context,
      ai,
      lastRun,
      now: new Date(),
      packets,
      sources,
      docUrls: new Map(links.map((l) => [l.assignmentId, l.url])),
      activeSession: active > 0,
    });
  }, [settings, ai, tick]);
}
