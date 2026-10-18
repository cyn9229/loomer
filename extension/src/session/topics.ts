// Topics on the linked sheet of practice or study work. The AI lists what the
// sheet covers, each topic with a quote copied from the sheet; a topic whose
// quote is not on the sheet is dropped. The student ticks topics off; Loomer
// never does. Needs the work-help AI check, since the sheet may hold answers.
import { brokerEnvelopeSchema, TOPICS_ROUTE, topicsResponseSchema, type TopicsRequest } from '../../../shared/ai-contract';
import type { LoomerDb, SheetTopicsRecord } from '../core/db';
import type { AiSettings } from '../core/settings';
import { storedWorkType } from '../analysis/workType';
import type { SheetTopics } from '../model/session';
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

/** Whether the current sheet needs a (re)read, given the stored record. */
function due(record: SheetTopicsRecord | undefined, docHash: string, now: number): boolean {
  if (!record) return true;
  const age = now - Date.parse(record.createdAt);
  if (record.status === 'pending') return age > PENDING_STALE_MS;
  if (record.status === 'failed') return age > RETRY_FAILED_MS;
  return record.docHash !== docHash && age > REREAD_MS;
}

/** One step for the active session: reads the sheet's topics when they are missing or old. */
export async function topicsStep({ db, ai, fetch: fetchImpl = fetch }: TopicsDeps, now: Date): Promise<void> {
  const s = await currentSession(db);
  if (!s || s.state !== 'active') return;
  const a = await db.assignments.get(s.assignmentId);
  if (!a) return;
  const type = await storedWorkType(db, a);
  if (type !== 'practice' && type !== 'study') return;
  const link = await db.docLinks.get(a.id);
  const sheet = link ? (await db.docReads.get(link.docId))?.current : undefined;
  if (!sheet || !due(await db.sheetTopics.get(a.id), sheet.hash, now.getTime())) return;
  const settings = await ai();
  if (!(await workHelpDecision(db, settings, a.id)).allowed) return;

  const base = { assignmentId: a.id, docHash: sheet.hash, createdAt: now.toISOString() };
  await db.sheetTopics.put({ ...base, status: 'pending' });
  const request: TopicsRequest = { title: a.title.slice(0, 300), workType: type, sheet: sheet.text.slice(0, MAX_SHEET_CHARS) };
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
    if (!(await workHelpDecision(db, await ai(), a.id)).allowed) {
      await db.sheetTopics.delete(a.id);
      return;
    }
    if (parsed?.success) {
      const text = normalize(request.sheet);
      const seen = new Set<string>();
      const topics = parsed.data.topics
        .map((t) => ({ text: t.text.trim().slice(0, 60), quote: t.quote.trim().slice(0, 200) }))
        .filter((t) => t.text && t.quote.length >= 3 && text.includes(normalize(t.quote)) && !seen.has(topicKey(t.text)) && seen.add(topicKey(t.text)));
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

/** The session's topic list. Null unless the work is practice or study with a linked sheet that Loomer has started reading. Dexie reads only. */
export async function loadSheetTopics(db: LoomerDb, assignmentId: string): Promise<SheetTopics> {
  const a = await db.assignments.get(assignmentId);
  if (!a || !(await db.docLinks.get(assignmentId))) return null;
  const type = await storedWorkType(db, a);
  if (type !== 'practice' && type !== 'study') return null;
  const [record, ctx] = await Promise.all([db.sheetTopics.get(assignmentId), db.studentContext.get(assignmentId)]);
  const done = new Set(ctx?.topicsDone ?? []);
  // No record yet means no read has started (AI off, help not allowed, or a quiz): show nothing rather than "reading".
  if (!record) return null;
  if (record.status === 'pending') return { status: 'reading', items: [] };
  if (record.status === 'failed') return { status: 'failed', items: [] };
  return { status: 'ok', items: record.topics.map((t) => ({ ...t, done: done.has(topicKey(t.text)) })) };
}

/** The student ticks or unticks a topic. Stored as their own context; never sent anywhere. */
export async function setTopicDone(db: LoomerDb, assignmentId: string, topic: string, done: boolean) {
  const ctx = (await db.studentContext.get(assignmentId)) ?? { key: assignmentId };
  const set = new Set(ctx.topicsDone ?? []);
  if (done) set.add(topicKey(topic));
  else set.delete(topicKey(topic));
  await db.studentContext.put({ ...ctx, topicsDone: [...set] });
}
