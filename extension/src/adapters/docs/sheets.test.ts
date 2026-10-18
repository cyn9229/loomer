import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { instructionText, LoomerDb, type Assignment } from '../../core/db';
import type { GateState } from '../../core/gate';
import { extractHtml } from '../../core/html';
import { embeddedDocId } from './reader';
import { readEmbeddedSheets } from './sheets';

const DOC = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ';
const now = new Date('2026-10-18T15:00:00Z');
const gate: GateState = { paused: false, exclusions: [], grants: [{ purpose: 'linked-instructions', origin: 'https://docs.google.com', pathPrefix: `/document/d/${DOC}/`, version: 1 }] };
/** A Docs export reply; Response.url is read-only, so it is defined on the instance. */
const text = (body: string, status = 200) => async () => {
  const res = new Response(body, { status, headers: { 'content-type': 'text/plain' } });
  Object.defineProperty(res, 'url', { value: `https://docs.google.com/document/d/${DOC}/export?format=txt` });
  return res;
};

const assignment: Assignment = {
  id: 'k#assignment:3',
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: '3',
  courseId: '1',
  courseName: 'Precalculus',
  title: 'Unit 2 review',
  url: null,
  dueAt: null,
  pointsPossible: null,
  submission: null,
  firstSeenAt: '',
  lastSeenAt: '',
  presence: 'seen-in-last-check',
  detail: { observedAt: '', hash: 'h0', text: 'Do the review sheet below.', links: [], rubric: [], submissionTypes: ['on_paper'], canvasUpdatedAt: null, embeddedDocs: [DOC] },
  detailError: null,
};

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.put(assignment);
});

describe('embedded sheets', () => {
  it('finds a Google Doc embedded in the instructions', () => {
    const html = `<p>Do the review sheet.</p><iframe src="https://docs.google.com/document/d/${DOC}/preview?embedded=true"></iframe>`;
    expect(extractHtml(html, 'https://s.test').embeds).toEqual([`https://docs.google.com/document/d/${DOC}/preview?embedded=true`]);
  });

  it('recognizes plain, published, and Canvas-tool embeds', () => {
    expect(embeddedDocId(`https://docs.google.com/document/d/${DOC}/preview`)).toBe(DOC);
    expect(embeddedDocId(`https://docs.google.com/document/d/e/2PACX-${DOC}/pub?embedded=true`)).toBe(`e/2PACX-${DOC}`);
    const tool = `https://school.instructure.com/courses/1/external_tools/retrieve?display=borderless&url=${encodeURIComponent(`https://docs.google.com/document/d/${DOC}/edit?usp=drive_web`)}`;
    expect(embeddedDocId(tool)).toBe(DOC);
    expect(embeddedDocId('https://www.youtube.com/embed/abc')).toBeNull();
  });

  it('reads a published sheet from its public page', async () => {
    const id = `e/2PACX-${DOC}`;
    await db.assignments.put({ ...assignment, detail: { ...assignment.detail!, embeddedDocs: [id] } });
    const published: GateState = { ...gate, grants: [{ purpose: 'linked-instructions', origin: 'https://docs.google.com', pathPrefix: `/document/d/${id}/`, version: 1 }] };
    const page = async () => {
      const res = new Response('<html><body><h1>Part A: Circles</h1><p>1. Find the radius.</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
      Object.defineProperty(res, 'url', { value: `https://docs.google.com/document/d/${id}/pub` });
      return res;
    };
    await readEmbeddedSheets(db, published, 'k', now, { docsAccess: true, fetch: page });
    expect((await db.assignments.get(assignment.id))?.detail?.sheet).toMatchObject({ state: 'ok', text: expect.stringContaining('Part A: Circles') });
  });

  it('reads the sheet into the instructions, changes the hash, and keeps the text when a later read fails', async () => {
    await readEmbeddedSheets(db, gate, 'k', now, { docsAccess: true, fetch: text('Part A: Circles\n1. Find the radius.') });
    const read = (await db.assignments.get(assignment.id))!;
    expect(read.detail?.sheet).toMatchObject({ docId: DOC, state: 'ok' });
    expect(read.detail?.hash).not.toBe('h0');
    expect(instructionText(read.detail)).toContain('Part A: Circles');

    const later = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    await readEmbeddedSheets(db, gate, 'k', later, { docsAccess: true, fetch: text('slow down', 429) });
    const after = (await db.assignments.get(assignment.id))!;
    expect(after.detail?.sheet).toMatchObject({ state: 'rate-limited', text: 'Part A: Circles\n1. Find the radius.' });
    expect(after.detail?.hash).toBe(read.detail?.hash);
  });

  it('never fetches without Docs access, and reads as soon as access is granted', async () => {
    let fetched = 0;
    const counting = async () => {
      fetched += 1;
      return text('Part A')();
    };
    await readEmbeddedSheets(db, gate, 'k', now, { docsAccess: false, fetch: counting });
    expect((await db.assignments.get(assignment.id))?.detail?.sheet?.state).toBe('needs-permission');
    expect(fetched).toBe(0);
    await readEmbeddedSheets(db, gate, 'k', new Date(now.getTime() + 60_000), { docsAccess: true, fetch: counting });
    expect((await db.assignments.get(assignment.id))?.detail?.sheet?.state).toBe('ok');
  });
});
