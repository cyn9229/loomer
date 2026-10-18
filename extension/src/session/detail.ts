// Builds the assignment detail model: requirements with Observed / Needs review /
// Unknown, the evidence behind each, and the student's own corrections.
import type { LoomerDb } from '../core/db';
import type { AiSettings } from '../core/settings';
import { courseKey } from '../analysis/facts';
import { workItemFor } from '../analysis/recommend';
import type { AssignmentDetailModel, RequirementItem } from '../model/detail';
import { workHelpDecision } from './help';
import { availability, toSourceItem } from './model';
import { requirementList } from './requirements';

/** A pending check older than this is treated as abandoned (worker stopped). */
const PENDING_STALE_MS = 120_000;
const EXCERPT_CHARS = 600;

export async function loadAssignmentDetail(db: LoomerDb, ai: AiSettings, assignmentId: string, now: Date): Promise<AssignmentDetailModel> {
  const a = await db.assignments.get(assignmentId);
  if (!a) return { status: 'missing' };
  const [course, analysis, context, link, sources, check, decision] = await Promise.all([
    db.courses.get(courseKey(a)),
    db.analyses.get(a.id),
    db.studentContext.bulkGet([a.id, courseKey(a)]),
    db.docLinks.get(a.id),
    db.sources.where('assignmentId').equals(a.id).toArray(),
    db.requirementChecks.get(a.id),
    workHelpDecision(db, ai, a.id),
  ]);
  const read = link ? await db.docReads.get(link.docId) : undefined;
  const contextMap = new Map(context.filter((c) => c !== undefined).map((c) => [c.key, c]));
  const item = workItemFor(a, { course, analysis, context: contextMap }, now);
  const own = contextMap.get(a.id);

  const done = check?.status === 'ok' ? check : null;
  const requirements: RequirementItem[] = requirementList(a, analysis).map((r, index) => {
    const found = done?.items.find((i) => i.index === index);
    return {
      text: r.text,
      source: { quote: r.quote, label: r.label },
      state: found?.state ?? 'unknown',
      evidence: found && found.state !== 'unknown' ? { quote: found.quote, note: found.note } : null,
    };
  });

  const ok = analysis?.status === 'ok' && analysis.detailHash === a.detail?.hash && item.policy.state !== 'blocked' ? analysis : null;
  return {
    status: 'ok',
    item,
    descriptionExcerpt: (a.detail?.text ?? '').slice(0, EXCERPT_CHARS),
    requirements,
    check: done ? { at: done.createdAt, scope: done.scope, stale: done.docHash !== read?.current?.hash } : null,
    checkAvailability: !link ? 'no-doc' : availability(decision).availability,
    checkPending: check?.status === 'pending' && now.getTime() - Date.parse(check.startedAt) < PENDING_STALE_MS,
    effort: { label: item.effort.label, reason: ok?.effortReason.text ?? null, quote: ok?.effortReason.quote || null },
    plainWords: ok?.plainWords || null,
    links: {
      instructions: a.detail?.links ?? [],
      doc: link?.url ?? null,
      sources: sources.sort((x, y) => y.capturedAt.localeCompare(x.capturedAt)).map(toSourceItem),
    },
    correction: own?.correction ?? null,
    note: own?.note ?? null,
  };
}
