import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb } from '../core/db';
import { checkCollect, exclusionMatches, type GateState } from '../core/gate';
import { addExclusion, deleteAssignmentData, pageRuleFor, removeExclusion } from './privacy';

const DOC = 'x'.repeat(30);
const OTHER = 'y'.repeat(30);

describe('exclusions', () => {
  it('blocks one Google Doc without blocking every Doc', () => {
    const rule = pageRuleFor(`https://docs.google.com/document/d/${DOC}/edit#heading=h.1`);
    expect(exclusionMatches(rule, new URL(`https://docs.google.com/document/d/${DOC}/export?format=txt`))).toBe(true);
    expect(exclusionMatches(rule, new URL(`https://docs.google.com/document/d/${OTHER}/export?format=txt`))).toBe(false);
  });

  it('blocks an exact page but not a longer path that merely starts with it', () => {
    const rule = pageRuleFor('https://news.test/a');
    expect(exclusionMatches(rule, new URL('https://news.test/a?x=1'))).toBe(true);
    expect(exclusionMatches(rule, new URL('https://news.test/ab'))).toBe(false);
  });

  it('stops Doc reads in the gate once the Doc is excluded', () => {
    const gate: GateState = {
      paused: false,
      exclusions: [pageRuleFor(`https://docs.google.com/document/d/${DOC}/edit`)],
      grants: [{ purpose: 'work-doc', origin: 'https://docs.google.com', pathPrefix: `/document/d/${DOC}/`, version: 1 }],
    };
    expect(checkCollect(gate, 'work-doc', `https://docs.google.com/document/d/${DOC}/export?format=txt`)).toEqual({ allowed: false, reason: 'user-exclusion' });
  });
});

let db: LoomerDb;
beforeEach(() => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
});

describe('addExclusion', () => {
  it('deduplicates, and deletes covered saved pages only when asked', async () => {
    await db.sources.bulkAdd([
      { id: '1', assignmentId: 'a', sessionId: 1, url: 'https://blog.test/post', title: 't', capturedAt: '', excerpt: 'e', hash: '1' },
      { id: '2', assignmentId: 'a', sessionId: 1, url: 'https://epa.gov/heat', title: 't', capturedAt: '', excerpt: 'e', hash: '2' },
    ]);
    const rule = { kind: 'host' as const, host: 'blog.test', includeSubdomains: false };
    const kept = await addExclusion(db, [], rule, false);
    expect(await db.sources.count()).toBe(2);
    const twice = await addExclusion(db, kept, rule, true);
    expect(twice).toHaveLength(1);
    expect((await db.sources.toArray()).map((s) => s.id)).toEqual(['2']);
    expect(removeExclusion(twice, rule)).toEqual([]);
  });
});

describe('deleteAssignmentData', () => {
  it("removes Loomer's data for one assignment, leaves others, and hides it", async () => {
    for (const id of ['a', 'b']) {
      await db.analyses.put({ assignmentId: id, detailHash: 'h', status: 'failed', createdAt: '', error: 'x' });
      await db.chat.add({ assignmentId: id, role: 'student', text: 'hi', kind: 'question', references: [], createdAt: '' });
      await db.docLinks.put({ assignmentId: id, docId: `${id}doc`, url: 'u', linkedAt: '' });
      await db.docReads.put({ docId: `${id}doc`, readState: 'ok', lastAttemptAt: null, nextReadAt: '', backoffMs: 0, current: { observedAt: '', hash: 'h', text: 'draft' }, previous: null });
    }
    await deleteAssignmentData(db, 'a');
    expect(await db.analyses.get('a')).toBeUndefined();
    expect(await db.chat.where('assignmentId').equals('a').count()).toBe(0);
    expect(await db.docReads.get('adoc')).toBeUndefined();
    expect(await db.docReads.get('bdoc')).toBeDefined();
    expect(await db.studentContext.get('a')).toEqual({ key: 'a', hidden: true });
  });
});
