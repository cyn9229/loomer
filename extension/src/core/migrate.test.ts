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
});
