// Requirement-level evidence: checks the linked draft against the requirement
// list on request. Observed and Needs review must quote the draft or they become
// Unknown. A check belongs to one draft version and goes stale when it changes.
import {
  brokerEnvelopeSchema,
  REQUIREMENTS_CHECK_ROUTE,
  requirementsCheckResponseSchema,
  type RequirementsCheckRequest,
} from '../../../shared/ai-contract';
import { studentText } from '../adapters/docs/reader';
import type { Analysis, Assignment, LoomerDb, RequirementCheck } from '../core/db';
import type { AiSettings } from '../core/settings';
import { workHelpDecision } from './help';

const MAX_WORK_CHARS = 15_000;

/** One requirement with the passage that states it. */
export type RequirementSource = { text: string; quote: string; label: string };

/**
 * The requirement list: rubric criteria (school facts) first, then AI-read
 * deliverables that are not already covered by a criterion.
 */
export function requirementList(a: Assignment, analysis: Analysis | undefined): RequirementSource[] {
  const rubric = (a.detail?.rubric ?? []).map((r) => ({ text: r.description, quote: r.description, label: 'Rubric' }));
  const deliverables =
    analysis?.status === 'ok' && analysis.detailHash === a.detail?.hash
      ? analysis.deliverables.map((d) => ({ text: d.text, quote: d.quote, label: 'Instructions (as Loomer read them)' }))
      : [];
  const seen = new Set(rubric.map((r) => r.text.toLowerCase()));
  return [...rubric, ...deliverables.filter((d) => !seen.has(d.text.toLowerCase()))].slice(0, 20);
}

const normalize = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

export type CheckDeps = { db: LoomerDb; ai: () => Promise<AiSettings>; fetch?: typeof fetch };

export async function checkRequirements({ db, ai, fetch: fetchImpl = fetch }: CheckDeps, assignmentId: string, now = new Date()) {
  const a = await db.assignments.get(assignmentId);
  const link = await db.docLinks.get(assignmentId);
  const read = link ? await db.docReads.get(link.docId) : undefined;
  if (!a || !read?.current) return;
  if (!(await workHelpDecision(db, await ai(), assignmentId)).allowed) return;

  const requirements = requirementList(a, await db.analyses.get(assignmentId));
  if (requirements.length === 0) return;
  const own = studentText(read.current.text, a.detail?.text ?? '');
  const docHash = read.current.hash;
  // Records are typed first: Dexie's insert type does not narrow a union.
  const pending: RequirementCheck = { assignmentId, status: 'pending', startedAt: now.toISOString() };
  await db.requirementChecks.put(pending);

  const request: RequirementsCheckRequest = {
    title: a.title.slice(0, 300),
    instructions: (a.detail?.text ?? '').slice(0, 12_000),
    studentWork: own.slice(0, MAX_WORK_CHARS),
    workScope: own.length > MAX_WORK_CHARS ? 'partial' : 'full',
    requirements: requirements.map((r, index) => ({ index, text: r.text.slice(0, 1_000) })),
  };

  let result: unknown = null;
  let error = 'AI service unreachable';
  try {
    const res = await fetchImpl(`${(await ai()).brokerOrigin}${REQUIREMENTS_CHECK_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-loomer-client': 'extension' },
      body: JSON.stringify(request),
    });
    const envelope = brokerEnvelopeSchema.safeParse(await res.json().catch(() => null));
    if (envelope.success && envelope.data.ok) result = envelope.data.result;
    else if (envelope.success && !envelope.data.ok) error = envelope.data.error;
  } catch {
    /* error stays as unreachable */
  }

  // Permission may have changed while waiting; a new draft version is fine (the check is marked stale).
  if (!(await workHelpDecision(db, await ai(), assignmentId)).allowed) {
    await db.requirementChecks.delete(assignmentId);
    return;
  }
  const parsed = requirementsCheckResponseSchema.safeParse(result);
  if (!parsed.success) {
    const failed: RequirementCheck = { assignmentId, status: 'failed', createdAt: now.toISOString(), error };
    await db.requirementChecks.put(failed);
    return;
  }
  const draft = normalize(own);
  const items = requirements.map((_, index) => {
    const item = parsed.data.items.find((i) => i.index === index);
    const grounded = item && item.state !== 'unknown' && item.quote.trim().length >= 4 && draft.includes(normalize(item.quote));
    return grounded
      ? { index, state: item.state, quote: item.quote, note: item.note.slice(0, 300) }
      : { index, state: 'unknown' as const, quote: '', note: '' };
  });
  const record: RequirementCheck = { assignmentId, status: 'ok', docHash, scope: request.workScope === 'partial' ? 'partial' : 'full', createdAt: now.toISOString(), items };
  await db.requirementChecks.put(record);
}
