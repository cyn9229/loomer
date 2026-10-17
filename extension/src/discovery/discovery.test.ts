import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment } from '../core/db';
import type { GateState } from '../core/gate';
import { endSession, startSession } from '../session/session';
import { DWELL_MS, evaluateForeground, type DiscoveryState } from './discovery';

const t0 = Date.parse('2026-10-17T12:00:00Z');
const gate: GateState = { paused: false, exclusions: [], grants: [] };
const assignment: Assignment = {
  id: 'k#assignment:1',
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: '1',
  courseId: '1',
  courseName: 'English',
  title: 'Urban heat islands: comparative essay',
  url: null,
  dueAt: null,
  pointsPossible: null,
  submission: null,
  firstSeenAt: '',
  lastSeenAt: '',
  presence: 'seen-in-last-check',
  detail: { observedAt: '', hash: 'h', text: 'Compare two sources on urban heat islands and tree cover. Tree cover matters.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
};
const epa = { id: 7, url: 'https://www.epa.gov/heatislands?utm_source=x', title: 'Heat Island Effect | US EPA' };

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.put(assignment);
  await startSession(db, assignment.id, new Date(t0));
});

const run = (tab: typeof epa | { id: number; url: string; title: string }, prev: DiscoveryState, now: number, enabled = true) =>
  evaluateForeground({ db, enabled, gate, ownHosts: ['docs.google.com', 's.test'], tab, prev, now });

describe('evaluateForeground', () => {
  it('suggests a matching tab only after the dwell, without the tracking parameter', async () => {
    const first = await run(epa, null, t0);
    expect(first?.suggestion).toBeNull();
    const later = await run(epa, first, t0 + DWELL_MS);
    expect(later?.suggestion).toMatchObject({ tabId: 7, url: 'https://www.epa.gov/heatislands' });
  });

  it('never classifies excluded hosts, routes, or the school and Docs hosts', async () => {
    for (const tab of [
      { id: 1, url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Urban heat islands tree cover - Gmail' },
      { id: 2, url: 'https://news.test/account/settings', title: 'Urban heat islands tree cover' },
      { id: 3, url: 'https://docs.google.com/document/d/x/edit', title: 'Urban heat islands draft' },
      { id: 4, url: 'https://s.test/courses/1', title: 'Urban heat islands' },
    ]) {
      expect((await run(tab, null, t0))?.candidate).toBeNull();
    }
  });

  it('stops when discovery is off, after a dismissal, and when the session ends', async () => {
    expect(await run(epa, null, t0, false)).toBeNull();
    const dismissed = await run(epa, { sessionId: 1, candidate: null, suggestion: null, dismissed: true }, t0 + DWELL_MS);
    expect(dismissed).toMatchObject({ dismissed: true, suggestion: null });
    await endSession(db, new Date(t0));
    expect(await run(epa, dismissed, t0 + 2 * DWELL_MS)).toBeNull();
  });

  it('does not suggest a page already saved for the assignment', async () => {
    await db.sources.add({ id: 's', assignmentId: assignment.id, sessionId: 1, url: 'https://www.epa.gov/heatislands', title: 't', capturedAt: '', excerpt: '', hash: 'x' });
    expect((await run(epa, null, t0))?.candidate).toBeNull();
  });
});
