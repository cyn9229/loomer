// Reads the teacher's sheets embedded in assignment instructions (Google Doc
// previews inside the Canvas page), up to MAX_SHEETS per assignment. Sheets are
// school content, read through the gate's linked-instructions grant with the
// plain-text export only. Their text becomes part of the instructions; a failed
// read keeps the last good text.
import { detailHash } from '../canvas/collect';
import { doneInCanvas, MAX_SHEETS, sheetTitle, type Assignment, type EmbeddedSheet, type LoomerDb } from '../../core/db';
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

/** Whether one sheet needs a (re)read. Access granted since the last try means now. */
function due(prior: EmbeddedSheet | undefined, now: number, docsAccess: boolean): boolean {
  if (!prior) return true;
  if (prior.state === 'needs-permission') return docsAccess || now - Date.parse(prior.attemptAt) > RETRY_MS;
  return now - Date.parse(prior.attemptAt) > (prior.state === 'ok' ? SHEET_MAX_AGE_MS : RETRY_MS);
}

const docsOf = (a: Assignment) => (a.detail?.embeddedDocs ?? []).slice(0, MAX_SHEETS);

/**
 * Reads embedded sheets for open work in the current school account. One read
 * at a time, so Google's export limit is not hit. `docsAccess`: Chrome granted
 * Docs access; without it a sheet is marked needs-permission and not fetched.
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
  const candidates = (await db.assignments.where('sourceKey').equals(sourceKey).toArray()).filter((a) => {
    if (a.presence !== 'seen-in-last-check' || doneInCanvas(a.submission) || (a.dueAt && Date.parse(a.dueAt) > horizon)) return false;
    const read = new Map((a.detail?.sheets ?? []).map((s) => [s.docId, s]));
    return docsOf(a).some((id) => due(read.get(id), now.getTime(), docsAccess));
  });
  for (const a of candidates) {
    const detail = a.detail!;
    const prior = new Map((detail.sheets ?? []).map((s) => [s.docId, s]));
    const sheets: EmbeddedSheet[] = [];
    for (const docId of docsOf(a)) {
      const old = prior.get(docId);
      if (old && !due(old, now.getTime(), docsAccess)) {
        sheets.push(old);
        continue;
      }
      const frameTitle = detail.embedTitles?.[docId];
      const keep = { text: old?.text ?? null, textHash: old?.textHash ?? null, title: old?.title ?? sheetTitle(frameTitle, null) };
      if (!docsAccess) {
        sheets.push({ docId, state: 'needs-permission', ...keep, attemptAt: now.toISOString() });
        continue;
      }
      const r = await fetchDocText(gate, docId, fetchImpl, 'linked-instructions');
      if (r.kind === 'ok') {
        const text = r.text.slice(0, MAX_SHEET_CHARS);
        sheets.push({ docId, state: 'ok', title: sheetTitle(frameTitle, text), text, textHash: await contentHash(text), attemptAt: now.toISOString() });
      } else {
        sheets.push({ docId, state: r.kind, ...keep, attemptAt: now.toISOString() });
      }
    }
    const next = { ...detail, sheets };
    await db.assignments.update(a.id, { detail: { ...next, hash: await detailHash(next) } });
  }
}
