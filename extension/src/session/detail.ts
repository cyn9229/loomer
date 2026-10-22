// Builds the assignment detail model: requirements with Observed / Needs review /
// Unknown, the evidence behind each, and the student's own corrections.
import { loadTeacherSheets } from './topics';
import type { LoomerDb } from '../core/db';
import type { AiSettings } from '../core/settings';
import { courseKey } from '../analysis/facts';
import { workItemFor } from '../analysis/recommend';
import { loadReadInputs } from '../analysis/read';
import type { AssignmentDetailModel, RequirementItem } from '../model/detail';
import { workHelpDecision } from './help';
import { availability } from './model';
import { editableFields } from './added';
import { loadPrep } from '../prep/prep';
import { sourceView } from './sources';
import { requirementList } from './requirements';
import { loadWaitTimes, overdue, pendingOf, type WaitTimes } from '../core/waits';
import type { RequirementCheck } from '../core/db';
import type { Failed, Pending } from '../model/wait';

/** A failed check is shown this long; after that the page just offers the check again. */
const FAILED_SHOWN_MS = 30 * 60_000;
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
  const item = workItemFor(a, { course, analysis, context: contextMap, read: await loadReadInputs(db, ai.enabled, a.id) }, now);
  const own = contextMap.get(a.id);

  const done = check?.status === 'ok' ? check : null;
  const times = await loadWaitTimes(db);
  const checkWait = checkWaitView(check, requirementList(a, analysis).length, times, now);
  const hints = (await db.hints.where('assignmentId').equals(a.id).sortBy('id')).filter((h) => h.requirement && (h.state === 'shown' || h.state === 'changed' || h.state === 'handled'));
  const requirements: RequirementItem[] = requirementList(a, analysis).map((r, index) => {
    const found = done?.items.find((i) => i.index === index);
    const latest = hints.filter((h) => h.requirement === r.text).at(-1);
    return {
      text: r.text,
      source: { quote: r.quote, label: r.label },
      state: found?.state ?? 'unknown',
      evidence: found && found.state !== 'unknown' ? { quote: found.quote, note: found.note } : null,
      hint: latest ? { text: latest.text, state: latest.state === 'handled' ? 'handled' : 'open' } : null,
    };
  });

  const ok = analysis?.status === 'ok' && analysis.detailHash === a.detail?.hash && item.policy.state !== 'blocked' ? analysis : null;
  const saved = await sourceView(db, a, sources);
  return {
    status: 'ok',
    item,
    descriptionExcerpt: (a.detail?.text ?? '').slice(0, EXCERPT_CHARS),
    requirements,
    check: done ? { at: done.createdAt, scope: done.scope, stale: done.docHash !== read?.current?.hash } : null,
    checkAvailability: !link ? 'no-doc' : availability(decision).availability,
    checkPending: checkWait.pending,
    checkFailed: checkWait.failed,
    effort: { label: item.effort.label, reason: ok?.effortReason.text ?? null, quote: ok?.effortReason.quote || null },
    plainWords: ok?.plainWords || null,
    plainShort: ok?.plainShort || ok?.plainWords?.split(/(?<=[.!?])\s/)[0] || null,
    links: {
      instructions: a.detail?.links ?? [],
      doc: link?.url ?? null,
      sources: saved.items,
    },
    sourceNeed: saved.need,
    correction: own?.correction ?? null,
    sheets: await loadTeacherSheets(db, a),
    note: own?.note ?? null,
    editable: editableFields(a, own?.workType ?? null, link?.url ?? null),
    prep: await loadPrep(db, a, now),
  };
}

/** The draft check as a wait: running, failed (shown for a while), or neither. A check running past its time counts as failed. */
function checkWaitView(check: RequirementCheck | undefined, requirements: number, times: WaitTimes, now: Date): { pending: Pending | null; failed: Failed | null } {
  if (check?.status === 'pending') {
    if (overdue('check', times, check.startedAt, now)) return { pending: null, failed: { text: 'Loomer stopped before it finished checking your draft, so try again.', retry: true } };
    const about = `Your draft and ${requirements} ${requirements === 1 ? 'requirement' : 'requirements'}`;
    return { pending: pendingOf('check', times, { title: 'Checking your draft', about, startedAt: check.startedAt }), failed: null };
  }
  if (check?.status === 'failed' && now.getTime() - Date.parse(check.createdAt) < FAILED_SHOWN_MS) {
    return { pending: null, failed: { text: "Loomer couldn't reach its AI helper to check your draft, so try again in a bit.", retry: true } };
  }
  return { pending: null, failed: null };
}
