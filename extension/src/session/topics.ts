// Topics on the sheet of practice or study work. The AI lists what the sheet
// covers, each topic with a quote copied from the sheet; a topic whose quote is
// not on the sheet is dropped. The student ticks topics off; Loomer never does.
// The teacher's sheet embedded in the instructions is read under the
// instructions rule, right after a Canvas check. Without one, the student's
// linked Doc is read during a session under the stricter work-help rule, since
// it may hold their answers. Never for a quiz.
import { brokerEnvelopeSchema, TOPICS_ROUTE, topicsResponseSchema, type TopicsRequest } from '../../../shared/ai-contract';
import { assignmentPolicy, courseKey, isOpen, policyAnswer } from '../analysis/facts';
import type { Assignment, LoomerDb, SheetTopicsRecord } from '../core/db';
import { checkAiDispatch } from '../core/gate';
import type { AiSettings } from '../core/settings';
import { isQuiz, storedWorkType } from '../analysis/workType';
import type { SheetTopics, TeacherSheet } from '../model/session';
import { workHelpDecision } from './help';
import { currentSession } from './session';

const MAX_SHEET_CHARS = 15_000;
const RETRY_FAILED_MS = 10 * 60 * 1000;
/** A pending read older than this was cut off (worker stopped); try again. */
const PENDING_STALE_MS = 2 * 60 * 1000;
/** The sheet's topics rarely change; an edited sheet is read again at most this often. */
const REREAD_MS = 24 * 60 * 60 * 1000;

const normalize = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
export const topicKey = (text: string) => normalize(text);

export type TopicsDeps = { db: LoomerDb; ai: () => Promise<AiSettings>; fetch?: typeof fetch };

/** Whether the sheet needs a (re)read. A linked working copy changes as the student writes, so it waits a day. */
function due(record: SheetTopicsRecord | undefined, docHash: string, now: number, rereadAfterMs: number): boolean {
  if (!record) return true;
  const age = now - Date.parse(record.createdAt);
  if (record.status === 'pending') return age > PENDING_STALE_MS;
  if (record.status === 'failed') return age > RETRY_FAILED_MS;
  return record.docHash !== docHash && age > rereadAfterMs;
}

/** Where the topics come from. The teacher's embedded sheets are instructions; a linked Doc is the student's work. */
type SheetSource = { sheets: { id: string; title: string | null; text: string }[]; hash: string; purpose: 'requirements-analysis' | 'work-help' };

/** The sheets to read for an assignment: the embedded teacher sheets first, else the linked Doc. Dexie reads only. */
async function sheetSource(db: LoomerDb, a: Assignment): Promise<SheetSource | null> {
  const embedded = (a.detail?.sheets ?? []).flatMap((s) => (s.text && s.textHash ? [{ id: s.docId, title: s.title, text: s.text, hash: s.textHash }] : []));
  if (embedded.length) return { sheets: embedded, hash: embedded.map((s) => s.hash).join('+'), purpose: 'requirements-analysis' };
  const link = await db.docLinks.get(a.id);
  const read = link ? (await db.docReads.get(link.docId))?.current : undefined;
  return read && link ? { sheets: [{ id: link.docId, title: null, text: read.text }], hash: read.hash, purpose: 'work-help' } : null;
}

/** Splits the character budget across sheets so every sheet is sent. */
function bounded(sheets: SheetSource['sheets']): SheetSource['sheets'] {
  const each = Math.floor(MAX_SHEET_CHARS / sheets.length);
  return sheets.map((s) => ({ id: s.id, title: s.title, text: s.text.slice(0, each) }));
}

/** AI may read this sheet now: never for a quiz; instructions rule for the teacher's sheet, work-help rule for the student's Doc. */
async function allowed(db: LoomerDb, settings: AiSettings, a: Assignment, purpose: SheetSource['purpose']): Promise<boolean> {
  if (isQuiz(a)) return false;
  if (purpose === 'work-help') return (await workHelpDecision(db, settings, a.id)).allowed;
  const context = (await db.studentContext.bulkGet([a.id, courseKey(a)])).filter((c) => c !== undefined);
  const answer = policyAnswer(a, new Map(context.map((c) => [c.key, c])));
  return checkAiDispatch({ aiEnabled: settings.enabled, policy: assignmentPolicy(a, await db.courses.get(courseKey(a))), answer, purpose }).allowed;
}

/** Lists the topics of one sheet if they are missing or old. Skips writing work and anything AI may not read. */
async function readTopics({ db, ai, fetch: fetchImpl = fetch }: TopicsDeps, a: Assignment, now: Date): Promise<void> {
  const type = await storedWorkType(db, a);
  if (type !== 'practice' && type !== 'study') return;
  const source = await sheetSource(db, a);
  if (!source) return;
  const rereadAfter = source.purpose === 'work-help' ? REREAD_MS : 0;
  if (!due(await db.sheetTopics.get(a.id), source.hash, now.getTime(), rereadAfter)) return;
  const settings = await ai();
  if (!(await allowed(db, settings, a, source.purpose))) return;

  const base = { assignmentId: a.id, docHash: source.hash, createdAt: now.toISOString() };
  await db.sheetTopics.put({ ...base, status: 'pending' });
  const sent = bounded(source.sheets);
  const request: TopicsRequest = { title: a.title.slice(0, 300), workType: type, sheets: sent.map((s) => ({ title: s.title, text: s.text })) };
  let failure = 'AI service unreachable';
  try {
    const res = await fetchImpl(`${settings.brokerOrigin}${TOPICS_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-loomer-client': 'extension' },
      body: JSON.stringify(request),
    });
    const envelope = brokerEnvelopeSchema.safeParse(await res.json().catch(() => null));
    const parsed = envelope.success && envelope.data.ok ? topicsResponseSchema.safeParse(envelope.data.result) : null;
    // Permission may have changed while waiting.
    if (!(await allowed(db, await ai(), a, source.purpose))) {
      await db.sheetTopics.delete(a.id);
      return;
    }
    if (parsed?.success) {
      // A topic counts only if its quote is on the sheet it names.
      const seen = new Set<string>();
      const topics = parsed.data.topics.flatMap((t) => {
        const sheet = sent[t.sheet];
        const text = t.text.trim().slice(0, 60);
        const quote = t.quote.trim().slice(0, 200);
        if (!sheet || !text || quote.length < 3 || !normalize(sheet.text).includes(normalize(quote)) || seen.has(topicKey(text))) return [];
        seen.add(topicKey(text));
        return [{ text, quote, sheetId: sheet.id }];
      });
      const ok: SheetTopicsRecord = { ...base, status: 'ok', topics };
      await db.sheetTopics.put(ok);
      return;
    }
    failure = envelope.success && !envelope.data.ok ? envelope.data.error : `AI service status ${res.status}`;
  } catch (error) {
    failure = error instanceof Error ? error.message : failure;
  }
  const failed: SheetTopicsRecord = { ...base, status: 'failed', error: failure };
  await db.sheetTopics.put(failed);
}

/** One step for the active session: topics for its practice or study sheet. */
export async function topicsStep(deps: TopicsDeps, now: Date): Promise<void> {
  const s = await currentSession(deps.db);
  if (!s || s.state !== 'active') return;
  const a = await deps.db.assignments.get(s.assignmentId);
  if (a) await readTopics(deps, a, now);
}

/** After a Canvas check: topics for open practice or study work with an embedded teacher sheet, before any session. */
export async function embeddedTopicsStep(deps: TopicsDeps, sourceKey: string, now: Date): Promise<void> {
  const withSheet = (await deps.db.assignments.where('sourceKey').equals(sourceKey).toArray()).filter((a) => isOpen(a) && (a.detail?.sheets ?? []).some((s) => s.text));
  for (const a of withSheet) await readTopics(deps, a, now);
}

/** The session's topic list. Null unless the work is practice or study with a linked sheet that Loomer has started reading. Dexie reads only. */
export async function loadSheetTopics(db: LoomerDb, assignmentId: string): Promise<SheetTopics> {
  const a = await db.assignments.get(assignmentId);
  if (!a || !((a.detail?.sheets ?? []).some((s) => s.text) || (await db.docLinks.get(assignmentId)))) return null;
  const type = await storedWorkType(db, a);
  if (type !== 'practice' && type !== 'study') return null;
  const [record, ctx] = await Promise.all([db.sheetTopics.get(assignmentId), db.studentContext.get(assignmentId)]);
  const done = new Set(ctx?.topicsDone ?? []);
  // No record yet means no read has started (AI off, help not allowed, or a quiz): show nothing rather than "reading".
  if (!record) return null;
  if (record.status === 'pending') return { status: 'reading', items: [] };
  if (record.status === 'failed') return { status: 'failed', items: [] };
  const titles = new Map((a.detail?.sheets ?? []).map((s) => [s.docId, s.title]));
  return { status: 'ok', items: record.topics.map((t) => ({ text: t.text, quote: t.quote, done: done.has(topicKey(t.text)), sheet: titles.get(t.sheetId) ?? null })) };
}

/** The teacher's embedded sheets, named, with how many topics each has. Dexie reads only. */
export async function loadTeacherSheets(db: LoomerDb, a: Assignment): Promise<TeacherSheet[]> {
  const sheets = a.detail?.sheets ?? [];
  if (sheets.length === 0) return [];
  const record = await db.sheetTopics.get(a.id);
  const counts = new Map<string, number>();
  if (record?.status === 'ok') for (const t of record.topics) counts.set(t.sheetId, (counts.get(t.sheetId) ?? 0) + 1);
  return sheets.map((s) => ({
    docId: s.docId,
    url: s.docId.startsWith('e/') ? `https://docs.google.com/document/d/${s.docId}/pub` : `https://docs.google.com/document/d/${s.docId}/edit`,
    title: s.title,
    state: s.state,
    topics: record?.status === 'ok' ? (counts.get(s.docId) ?? 0) : null,
  }));
}

/** The student ticks or unticks a topic. Stored as their own context; never sent anywhere. */
export async function setTopicDone(db: LoomerDb, assignmentId: string, topic: string, done: boolean) {
  const ctx = (await db.studentContext.get(assignmentId)) ?? { key: assignmentId };
  const set = new Set(ctx.topicsDone ?? []);
  if (done) set.add(topicKey(topic));
  else set.delete(topicKey(topic));
  await db.studentContext.put({ ...ctx, topicsDone: [...set] });
}
