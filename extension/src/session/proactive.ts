// Proactive writing hints. The pause timer only makes a hint *eligible*; it does
// not prove the student is stuck. A hint also needs an active session, a good
// Doc read, permitted AI help, enough new writing, and the cooldown to pass.
// The model may (and usually should) answer that nothing is useful.
import { endWait, startWait, waitKey } from '../core/waits';
import {
  brokerEnvelopeSchema,
  HINT_ISSUES,
  HINT_ROUTE,
  hintResponseSchema,
  type HintRequest,
} from '../../../shared/ai-contract';
import { studentText, wordCount } from '../adapters/docs/reader';
import { instructionText, type DocRead, type LoomerDb } from '../core/db';
import type { AiSettings, ProactiveSettings } from '../core/settings';
import { storedWorkType } from '../analysis/workType';
import { workHelpDecision } from './help';
import { requirementList } from './requirements';
import { currentSession } from './session';

export const HINT_COOLDOWN_MS = 3 * 60 * 1000;
/** After a finished paragraph, a shorter pause is enough. */
const PARAGRAPH_PAUSE_MS = 30_000;
/** A finished paragraph: a new line of at least this many words ending a sentence. */
const PARAGRAPH_MIN_WORDS = 25;
/** A changed passage not judged by then is let go. */
const CHANGED_STALE_MS = 30 * 60 * 1000;
/** Earlier hints sent for continuity. */
const EARLIER_HINTS = 5;
/** New words since the last evaluation before another one is worth making. */
export const MIN_NEW_WORDS = 25;
/** Words in the draft before the first evaluation. */
export const MIN_FIRST_WORDS = 40;

export type HintWait =
  | 'disabled'
  | 'no-doc'
  | 'doc-not-readable'
  | 'help-not-allowed'
  /** Unprompted hints are about writing; other work types get help only when asked. */
  | 'not-writing'
  | 'still-editing'
  | 'cooldown'
  | 'hint-showing'
  | 'no-new-evidence';

export type HintCheck = { eligible: true } | { eligible: false; wait: HintWait };

export type HintInputs = {
  proactive: ProactiveSettings;
  readOk: boolean;
  docLinked: boolean;
  helpAllowed: boolean;
  writing: boolean;
  /** Latest edit signal: a detected Doc change or a keystroke, ms epoch. */
  lastEditAt: number | null;
  lastHintAt: number | null;
  hintShowing: boolean;
  studentWords: number;
  currentHash: string;
  lastEval: { hash: string; studentWords: number } | null;
  /** The newest lines include a finished paragraph: a shorter pause is enough. */
  paragraphDone: boolean;
  /** A hinted passage was edited and awaits a follow-up judgement: that is new evidence. */
  changedHints: boolean;
  now: number;
};

/** Pure eligibility rules, in order. Inactivity alone never qualifies. */
export function hintEligibility(i: HintInputs): HintCheck {
  if (!i.proactive.enabled) return { eligible: false, wait: 'disabled' };
  if (!i.docLinked) return { eligible: false, wait: 'no-doc' };
  if (!i.readOk) return { eligible: false, wait: 'doc-not-readable' };
  if (!i.helpAllowed) return { eligible: false, wait: 'help-not-allowed' };
  if (!i.writing) return { eligible: false, wait: 'not-writing' };
  const pause = i.paragraphDone ? Math.min(PARAGRAPH_PAUSE_MS, i.proactive.delaySec * 1000) : i.proactive.delaySec * 1000;
  if (i.lastEditAt === null || i.now - i.lastEditAt < pause) return { eligible: false, wait: 'still-editing' };
  if (i.hintShowing) return { eligible: false, wait: 'hint-showing' };
  // A follow-up on an edited passage is not a new hint, so it skips the cooldown.
  if (!i.changedHints && i.lastHintAt !== null && i.now - i.lastHintAt < HINT_COOLDOWN_MS) return { eligible: false, wait: 'cooldown' };
  const newEvidence =
    (i.changedHints && i.lastEval?.hash !== i.currentHash) ||
    (i.lastEval
      ? i.lastEval.hash !== i.currentHash && Math.abs(i.studentWords - i.lastEval.studentWords) >= MIN_NEW_WORDS
      : i.studentWords >= MIN_FIRST_WORDS);
  if (!newEvidence) return { eligible: false, wait: 'no-new-evidence' };
  return { eligible: true };
}

export type ProactiveDeps = {
  db: LoomerDb;
  ai: () => Promise<AiSettings>;
  proactive: () => Promise<ProactiveSettings>;
  /** Last keystroke in the linked Doc (ms epoch), from the typing signal; null if none seen. */
  typingAt: () => Promise<number | null>;
  fetch?: typeof fetch;
};

const normalize = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/** The new lines include a finished paragraph: one line of enough words that ends a sentence. */
function finishedParagraph(added: string): boolean {
  return added.split('\n').some((line) => wordCount(line) >= PARAGRAPH_MIN_WORDS && /[.?!"”)]\s*$/.test(line.trim()));
}

/** Lines the student added since the previous read, bounded. */
function addedLines(read: DocRead, instructions: string): string {
  const before = new Set(read.previous ? studentText(read.previous.text, instructions).split('\n').map(normalize) : []);
  return studentText(read.current!.text, instructions)
    .split('\n')
    .filter((line) => !before.has(normalize(line)))
    .join('\n')
    .slice(-3_000);
}

/**
 * One proactive step for the active session. Withdraws shown hints whose passage
 * was edited away, then evaluates a new hint if the rules allow. Returns the
 * created hint id, or null.
 */
export async function proactiveStep(deps: ProactiveDeps, now: Date): Promise<number | null> {
  const { db } = deps;
  const s = await currentSession(db, now);
  if (!s || s.state !== 'active') return null;
  const link = await db.docLinks.get(s.assignmentId);
  const read = link ? await db.docReads.get(link.docId) : undefined;
  const a = await db.assignments.get(s.assignmentId);
  const instructions = instructionText(a?.detail);
  const own = read?.current ? studentText(read.current.text, instructions) : '';

  // When the student edits the passage a hint points to, the hint waits for a follow-up judgement instead of vanishing.
  const at = now.toISOString();
  const open = await db.hints.where('assignmentId').equals(s.assignmentId).filter((h) => h.state === 'shown' || h.state === 'changed').toArray();
  for (const h of open) {
    if (h.state === 'shown' && read?.current && !normalize(own).includes(normalize(h.quote))) await db.hints.update(h.id, { state: 'changed', settledAt: at });
    if (h.state === 'changed' && now.getTime() - Date.parse(h.settledAt ?? h.createdAt) > CHANGED_STALE_MS) await db.hints.update(h.id, { state: 'withdrawn' });
  }
  const stillShowing = await db.hints.where('sessionId').equals(s.id).filter((h) => h.state === 'shown').count();
  const changed = await db.hints.where('assignmentId').equals(s.assignmentId).filter((h) => h.state === 'changed').toArray();

  const settings = await deps.ai();
  const lastChange = (await db.sessionEvents.where('sessionId').equals(s.id).filter((e) => e.kind === 'doc-changed').toArray()).at(-1);
  const typingAt = await deps.typingAt();
  const edits = [lastChange ? Date.parse(lastChange.at) : null, typingAt].filter((t): t is number => t !== null);

  const check = hintEligibility({
    proactive: await deps.proactive(),
    docLinked: Boolean(link),
    readOk: read?.readState === 'ok' && Boolean(read.current),
    helpAllowed: (await workHelpDecision(db, settings, s.assignmentId)).allowed,
    writing: a ? (await storedWorkType(db, a)) === 'writing' : false,
    lastEditAt: edits.length ? Math.max(...edits) : null,
    lastHintAt: s.lastHintAt ? Date.parse(s.lastHintAt) : null,
    hintShowing: stillShowing > 0,
    studentWords: wordCount(own),
    currentHash: read?.current?.hash ?? '',
    lastEval: s.lastHintEval ?? null,
    paragraphDone: read?.current ? finishedParagraph(addedLines(read, instructions)) : false,
    changedHints: changed.length > 0,
    now: now.getTime(),
  });
  if (!check.eligible || !read?.current || !a) return null;

  // Record the evaluation first so the loop never sends the same evidence twice.
  const hash = read.current.hash;
  await db.sessions.update(s.id, { lastHintEval: { hash, studentWords: wordCount(own), at: now.toISOString() } });

  const dismissed = new Set((await db.studentContext.get(s.assignmentId))?.dismissedHintIssues ?? []);
  const requirements = requirementList(a, await db.analyses.get(a.id)).map((r, index) => ({ index, text: r.text.slice(0, 1_000) }));
  const earlier = (await db.hints.where('assignmentId').equals(s.assignmentId).sortBy('id'))
    .flatMap((h) => (h.state === 'withdrawn' ? [] : [{ id: h.id, hint: h.text.slice(0, 400), status: h.state === 'shown' ? ('open' as const) : h.state }]))
    .slice(-EARLIER_HINTS);
  const request: HintRequest = {
    title: a.title.slice(0, 300),
    instructions: instructions.slice(0, 12_000),
    rubric: (a.detail?.rubric ?? []).slice(0, 30).map((r) => ({ description: r.description.slice(0, 1_000), points: r.points })),
    studentWork: own.slice(0, 15_000),
    workScope: own.length > 15_000 ? 'partial' : 'full',
    recentChange: addedLines(read, instructions),
    dismissedIssues: HINT_ISSUES.filter((k) => dismissed.has(k)),
    focus: s.focus?.text ?? null,
    requirements,
    earlier,
  };

  let result: unknown = null;
  // Marked while it runs ("Reading your latest change"); a failed hint is never shown, so the wait just ends.
  const started = await startWait(db, 'hint', s.id);
  try {
    const res = await (deps.fetch ?? fetch)(`${settings.brokerOrigin}${HINT_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-loomer-client': 'extension' },
      body: JSON.stringify(request),
    });
    const envelope = brokerEnvelopeSchema.safeParse(await res.json().catch(() => null));
    if (envelope.success && envelope.data.ok) result = envelope.data.result;
  } catch {
    await db.waits.delete(waitKey('hint', s.id));
    return null;
  }
  if (result === null) await db.waits.delete(waitKey('hint', s.id));
  else await endWait(db, 'hint', s.id, started, null);
  const parsed = hintResponseSchema.safeParse(result);
  if (!parsed.success) return null;

  // Discard if the draft, session, or permission changed while waiting.
  const fresh = await currentSession(db, now);
  const freshRead = link ? await db.docReads.get(link.docId) : undefined;
  if (fresh?.id !== s.id || fresh.state !== 'active' || freshRead?.current?.hash !== hash) return null;
  if (!(await workHelpDecision(db, await deps.ai(), s.assignmentId)).allowed) return null;

  // Follow-ups: an edited passage that now addresses its hint "looks handled"; otherwise the hint is let go.
  const changedIds = new Set(changed.map((h) => h.id));
  for (const f of parsed.data.followUps) {
    if (changedIds.has(f.id)) await db.hints.update(f.id, { state: f.handled ? 'handled' : 'withdrawn', settledAt: at });
  }

  if (!parsed.data.useful) return null;
  const { hint, quote, issueKey, requirementIndex } = parsed.data;
  if (dismissed.has(issueKey) || quote.trim().length < 4 || !normalize(own).includes(normalize(quote))) return null;
  const requirement = requirementIndex !== null ? requirements[requirementIndex]?.text : undefined;
  const id = await db.hints.add({ sessionId: s.id, assignmentId: s.assignmentId, text: hint.slice(0, 400), quote, issueKey, docHash: hash, createdAt: at, state: 'shown', requirement });
  await db.sessions.update(s.id, { lastHintAt: at });
  return id;
}

/** Dismissal is remembered per assignment by issue type, so rewording cannot bring it back. */
export async function dismissHint(db: LoomerDb, id: number) {
  const h = await db.hints.get(id);
  if (!h) return;
  await db.hints.update(id, { state: 'dismissed' });
  const ctx = await db.studentContext.get(h.assignmentId);
  const issues = new Set(ctx?.dismissedHintIssues ?? []);
  issues.add(h.issueKey);
  await db.studentContext.put({ ...ctx, key: h.assignmentId, dismissedHintIssues: [...issues] });
}

