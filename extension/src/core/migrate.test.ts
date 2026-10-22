import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { LoomerDb } from './db';

it('moves old session help messages into the assignment chat thread', async () => {
  const name = `test-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(9).stores({ chat: '++id, assignmentId', chatTurns: '++id, threadKey' });
  await old.table('chat').bulkAdd([
    { assignmentId: 'a', role: 'student', kind: 'question', text: 'How do I start?', references: [], createdAt: '2026-10-18T10:00:00Z' },
    { assignmentId: 'a', role: 'loomer', kind: 'hint', text: 'Look at your first claim.', references: [{ quote: 'Victor is cruel', from: 'your draft' }], createdAt: '2026-10-18T10:00:05Z' },
  ]);
  old.close();

  const db = new LoomerDb(name);
  const turns = await db.chatTurns.where('threadKey').equals('a').sortBy('id');
  expect(turns.map((t) => [t.role, t.blocks])).toEqual([
    ['student', [{ kind: 'markdown', text: 'How do I start?' }]],
    ['loomer', [{ kind: 'markdown', text: 'Look at your first claim.\n\n> Victor is cruel' }]],
  ]);
  expect(await db.chat.count()).toBe(0);
  // The thread summary is built from the moved messages.
  expect(await db.chatThreads.get('a')).toMatchObject({ lastText: 'Look at your first claim. Victor is cruel', pending: null });
});

it('gives practices saved before sessions and teaching blocks the new fields', async () => {
  const name = `test-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(12).stores({ practices: 'id, assignmentId' });
  await old.table('practices').add({
    id: 'p1', assignmentId: 't', dayKind: 'check-all', day: '2026-10-20', createdAt: '', startedAt: '', endedAt: '', closed: true, writing: false, error: null, index: 0,
    questions: [{ id: 'q1', kind: 'mcq' }],
    answers: { q1: { kind: 'mcq', picked: 1, correct: 1, right: true, why: 'Because.' } },
  });
  old.close();

  const p = (await new LoomerDb(name).practices.get('p1'))!;
  expect([p.blocks, p.showing, p.sessionId, p.dayKind, p.questions[0]!.skill]).toEqual([[], null, null, 'diagnostic', 'remember']);
  expect(p.answers.q1).toMatchObject({ outcome: 'solid', confidence: null });
});
