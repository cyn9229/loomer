// Runs AI requirement analysis for work in the decision set. Every result is
// tied to the requirement text it was made from; a result whose source changed,
// or whose permission was withdrawn while in flight, is discarded.
import {
  brokerEnvelopeSchema,
  REQUIREMENTS_ROUTE,
  requirementsResponseSchema,
  type BrokerReply,
  type RequirementsRequest,
  type RequirementsResponse,
} from '../../../shared/ai-contract';
import type { Analysis, Assignment, LoomerDb, Quoted } from '../core/db';
import { checkAiDispatch } from '../core/gate';
import type { AiSettings } from '../core/settings';
import { assignmentPolicy, courseKey, effectiveDue, inDecisionSet, policyAnswer } from './facts';

/** Provider failures are usually transient (timeouts, rate limits). */
const RETRY_FAILED_AFTER_MS = 10 * 60 * 1000;
const CONCURRENCY = 2;

export type AnalyzeOptions = { db: LoomerDb; ai: () => Promise<AiSettings>; now?: Date; fetch?: typeof fetch };

export async function analyzeRequirements({ db, ai, now = new Date(), fetch: fetchImpl = fetch }: AnalyzeOptions) {
  const [assignments, courses, context, analyses] = await Promise.all([
    db.assignments.toArray(),
    db.courses.toArray(),
    db.studentContext.toArray(),
    db.analyses.toArray(),
  ]);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const contextByKey = new Map(context.map((c) => [c.key, c]));
  const analysisById = new Map(analyses.map((a) => [a.assignmentId, a]));
  const settings = await ai();

  const queue: Assignment[] = [];
  for (const a of assignments) {
    if (!a.detail || !inDecisionSet(a, effectiveDue(a, now), now)) continue;
    const policy = assignmentPolicy(a, courseById.get(courseKey(a)));
    // A restriction found after an analysis removes that AI-derived content.
    if (policy.state === 'blocked' || policyAnswer(a, contextByKey) === 'teacher-forbids-ai') {
      if (analysisById.has(a.id)) await db.analyses.delete(a.id);
      continue;
    }
    const prior = analysisById.get(a.id);
    if (prior?.detailHash === a.detail.hash && (prior.status === 'ok' || now.getTime() - Date.parse(prior.createdAt) < RETRY_FAILED_AFTER_MS)) continue;
    const decision = checkAiDispatch({ aiEnabled: settings.enabled, policy, answer: policyAnswer(a, contextByKey), purpose: 'requirements-analysis' });
    if (decision.allowed) queue.push(a);
  }

  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) await analyzeOne(db, a, settings, ai, now, fetchImpl);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function analyzeOne(db: LoomerDb, a: Assignment, settings: AiSettings, ai: () => Promise<AiSettings>, now: Date, fetchImpl: typeof fetch) {
  const detail = a.detail!;
  const request: RequirementsRequest = {
    title: a.title.slice(0, 300),
    courseName: a.courseName?.slice(0, 200) ?? null,
    dueAt: a.dueAt,
    instructions: detail.text.slice(0, 12_000),
    rubric: detail.rubric.slice(0, 30).map((r) => ({ description: r.description.slice(0, 1_000), points: r.points })),
  };

  let reply: BrokerReply<unknown>;
  try {
    const res = await fetchImpl(`${settings.brokerOrigin}${REQUIREMENTS_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-loomer-client': 'extension' },
      body: JSON.stringify(request),
    });
    const envelope = brokerEnvelopeSchema.safeParse(await res.json().catch(() => null));
    reply = envelope.success ? envelope.data : { ok: false, error: `broker status ${res.status}` };
  } catch (error) {
    reply = { ok: false, error: `broker unreachable: ${error instanceof Error ? error.message : 'unknown'}` };
  }

  // Re-check before storing: the source, AI consent, and policy must be unchanged.
  const current = await db.assignments.get(a.id);
  const course = await db.courses.get(courseKey(a));
  const context = (await db.studentContext.bulkGet([a.id, courseKey(a)])).filter((c) => c !== undefined);
  const answer = policyAnswer(a, new Map(context.map((c) => [c.key, c])));
  const still =
    current?.detail?.hash === detail.hash &&
    checkAiDispatch({ aiEnabled: (await ai()).enabled, policy: assignmentPolicy(current, course), answer, purpose: 'requirements-analysis' }).allowed;
  if (!still) return;

  const base = { assignmentId: a.id, detailHash: detail.hash, createdAt: now.toISOString() };
  const parsed = reply.ok ? requirementsResponseSchema.safeParse(reply.result) : null;
  // Typed first: Dexie's insert type does not narrow a union record.
  const record: Analysis =
    reply.ok && parsed?.success
      ? { ...base, status: 'ok', model: reply.model, ...groundInSource(parsed.data, request) }
      : { ...base, status: 'failed', error: reply.ok ? 'invalid result' : reply.error };
  await db.analyses.put(record);
}

/**
 * Keeps only statements whose quote appears in the text that was sent. An
 * effort label without a verifiable quote becomes Unknown.
 */
export function groundInSource(r: RequirementsResponse, req: RequirementsRequest): Omit<Extract<Analysis, { status: 'ok' }>, 'assignmentId' | 'detailHash' | 'status' | 'createdAt' | 'model'> {
  const source = normalize([req.instructions, ...req.rubric.map((x) => x.description)].join('\n'));
  const supported = (q: Quoted) => q.quote.trim().length >= 8 && source.includes(normalize(q.quote));
  const effortOk = r.effort !== 'Unknown' && supported(r.effortReason);
  return {
    effort: effortOk ? r.effort : 'Unknown',
    effortReason: effortOk ? r.effortReason : { text: 'The instructions do not say enough to judge the effort.', quote: '' },
    deliverables: r.deliverables.filter(supported),
    milestones: r.milestones.filter(supported),
    firstStep: r.firstStep.trim().slice(0, 160),
  };
}

function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}
