// Resume packets: the one small record per assignment that says where the student
// left off. Written when a session pauses or ends; read by Home's briefing.
import { studentText } from '../adapters/docs/reader';
import type { LoomerDb, WorkSession } from '../core/db';
import { contentHash } from '../core/hash';

export async function writeResumePacket(db: LoomerDb, s: WorkSession, now: Date) {
  const [events, link, assignment] = await Promise.all([
    db.sessionEvents.where('sessionId').equals(s.id).toArray(),
    db.docLinks.get(s.assignmentId),
    db.assignments.get(s.assignmentId),
  ]);
  const edits = events.filter((e) => e.kind === 'doc-changed');
  const current = link ? (await db.docReads.get(link.docId))?.current : undefined;
  const paragraphs = current ? studentText(current.text, assignment?.detail?.text ?? '').split('\n').filter((p) => p.trim()) : [];
  const sources = await db.sources.where('assignmentId').equals(s.assignmentId).toArray();
  const sessionSources = sources.filter((src) => src.sessionId === s.id);
  // Nothing happened, so there is nothing to pick up; Home's next action already covers it.
  if (edits.length === 0 && sessionSources.length === 0) return;
  await db.resumePackets.put({
    assignmentId: s.assignmentId,
    sessionId: s.id,
    at: now.toISOString(),
    docId: link?.docId ?? null,
    edits: edits.length,
    wordsDelta: edits.reduce((sum, e) => sum + (e.wordsDelta ?? 0), 0),
    sourceIds: sessionSources.map((src) => src.id),
    paragraphHashes: await Promise.all(paragraphs.map((p) => contentHash(p.trim()))),
    dismissed: false,
  });
}
