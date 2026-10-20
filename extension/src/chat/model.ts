// Builds the ChatModel for one thread from the store. Dexie reads only.
import { courseKey } from '../analysis/facts';
import { planChangeView, workItemFor } from '../analysis/recommend';
import type { LoomerDb } from '../core/db';
import type { AiSettings } from '../core/settings';
import { GENERAL_THREAD, type ChatModel, type ThreadKey } from '../model/chat';
import { workHelpDecision } from '../session/help';
import { availability } from '../session/model';

/** A reply still marked streaming after this long was cut off (the worker stopped). */
const STREAM_STALE_MS = 3 * 60 * 1000;

export async function loadChatModel(db: LoomerDb, ai: AiSettings, threadKey: ThreadKey, now: Date): Promise<ChatModel> {
  const records = await db.chatTurns.where('threadKey').equals(threadKey).sortBy('id');
  const turns = records.map((t) => ({
    id: t.id,
    role: t.role,
    blocks: t.blocks,
    status: t.status === 'streaming' && now.getTime() - Date.parse(t.createdAt) > STREAM_STALE_MS ? ('error' as const) : t.status,
    error: t.error,
    createdAt: t.createdAt,
  }));
  const streaming = turns.some((t) => t.status === 'streaming');
  const planChanges = Object.fromEntries((await db.planChanges.toArray()).filter((c) => c.threadKey === threadKey).map((c) => [c.id, planChangeView(c)]));
  const draftIds = turns.flatMap((t) => t.blocks.flatMap((b) => (b.kind === 'add-assignment' ? [b.draftId] : [])));
  const added = Object.fromEntries(draftIds.length ? (await db.assignments.filter((a) => a.draftId !== undefined && draftIds.includes(a.draftId)).toArray()).map((a) => [a.draftId!, a.id]) : []);

  if (threadKey === GENERAL_THREAD) {
    return { threadKey, assignment: null, availability: ai.enabled ? 'available' : 'ai-off', turns, streaming, planChanges, added };
  }
  const a = await db.assignments.get(threadKey);
  if (!a) return { threadKey, assignment: null, availability: 'unresolved', turns, streaming, planChanges, added };
  const [course, analysis, context, decision] = await Promise.all([
    db.courses.get(courseKey(a)),
    db.analyses.get(a.id),
    db.studentContext.bulkGet([a.id, courseKey(a)]),
    workHelpDecision(db, ai, a.id),
  ]);
  const contextMap = new Map(context.filter((c) => c !== undefined).map((c) => [c.key, c]));
  return {
    threadKey,
    assignment: workItemFor(a, { course, analysis, context: contextMap }, now),
    availability: availability(decision).availability,
    turns,
    streaming,
    planChanges,
    added,
  };
}
