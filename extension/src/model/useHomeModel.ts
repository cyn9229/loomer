// React hook that turns the local store into a HomeModel. All decisions live in
// buildHomeModel; this hook only gathers inputs and re-runs on store changes.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { buildHomeModel } from '../analysis/recommend';
import { db } from '../core/db';
import { aiSettingsItem, settingsItem } from '../core/settings';
import type { HomeModel } from './home';

/** Re-evaluates every 30 s so time-based states (waiting for analysis, due dates) move on. */
const TICK_MS = 30_000;

export function useHomeModel(): HomeModel | undefined {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    const unwatch = [settingsItem.watch(() => setTick((t) => t + 1)), aiSettingsItem.watch(() => setTick((t) => t + 1))];
    return () => {
      clearInterval(id);
      unwatch.forEach((u) => u());
    };
  }, []);

  return useLiveQuery(async () => {
    const [settings, ai, lastRun, assignments, courses, analyses, context, packets, sources, links, active] = await Promise.all([
      settingsItem.getValue(),
      aiSettingsItem.getValue(),
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
  }, [tick]);
}
