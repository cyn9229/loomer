// Whether work help is allowed, and "Review my draft" on the student's own work.
// The review passes the work-help AI check before sending and again before
// storing the reply. A finding must quote the student's text, or it is dropped.
import {
  brokerEnvelopeSchema,
  REVIEW_ROUTE,
  reviewResponseSchema,
  type BrokerReply,
  type ReviewRequest,
} from '../../../shared/ai-contract';
import { studentText, wordCount } from '../adapters/docs/reader';
import { instructionText, type LoomerDb } from '../core/db';
import { checkAiDispatch, type AiDenyReason } from '../core/gate';
import { noteThread } from '../chat/threads';
import type { AiSettings } from '../core/settings';
import { assignmentPolicy, courseKey, policyAnswer } from '../analysis/facts';
import type { PolicyResult } from '../analysis/policy';
import { isQuiz } from '../analysis/workType';

const MAX_WORK_CHARS = 15_000;

type WorkContext = ReviewRequest;

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

/** The student's own text from their linked Doc (teacher lines removed), or null when none is readable. */
export async function ownDraft(db: LoomerDb, assignmentId: string): Promise<{ text: string; words: number } | null> {
  const [a, link] = await Promise.all([db.assignments.get(assignmentId), db.docLinks.get(assignmentId)]);
  const doc = link ? (await db.docReads.get(link.docId))?.current : undefined;
  if (!a || !doc) return null;
  const text = studentText(doc.text, instructionText(a.detail));
  return text.trim() ? { text, words: wordCount(text) } : null;
}

const normalize = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();


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

/**
 * "Review my draft": the student's request and Loomer's findings go into the
 * assignment's chat thread, so they stay with the rest of the conversation.
 * The reply turn is written first as streaming, then filled in.
 */
export async function requestReview({ db, ai, fetch: fetchImpl = fetch }: HelpDeps, assignmentId: string) {
  const settings = await ai();
  const at = () => new Date().toISOString();
  await db.chatTurns.add({ threadKey: assignmentId, role: 'student', blocks: [{ kind: 'markdown', text: 'Review my draft.' }], status: 'done', createdAt: at() });
  const turnId = await db.chatTurns.add({ threadKey: assignmentId, role: 'loomer', blocks: [], status: 'streaming', createdAt: at() });
  await noteThread(db, assignmentId, 'review');
  const notice = async (text: string) => {
    await db.chatTurns.update(turnId, { blocks: [{ kind: 'markdown', text }], status: 'error', error: 'notice' });
    await noteThread(db, assignmentId);
  };

  if (!(await workHelpDecision(db, settings, assignmentId)).allowed) return notice("Loomer can't review this one right now, so check the note above.");
  const ctx = await workContext(db, assignmentId);
  if (!ctx) return notice("Loomer couldn't find that assignment.");
  if (ctx.workScope === 'none' || ctx.studentWork.trim().length === 0) return notice('Link your draft and write a little first so Loomer has something to read.');
  const request: ReviewRequest = ctx;
  const reply = await post(settings, REVIEW_ROUTE, request, fetchImpl);
  // Permission may have changed while waiting (AI turned off, ban found).
  if (!(await workHelpDecision(db, await ai(), assignmentId)).allowed) return notice("Loomer can't review this one right now, so check the note above.");
  const parsed = reply.ok ? reviewResponseSchema.safeParse(reply.result) : null;
  if (!parsed?.success) return notice(reply.ok ? "Loomer's review didn't come through, so try again." : serviceSentence(reply.error));
  // A finding must point at the student's own text; otherwise it is dropped.
  const draft = normalize(ctx.studentWork);
  const findings = parsed.data.findings
    .filter((f) => f.quote.trim().length >= 4 && draft.includes(normalize(f.quote)))
    .map(({ issue, criterion, question, quote }) => ({ issue, criterion, question, quote }));
  const summary = findings.length === 0 ? `${parsed.data.summary} Loomer didn't find anything to point to in your draft.` : parsed.data.summary;
  await db.chatTurns.update(turnId, { blocks: [{ kind: 'draft-check', summary, findings, scope: ctx.workScope === 'partial' ? 'partial' : 'full' }], status: 'done' });
  await noteThread(db, assignmentId);
}
