// Keeps each chat thread's one-row summary current, and caps stored
// attachments. Called when a turn starts or finishes, never on each streamed
// save, so screens that list threads don't re-read every message while Loomer
// writes.
import type { ChatThreadRecord, LoomerDb } from '../core/db';
import { lineOf } from './lines';

/** Recomputes a thread's summary from its last turn (set-aside turns don't count). `pending`: a reply or review is being written. */
export async function noteThread(db: LoomerDb, threadKey: string, pending: ChatThreadRecord['pending'] = null): Promise<void> {
  const last = (await db.chatTurns.where('threadKey').equals(threadKey).toArray()).filter((t) => !t.setAsideId).sort((x, y) => x.id - y.id).at(-1);
  if (!last) {
    await db.chatThreads.delete(threadKey);
    return;
  }
  // A just-started reply has no text yet; keep the line from the turn before it.
  const line = lineOf(last.blocks) ?? (await db.chatThreads.get(threadKey))?.lastText ?? null;
  await db.chatThreads.put({ threadKey, lastText: line, lastAt: last.createdAt, pending });
}

/** Attachments kept on this computer, newest first, up to this total. Older ones are removed; their thumbnails stay in the chat. */
export const ATTACHMENT_CAP_BYTES = 200 * 1024 * 1024;

/** Removes the oldest stored attachments past the cap, reading only their dates and sizes. */
export async function capAttachments(db: LoomerDb, cap = ATTACHMENT_CAP_BYTES): Promise<number> {
  const index = db.chatFiles.orderBy('[at+bytes]').reverse();
  const [keys, ids] = await Promise.all([index.keys(), index.primaryKeys()]);
  let total = 0;
  const drop: number[] = [];
  keys.forEach((key, i) => {
    total += (key as unknown as [string, number])[1];
    if (total > cap) drop.push(ids[i] as number);
  });
  if (drop.length) await db.chatFiles.bulkDelete(drop);
  return drop.length;
}
