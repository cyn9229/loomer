// Reads the teacher's sheet embedded in assignment instructions (a Google Doc
// preview inside the Canvas page). The sheet is school content, read through
// the gate's linked-instructions grant with the plain-text export only. Its
// text becomes part of the instructions; a failed read keeps the last good text.
import { detailHash } from '../canvas/collect';
import { doneInCanvas, type Assignment, type EmbeddedSheet, type LoomerDb } from '../../core/db';
import type { GateState } from '../../core/gate';
import { contentHash } from '../../core/hash';
import { fetchDocText } from './reader';

const MAX_SHEET_CHARS = 15_000;
/** A good read is refreshed after this long. */
const SHEET_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** A failed or blocked read is tried again after this long. */
const RETRY_MS = 30 * 60 * 1000;
/** Sheets for work due further out are read later. */
const SHEET_HORIZON_DAYS = 21;
const DAY_MS = 86_400_000;

function due(a: Assignment, now: number, docsAccess: boolean): boolean {
  const docId = a.detail?.embeddedDocs?.[0];
  if (!docId) return false;
  const prior = a.detail?.sheet;
  if (!prior || prior.docId !== docId) return true;
  // Access was granted since the last try: read now.
  if (prior.state === 'needs-permission') return docsAccess || now - Date.parse(prior.attemptAt) > RETRY_MS;
  return now - Date.parse(prior.attemptAt) > (prior.state === 'ok' ? SHEET_MAX_AGE_MS : RETRY_MS);
}

/**
 * Reads embedded sheets for open work in the current school account. One read
 * at a time, so Google's export limit is not hit. `docsAccess`: Chrome granted
 * Docs access; without it the sheet is marked needs-permission and not fetched.
 */
export async function readEmbeddedSheets(
  db: LoomerDb,
  gate: GateState,
  sourceKey: string,
  now: Date,
  { docsAccess, fetch: fetchImpl }: { docsAccess: boolean; fetch?: typeof fetch },
): Promise<void> {
  if (gate.paused) return;
  const horizon = now.getTime() + SHEET_HORIZON_DAYS * DAY_MS;
  const candidates = (await db.assignments.where('sourceKey').equals(sourceKey).toArray()).filter(
    (a) => a.presence === 'seen-in-last-check' && !doneInCanvas(a.submission) && (!a.dueAt || Date.parse(a.dueAt) <= horizon) && due(a, now.getTime(), docsAccess),
  );
  for (const a of candidates) {
    const detail = a.detail!;
    const docId = detail.embeddedDocs![0]!;
    const prior = detail.sheet?.docId === docId ? detail.sheet : undefined;
    const keep = { text: prior?.text ?? null, textHash: prior?.textHash ?? null };
    let sheet: EmbeddedSheet;
    if (!docsAccess) {
      sheet = { docId, state: 'needs-permission', ...keep, attemptAt: now.toISOString() };
    } else {
      const r = await fetchDocText(gate, docId, fetchImpl, 'linked-instructions');
      if (r.kind === 'ok') {
        const text = r.text.slice(0, MAX_SHEET_CHARS);
        sheet = { docId, state: 'ok', text, textHash: await contentHash(text), attemptAt: now.toISOString() };
      } else {
        sheet = { docId, state: r.kind, ...keep, attemptAt: now.toISOString() };
      }
    }
    const next = { ...detail, sheet };
    await db.assignments.update(a.id, { detail: { ...next, hash: await detailHash(next) } });
  }
}
