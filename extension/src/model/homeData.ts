// Gathers the stored inputs for buildHomeModel. Dexie reads only, so it can run
// inside a live query; the panel hook and the worker share it so both see the
// same plan.
import type { RecommendInput } from '../analysis/recommend';
import type { LoomerDb } from '../core/db';

export type HomeData = Pick<RecommendInput, 'assignments' | 'courses' | 'analyses' | 'context' | 'lastRun' | 'packets' | 'sources' | 'docUrls' | 'activeSession'>;

export async function loadHomeData(db: LoomerDb): Promise<HomeData> {
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
  return {
    lastRun,
    assignments,
    courses,
    analyses,
    context,
    packets,
    sources,
    docUrls: new Map(links.map((l) => [l.assignmentId, l.url])),
    activeSession: active > 0,
  };
}
