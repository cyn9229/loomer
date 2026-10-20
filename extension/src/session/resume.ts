// Resume packets: the one small record per assignment that says where the student
// left off. Written when a session pauses or ends; read by Home's briefing.
import { studentText } from '../adapters/docs/reader';
import { instructionText, type LoomerDb, type NextStep, type WorkSession } from '../core/db';
import { contentHash } from '../core/hash';

export async function writeResumePacket(db: LoomerDb, s: WorkSession, now: Date, nextStep?: NextStep) {
  const [events, link, assignment] = await Promise.all([
    db.sessionEvents.where('sessionId').equals(s.id).toArray(),
    db.docLinks.get(s.assignmentId),
    db.assignments.get(s.assignmentId),
  ]);
  const edits = events.filter((e) => e.kind === 'doc-changed');
  const current = link ? (await db.docReads.get(link.docId))?.current : undefined;
  const paragraphs = current ? studentText(current.text, instructionText(assignment?.detail)).split('\n').filter((p) => p.trim()) : [];
  const sources = await db.sources.where('assignmentId').equals(s.assignmentId).toArray();
  const [fresh, handledHints] = await Promise.all([db.sessions.get(s.id), db.hints.where('sessionId').equals(s.id).filter((h) => h.state === 'handled').count()]);
  const sessionSources = sources.filter((src) => src.sessionId === s.id);
  // Nothing happened and no step was kept, so there is nothing to pick up; Home's next action already covers it.
  if (edits.length === 0 && sessionSources.length === 0 && !nextStep) return;
  await db.resumePackets.put({
    assignmentId: s.assignmentId,
    sessionId: s.id,
    at: now.toISOString(),
    docId: link?.docId ?? null,
    edits: edits.length,
    wordsDelta: edits.reduce((sum, e) => sum + (e.wordsDelta ?? 0), 0),
    sourceIds: sessionSources.map((src) => src.id),
    paragraphHashes: await Promise.all(paragraphs.map((p) => contentHash(p.trim()))),
    focus: fresh?.focus?.text,
    handledHints,
    nextStep,
    dismissed: false,
  });
}
