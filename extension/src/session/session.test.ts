import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { readDocPaced, studentText } from '../adapters/docs/reader';
import { capturePage } from '../capture/capture';
import { LoomerDb, type Assignment } from '../core/db';
import type { GateState } from '../core/gate';
import { askHelp } from './help';
import { IDLE_SUSPEND_MS, closeStaleSessions, currentSession, setState, startSession, tickSession } from './session';

const DOC = 'a'.repeat(30);
const t0 = new Date('2026-10-17T12:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const gate: GateState = {
  paused: false,
  exclusions: [],
  grants: [{ purpose: 'work-doc', origin: 'https://docs.google.com', pathPrefix: `/document/d/${DOC}/`, version: 1 }],
};

/** Export responses in order; each carries the final URL the reader validates. */
function exportFetch(...replies: { status?: number; text?: string; host?: string }[]): typeof fetch & { calls: number } {
  const f = Object.assign(
    async () => {
      const r = replies[Math.min(f.calls++, replies.length - 1)]!;
      const res = new Response(r.text ?? '', { status: r.status ?? 200, headers: { 'content-type': r.status === 429 ? 'text/html' : 'text/plain' } });
      Object.defineProperty(res, 'url', { value: `https://${r.host ?? 'doc-04-10-docstext.googleusercontent.com'}/export/x` });
      return res;
    },
    { calls: 0 },
  );
  return f;
}

const assignment: Assignment = {
  id: 'k#assignment:1',
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: '1',
  courseId: '1',
  courseName: 'English',
  title: 'Essay',
  url: null,
  dueAt: null,
  pointsPossible: null,
  submission: null,
  firstSeenAt: t0.toISOString(),
  lastSeenAt: t0.toISOString(),
  presence: 'seen-in-last-check',
  detail: { observedAt: t0.toISOString(), hash: 'h', text: 'Compare the two sources on urban heat.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
};

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.put(assignment);
});

describe('paced Doc reads', () => {
  it('waits between reads and backs off after a 429 without reporting a change', async () => {
    const f = exportFetch({ text: 'one' }, { status: 429 }, { status: 429 }, { text: 'two' });
    expect((await readDocPaced(db, gate, DOC, at(0), f))?.read.readState).toBe('ok');
    expect(await readDocPaced(db, gate, DOC, at(5_000), f)).toBeNull(); // paced
    const limited = await readDocPaced(db, gate, DOC, at(15_000), f);
    expect(limited).toMatchObject({ changed: false, read: { readState: 'rate-limited', backoffMs: 30_000 } });
    expect(await readDocPaced(db, gate, DOC, at(30_000), f)).toBeNull(); // backing off
    expect((await readDocPaced(db, gate, DOC, at(45_000), f))?.read.backoffMs).toBe(60_000); // doubled
    const back = await readDocPaced(db, gate, DOC, at(105_000), f);
    expect(back).toMatchObject({ changed: true, read: { readState: 'ok', backoffMs: 0 } });
    expect(f.calls).toBe(4);
  });

  it('treats a redirect to Google sign-in as no access', async () => {
    const r = await readDocPaced(db, gate, DOC, t0, exportFetch({ host: 'accounts.google.com', text: '<html>' }));
    expect(r?.read.readState).toBe('no-access');
  });

  it('does not read a Doc that was never linked', async () => {
    const f = exportFetch({ text: 'x' });
    const r = await readDocPaced(db, gate, 'b'.repeat(30), t0, f);
    expect(r?.read.readState).toBe('unreadable');
    expect(f.calls).toBe(0);
  });

  it('counts only the student part of a Doc that also holds the instructions', () => {
    expect(studentText('Compare the two sources on urban heat.\nMy first point is shade.', assignment.detail!.text)).toBe('My first point is shade.');
  });
});

describe('session ticks', () => {
  it('records a factual edit event with the change in student words', async () => {
    await startSession(db, assignment.id, t0);
    await db.docLinks.put({ assignmentId: assignment.id, docId: DOC, url: 'u', linkedAt: t0.toISOString() });
    const f = exportFetch({ text: 'Trees cool streets.' }, { text: 'Trees cool streets. Shade lowers heat a lot.' });
    await tickSession(db, gate, at(0), undefined, f);
    await tickSession(db, gate, at(16_000), undefined, f);
    const events = await db.sessionEvents.toArray();
    expect(events.map((e) => [e.kind, e.wordsDelta])).toEqual([
      ['started', undefined],
      ['doc-changed', 5],
    ]);
  });

  it('ends a session paused over 2 hours, or since yesterday, at its pause, so the next start is fresh', async () => {
    const first = await startSession(db, assignment.id, t0);
    await setState(db, first, 'paused', at(10 * 60_000));
    // An hour later it is still open; resuming continues it.
    expect((await currentSession(db, at(70 * 60_000)))?.id).toBe(first.id);
    // Three hours later it is over, even before it is recorded.
    const later = at(3 * 60 * 60_000);
    expect(await currentSession(db, later)).toBeUndefined();
    await closeStaleSessions(db, later);
    expect(await db.sessions.get(first.id)).toMatchObject({ state: 'ended', endedAt: at(10 * 60_000).toISOString() });
    const fresh = await startSession(db, assignment.id, later);
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.startedAt).toBe(later.toISOString());
  });

  it('pauses after idle time and stops reading', async () => {
    await startSession(db, assignment.id, t0);
    const f = exportFetch({ text: 'x' });
    expect(await tickSession(db, gate, at(IDLE_SUSPEND_MS + 1), undefined, f)).toBe(false);
    expect((await currentSession(db, at(IDLE_SUSPEND_MS + 1)))?.state).toBe('paused');
    expect(f.calls).toBe(0);
  });
});

describe('capturePage', () => {
  const page = (href: string, extra: Partial<{ hasPassword: boolean; text: string }> = {}) =>
    async () => ({ href, title: 'EPA: Heat Islands', hasPassword: false, text: 'Urban areas are warmer.', ...extra });

  it('refuses without an active session and never runs the page script', async () => {
    let ran = false;
    const r = await capturePage(db, gate, { id: 1, url: 'https://epa.gov/heat' }, t0, async () => {
      ran = true;
      return undefined;
    });
    expect(r).toEqual({ ok: false, reason: 'no-session' });
    expect(ran).toBe(false);
  });

  it('saves one snapshot for the active assignment', async () => {
    await startSession(db, assignment.id, t0);
    const r = await capturePage(db, gate, { id: 1, url: 'https://epa.gov/heat' }, t0, page('https://epa.gov/heat?utm_source=x#top'));
    expect(r).toEqual({ ok: true, title: 'EPA: Heat Islands' });
    expect(await db.sources.toArray()).toMatchObject([{ assignmentId: assignment.id, url: 'https://epa.gov/heat' }]);
  });

  it('refuses excluded hosts, sign-in pages, and pages that navigated somewhere excluded', async () => {
    await startSession(db, assignment.id, t0);
    expect(await capturePage(db, gate, { id: 1, url: 'https://mail.google.com/mail/u/0' }, t0, page('https://mail.google.com/mail/u/0'))).toMatchObject({ reason: 'excluded' });
    expect(await capturePage(db, gate, { id: 1, url: 'https://news.test/a' }, t0, page('https://news.test/a', { hasPassword: true }))).toMatchObject({ reason: 'sign-in-page' });
    expect(await capturePage(db, gate, { id: 1, url: 'https://news.test/a' }, t0, page('https://news.test/account/settings'))).toMatchObject({ reason: 'excluded' });
    expect(await db.sources.count()).toBe(0);
  });
});

describe('askHelp', () => {
  it('sends nothing when AI is off and leaves a notice instead', async () => {
    const f = exportFetch({ text: 'x' });
    await askHelp({ db, ai: async () => ({ enabled: false, brokerOrigin: 'http://127.0.0.1:8787' }), fetch: f }, assignment.id, 'Help me start');
    expect(f.calls).toBe(0);
    expect((await db.chat.toArray()).map((m) => [m.role, m.kind])).toEqual([
      ['student', 'question'],
      ['loomer', 'notice'],
    ]);
  });
});
