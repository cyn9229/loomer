// Hint-first help and requested review on the student's own work. Both pass the
// work-help AI check before sending and again before storing the reply. Quoted
// references must appear in the text that was sent, or they are dropped.
import {
  brokerEnvelopeSchema,
  HELP_ROUTE,
  helpResponseSchema,
  REVIEW_ROUTE,
  reviewResponseSchema,
  type BrokerReply,
  type HelpRequest,
  type ReviewRequest,
} from '../../../shared/ai-contract';
import { studentText } from '../adapters/docs/reader';
import { instructionText, type ChatRecord, type LoomerDb } from '../core/db';
import { checkAiDispatch, type AiDenyReason } from '../core/gate';
import type { AiSettings } from '../core/settings';
import { assignmentPolicy, courseKey, policyAnswer } from '../analysis/facts';
import type { PolicyResult } from '../analysis/policy';
import { isQuiz, storedWorkType } from '../analysis/workType';

const MAX_WORK_CHARS = 15_000;

type WorkContext = Pick<HelpRequest, 'title' | 'instructions' | 'rubric' | 'studentWork' | 'workScope'>;

/** `quiz`: the item is a quiz or test taken online; AI help on it is always off. */
export type HelpDecision = ({ allowed: true } | { allowed: false; reason: AiDenyReason | 'quiz' }) & { policy: PolicyResult | null };

/** Whether work help is allowed now, from the quiz rule, consent, detected policy, and the student's answer. */
export async function workHelpDecision(db: LoomerDb, ai: AiSettings, assignmentId: string): Promise<HelpDecision> {
  const a = await db.assignments.get(assignmentId);
  if (!a) return { allowed: false, reason: 'policy-unresolved', policy: null };
  const policy = assignmentPolicy(a, await db.courses.get(courseKey(a)));
  if (isQuiz(a)) return { allowed: false, reason: 'quiz', policy };
  const context = (await db.studentContext.bulkGet([a.id, courseKey(a)])).filter((c) => c !== undefined);
  const answer = policyAnswer(a, new Map(context.map((c) => [c.key, c])));
  return { ...checkAiDispatch({ aiEnabled: ai.enabled, policy, answer, purpose: 'work-help' }), policy };
}

async function workContext(db: LoomerDb, assignmentId: string): Promise<WorkContext | null> {
  const a = await db.assignments.get(assignmentId);
  if (!a) return null;
  const instructions = instructionText(a.detail);
  const link = await db.docLinks.get(assignmentId);
  const doc = link ? (await db.docReads.get(link.docId))?.current : undefined;
  const own = doc ? studentText(doc.text, instructions) : '';
  return {
    title: a.title.slice(0, 300),
    instructions: instructions.slice(0, 12_000),
    rubric: (a.detail?.rubric ?? []).slice(0, 30).map((r) => ({ description: r.description.slice(0, 1_000), points: r.points })),
    studentWork: own.slice(0, MAX_WORK_CHARS),
    workScope: !doc ? 'none' : own.length > MAX_WORK_CHARS ? 'partial' : 'full',
  };
}

const normalize = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/** Keeps references whose quote is in the matching sent text. */
function grounded(refs: ChatRecord['references'], ctx: WorkContext): ChatRecord['references'] {
  const draft = normalize(ctx.studentWork);
  const instructions = normalize([ctx.instructions, ...ctx.rubric.map((r) => r.description)].join('\n'));
  return refs.filter((r) => r.quote.trim().length >= 4 && (r.from === 'your draft' ? draft : instructions).includes(normalize(r.quote)));
}

async function post(ai: AiSettings, route: string, body: unknown, fetchImpl: typeof fetch): Promise<BrokerReply<unknown>> {
  try {
    const res = await fetchImpl(`${ai.brokerOrigin}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-loomer-client': 'extension' },
      body: JSON.stringify(body),
    });
    const envelope = brokerEnvelopeSchema.safeParse(await res.json().catch(() => null));
    return envelope.success ? envelope.data : { ok: false, error: `AI service status ${res.status}` };
  } catch (error) {
    return { ok: false, error: `AI service unreachable: ${error instanceof Error ? error.message : 'unknown'}` };
  }
}

async function say(db: LoomerDb, assignmentId: string, kind: ChatRecord['kind'], text: string, references: ChatRecord['references'] = []) {
  await db.chat.add({ assignmentId, role: 'loomer', kind, text, references, createdAt: new Date().toISOString() });
}

/**
 * One plain sentence for a failed AI request, from the service's technical
 * reason. The technical reason goes to the console, never to the student.
 */
export function serviceSentence(reason: string): string {
  console.warn('loomer: AI request failed:', reason);
  if (/timed out/i.test(reason)) return "Loomer's AI didn't answer in time, so try again.";
  if (/not configured/i.test(reason)) return "Loomer's AI isn't set up on this computer yet.";
  if (/rate-limited|429/i.test(reason)) return 'Loomer is getting a lot of questions right now, so wait a minute and try again.';
  if (/unreachable/i.test(reason)) return "Loomer's AI isn't running right now, so try again in a bit.";
  return "Loomer's AI isn't answering right now, so try again in a bit.";
}

export type HelpDeps = { db: LoomerDb; ai: () => Promise<AiSettings>; fetch?: typeof fetch };

export async function askHelp({ db, ai, fetch: fetchImpl = fetch }: HelpDeps, assignmentId: string, question: string) {
  const settings = await ai();
  const history = (await db.chat.where('assignmentId').equals(assignmentId).toArray()).slice(-8);
  await db.chat.add({ assignmentId, role: 'student', kind: 'question', text: question, references: [], createdAt: new Date().toISOString() });

  if (!(await workHelpDecision(db, settings, assignmentId)).allowed) {
    await say(db, assignmentId, 'notice', "Loomer can't help with this one right now, so check the note above.");
    return;
  }
  const ctx = await workContext(db, assignmentId);
  if (!ctx) return;
  const a = await db.assignments.get(assignmentId);
  const request: HelpRequest = {
    ...ctx,
    workType: a ? await storedWorkType(db, a) : 'writing',
    question,
    history: history.filter((m) => m.kind !== 'notice').map((m) => ({ role: m.role, text: m.text.slice(0, 2_000) })),
  };
  const reply = await post(settings, HELP_ROUTE, request, fetchImpl);

  // Permission may have changed while waiting (AI turned off, ban found).
  if (!(await workHelpDecision(db, await ai(), assignmentId)).allowed) return;
  const parsed = reply.ok ? helpResponseSchema.safeParse(reply.result) : null;
  if (!parsed?.success) {
    await say(db, assignmentId, 'notice', reply.ok ? "Loomer's answer didn't come through, so try again." : serviceSentence(reply.error));
    return;
  }
  const { kind, reply: text, references } = parsed.data;
  await say(db, assignmentId, kind === 'question' ? 'hint' : kind, text.slice(0, 1_200), grounded(references, ctx));
}

export async function requestReview({ db, ai, fetch: fetchImpl = fetch }: HelpDeps, assignmentId: string) {
  const settings = await ai();
  await db.chat.add({ assignmentId, role: 'student', kind: 'question', text: 'Review my draft.', references: [], createdAt: new Date().toISOString() });
  if (!(await workHelpDecision(db, settings, assignmentId)).allowed) {
    await say(db, assignmentId, 'notice', "Loomer can't review this one right now, so check the note above.");
    return;
  }
  const ctx = await workContext(db, assignmentId);
  if (!ctx) return;
  if (ctx.workScope === 'none' || ctx.studentWork.trim().length === 0) {
    await say(db, assignmentId, 'notice', 'Link your draft and write a little first so Loomer has something to read.');
    return;
  }
  const request: ReviewRequest = ctx;
  const reply = await post(settings, REVIEW_ROUTE, request, fetchImpl);
  if (!(await workHelpDecision(db, await ai(), assignmentId)).allowed) return;
  const parsed = reply.ok ? reviewResponseSchema.safeParse(reply.result) : null;
  if (!parsed?.success) {
    await say(db, assignmentId, 'notice', reply.ok ? "Loomer's review didn't come through, so try again." : serviceSentence(reply.error));
    return;
  }
  // A finding must point at the student's own text; otherwise it is dropped.
  const draft = normalize(ctx.studentWork);
  const findings = parsed.data.findings.filter((f) => f.quote.trim().length >= 4 && draft.includes(normalize(f.quote)));
  const text = [
    parsed.data.summary,
    ...findings.map((f, i) => `${i + 1}. ${f.issue} (${f.criterion}) ${f.question}`),
    findings.length === 0 ? "Loomer didn't find anything to point to in your draft." : null,
  ]
    .filter(Boolean)
    .join('\n');
  await say(db, assignmentId, 'review', text, findings.map((f) => ({ quote: f.quote, from: 'your draft' as const })));
}
