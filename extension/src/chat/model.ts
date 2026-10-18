// Builds the ChatModel for one thread from the store. Dexie reads only.
import { courseKey } from '../analysis/facts';
import { workItemFor } from '../analysis/recommend';
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

  if (threadKey === GENERAL_THREAD) {
    return { threadKey, assignment: null, availability: ai.enabled ? 'available' : 'ai-off', turns, streaming };
  }
  const a = await db.assignments.get(threadKey);
  if (!a) return { threadKey, assignment: null, availability: 'unresolved', turns, streaming };
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
  };
}
