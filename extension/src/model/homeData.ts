// Gathers the stored inputs for buildHomeModel. Dexie reads only, so it can run
// inside a live query; the panel hook and the worker share it so both see the
// same plan.
import type { RecommendInput } from '../analysis/recommend';
import type { LoomerDb, WorkSession } from '../core/db';
import { localDay } from '../analysis/plan';
import { loadWaitTimes } from '../core/waits';

export type HomeData = Pick<RecommendInput, 'assignments' | 'courses' | 'analyses' | 'context' | 'lastRun' | 'packets' | 'sources' | 'docUrls' | 'activeSession' | 'room' | 'planChanges' | 'sheetTopics' | 'topicChecks' | 'workedDays' | 'preps' | 'practices' | 'waits' | 'waitTimes'>;

export async function loadHomeData(db: LoomerDb): Promise<HomeData> {
  const [lastRun, assignments, courses, analyses, context, packets, sources, links, active, room, planChanges, sheetTopics, topicChecks, sessions, preps, practices] = await Promise.all([
    db.runs.orderBy('startedAt').last(),
    db.assignments.toArray(),
    db.courses.toArray(),
    db.analyses.toArray(),
    db.studentContext.toArray(),
    db.resumePackets.toArray(),
    db.sources.toArray(),
    db.docLinks.toArray(),
    db.sessions.where('state').equals('active').count(),
    db.dayRoom.toArray(),
    db.planChanges.toArray(),
    db.sheetTopics.toArray(),
    db.topicChecks.toArray(),
    db.sessions.toArray(),
    db.preps.toArray(),
    db.practices.toArray(),
  ]);
  const [waits, waitTimes] = await Promise.all([db.waits.toArray(), loadWaitTimes(db)]);
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
    room,
    planChanges,
    sheetTopics,
    topicChecks,
    workedDays: workedDays(sessions),
    preps,
    practices,
    waits,
    waitTimes,
  };
}

/** Local days with a session, by assignment. */
function workedDays(sessions: WorkSession[]): Map<string, string[]> {
  const days = new Map<string, string[]>();
  for (const s of sessions) {
    const day = localDay(new Date(s.startedAt));
    const list = days.get(s.assignmentId) ?? [];
    if (!list.includes(day)) days.set(s.assignmentId, [...list, day]);
  }
  return days;
}
