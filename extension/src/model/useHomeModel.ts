// React hook that turns the local store into a HomeModel. Logic owns this file.
// M2 in progress: today it only reports not-connected or checking; recommendation
// states arrive with src/analysis/recommend.ts.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../core/db';
import { settingsItem } from '../core/settings';
import type { HomeModel } from './home';

export function useHomeModel(): HomeModel | undefined {
  return useLiveQuery(async (): Promise<HomeModel> => {
    const { canvasOrigin } = await settingsItem.getValue();
    if (!canvasOrigin) return { status: 'not-connected' };
    const run = await db.runs.orderBy('startedAt').last();
    return {
      status: 'checking',
      progress: { checked: 0, total: 0 },
      pending: [],
      rest: [],
      lastCheck: run
        ? {
            at: run.finishedAt,
            outcome: run.outcome,
            courses: run.coverage.courses,
            partial: run.outcome === 'partial' || run.coverage.plannerTruncated,
            replay: run.origin ? new URL(run.origin).protocol === 'http:' : false,
          }
        : null,
    };
  });
}
