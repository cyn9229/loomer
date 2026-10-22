// One focus for a writing session ("Build the comparison between your two
// sources"), picked once near the start from the requirements, the draft so
// far, and the last session's focus. Hints prefer to serve it, and the resume
// briefing carries it, so sessions build on each other. Needs work help.
import { endWait, startWait } from '../core/waits';
import { brokerEnvelopeSchema, FOCUS_ROUTE, focusResponseSchema, type FocusRequest } from '../../../shared/ai-contract';
import { studentText } from '../adapters/docs/reader';
import { instructionText, type Assignment, type LoomerDb } from '../core/db';
import type { AiSettings } from '../core/settings';
import { storedWorkType } from '../analysis/workType';
import { workHelpDecision } from './help';
import { requirementList } from './requirements';
import { currentSession } from './session';

/** With a linked draft, wait this long for its first read before picking a focus without it. */
const FIRST_READ_WAIT_MS = 60_000;

/** Shown where the focus would be. Picking a focus never retries, so there is no Try again. */
const NO_FOCUS = { text: "Loomer couldn't pick a focus for this session, so hints work without one.", retry: false };

export type FocusDeps = { db: LoomerDb; ai: () => Promise<AiSettings>; fetch?: typeof fetch };

/** Picks the active writing session's focus once. Stores null when none could be picked, so it never retries in a loop. */
export async function focusStep({ db, ai, fetch: fetchImpl = fetch }: FocusDeps, now: Date): Promise<void> {
  const s = await currentSession(db, now);
  if (!s || s.state !== 'active' || s.focus !== undefined) return;
  const a = await db.assignments.get(s.assignmentId);
  if (!a || (await storedWorkType(db, a)) !== 'writing') return;
  const settings = await ai();
  if (!(await workHelpDecision(db, settings, a.id)).allowed) return;

  const link = await db.docLinks.get(a.id);
  const read = link ? (await db.docReads.get(link.docId))?.current : undefined;
  if (link && !read && now.getTime() - Date.parse(s.startedAt) < FIRST_READ_WAIT_MS) return;

  const packet = await db.resumePackets.get(a.id);
  const { request, requirements } = await focusRequest(db, a, packet?.focus ? { focus: packet.focus, handledHints: packet.handledHints ?? 0 } : null);
  // Claim it first, so a slow reply never starts a second request.
  await db.sessions.update(s.id, { focus: null });

  const started = await startWait(db, 'focus', s.id);
  try {
    const picked = await fetchFocus(settings, request, fetchImpl);
    await endWait(db, 'focus', s.id, started, picked ? null : NO_FOCUS);
    if (!picked) return;
    // Permission or the session may have changed while waiting.
    const fresh = await currentSession(db, now);
    if (fresh?.id !== s.id || !(await workHelpDecision(db, await ai(), a.id)).allowed) return;
    const { focus, why, requirementIndex } = picked;
    await db.sessions.update(s.id, {
      focus: { text: focus.trim().slice(0, 100), why: why.trim().slice(0, 240), requirement: requirementIndex !== null ? (requirements[requirementIndex]?.text ?? null) : null, at: now.toISOString() },
    });
  } catch {
    // The focus stays null; hints still work without one.
    await endWait(db, 'focus', s.id, started, NO_FOCUS);
  }
}

/** The focus request for one assignment: its instructions, requirements, the student's own text, and the focus before this one. */
export async function focusRequest(db: LoomerDb, a: Assignment, previous: FocusRequest['previous']) {
  const link = await db.docLinks.get(a.id);
  const read = link ? (await db.docReads.get(link.docId))?.current : undefined;
  const instructions = instructionText(a.detail);
  const own = read ? studentText(read.text, instructions) : '';
  const requirements = requirementList(a, await db.analyses.get(a.id)).map((r, index) => ({ index, text: r.text.slice(0, 1_000) }));
  const request: FocusRequest = {
    title: a.title.slice(0, 300),
    instructions: instructions.slice(0, 12_000),
    requirements,
    studentWork: own.slice(0, 15_000),
    workScope: !read ? 'none' : own.length > 15_000 ? 'partial' : 'full',
    previous: previous ? { focus: previous.focus.slice(0, 200), handledHints: previous.handledHints } : null,
  };
  return { request, requirements };
}

/** Asks the broker for one focus. Null when the reply is missing or empty. */
export async function fetchFocus(settings: AiSettings, request: FocusRequest, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${settings.brokerOrigin}${FOCUS_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-loomer-client': 'extension' },
    body: JSON.stringify(request),
  });
  const envelope = brokerEnvelopeSchema.safeParse(await res.json().catch(() => null));
  const parsed = envelope.success && envelope.data.ok ? focusResponseSchema.safeParse(envelope.data.result) : null;
  return parsed?.success && parsed.data.focus.trim() ? parsed.data : null;
}
