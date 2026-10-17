// Privacy controls. Blocking stops future reads; deleting saved content is a
// separate, explicit choice. Nothing here can undo processing an AI provider
// already did, and the UI must not claim it does.
import { parseDocId } from '../adapters/docs/reader';
import type { LoomerDb } from '../core/db';
import { exclusionMatches, type Exclusion } from '../core/gate';

const sameRule = (a: Exclusion, b: Exclusion) => JSON.stringify(a) === JSON.stringify(b);

/** Adds a rule (deduplicated) and optionally deletes saved pages and Doc data it covers. */
export async function addExclusion(db: LoomerDb, rules: Exclusion[], rule: Exclusion, deleteSaved: boolean): Promise<Exclusion[]> {
  const next = rules.some((r) => sameRule(r, rule)) ? rules : [...rules, rule];
  if (deleteSaved) {
    const covered = (await db.sources.toArray()).filter((s) => {
      try {
        return exclusionMatches(rule, new URL(s.url));
      } catch {
        return false;
      }
    });
    await db.sources.bulkDelete(covered.map((s) => s.id));
    // A blocked Doc's stored text goes too; the link stays so the block is visible in context.
    for (const link of await db.docLinks.toArray()) {
      if (exclusionMatches(rule, new URL(link.url))) await db.docReads.delete(link.docId);
    }
  }
  return next;
}

export function removeExclusion(rules: Exclusion[], rule: Exclusion): Exclusion[] {
  return rules.filter((r) => !sameRule(r, rule));
}

/** A page rule for a URL; a Google Doc is blocked as a whole document. */
export function pageRuleFor(url: string): Exclusion {
  const u = new URL(url);
  const docId = parseDocId(url);
  return { kind: 'page', origin: u.origin, path: docId ? `/document/d/${docId}/` : u.pathname };
}

/**
 * Deletes Loomer's data for one assignment and hides it, so the next Canvas
 * check does not bring the derived data straight back. Canvas metadata for it
 * stays only as a hidden suppression marker.
 */
export async function deleteAssignmentData(db: LoomerDb, assignmentId: string) {
  const link = await db.docLinks.get(assignmentId);
  const sessions = await db.sessions.where('assignmentId').equals(assignmentId).toArray();
  await db.transaction('rw', [db.analyses, db.chat, db.hints, db.sources, db.resumePackets, db.docLinks, db.docReads, db.sessions, db.sessionEvents, db.studentContext, db.requirementChecks], async () => {
    await db.analyses.delete(assignmentId);
    await db.requirementChecks.delete(assignmentId);
    await db.chat.where('assignmentId').equals(assignmentId).delete();
    await db.hints.where('assignmentId').equals(assignmentId).delete();
    await db.sources.where('assignmentId').equals(assignmentId).delete();
    await db.resumePackets.delete(assignmentId);
    await db.docLinks.delete(assignmentId);
    if (link) await db.docReads.delete(link.docId);
    await db.sessionEvents.where('assignmentId').equals(assignmentId).delete();
    await db.sessions.bulkDelete(sessions.map((s) => s.id));
    await db.studentContext.put({ key: assignmentId, hidden: true });
  });
}
