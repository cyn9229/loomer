import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment } from '../core/db';
import { loadChatModel } from './model';
import { runTool } from './tools';
import { capAttachments, noteThread } from './threads';

const now = new Date('2026-10-19T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const ai = { enabled: true, brokerOrigin: 'http://127.0.0.1:8787' };
const DOC = 'd'.repeat(30);

const assignment = (id: string, title: string, dueDays: number): Assignment => ({
  id,
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: id,
  courseId: '1',
  courseName: 'English',
  title,
  url: null,
  dueAt: inDays(dueDays),
  pointsPossible: null,
  submission: null,
  firstSeenAt: now.toISOString(),
  lastSeenAt: now.toISOString(),
  presence: 'seen-in-last-check',
  detail: { observedAt: now.toISOString(), hash: 'h', text: 'You may use AI to get feedback.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
});

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.courses.put({ id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'English', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null });
  await db.assignments.bulkPut([assignment('essay', 'Frankenstein essay', 3), assignment('old', 'Poem analysis', -5), assignment('quiet', 'Vocab check', 2)]);
  const say = (threadKey: string, role: 'student' | 'loomer', text: string, minutes: number) =>
    db.chatTurns.add({ threadKey, role, blocks: [{ kind: 'markdown', text }], status: 'done', createdAt: new Date(now.getTime() - minutes * 60_000).toISOString() });
  await say('old', 'student', 'Is my poem reading right?', 300);
  await say('essay', 'student', 'My thesis is that **Victor** is the real monster.', 20);
  await say('essay', 'loomer', 'Which chapter shows that best?', 19);
  await noteThread(db, 'old');
  await noteThread(db, 'essay');
});

describe('chat switcher', () => {
  it('lists General, current work (with or without messages), then past work that has messages', async () => {
    const m = await loadChatModel(db, ai, 'essay', now);
    expect(m.threads.map((t) => [t.threadKey, t.group, t.lastText])).toEqual([
      ['general', 'general', null],
      ['essay', 'current', 'Which chapter shows that best?'],
      ['quiet', 'current', null],
      ['old', 'earlier', 'Is my poem reading right?'],
    ]);
  });

  it('sets a conversation aside out of the thread and the list, and brings it back', async () => {
    const id = 'aside-1';
    await db.chatTurns.where('threadKey').equals('essay').modify({ setAsideId: id });
    await noteThread(db, 'essay');
    let m = await loadChatModel(db, ai, 'essay', now);
    expect(m.turns).toEqual([]);
    expect(m.setAside).toEqual([{ id, threadKey: 'essay', title: 'Frankenstein essay', startedAt: expect.any(String), endedAt: expect.any(String), count: 2, preview: 'Which chapter shows that best?' }]);
    expect(m.threads.find((t) => t.threadKey === 'essay')?.lastText).toBeNull();

    await db.chatTurns.filter((t) => t.setAsideId === id).modify((t) => {
      delete t.setAsideId;
    });
    await noteThread(db, 'essay');
    m = await loadChatModel(db, ai, 'essay', now);
    expect(m.turns.map((t) => t.role)).toEqual(['student', 'loomer']);
    expect(m.setAside).toEqual([]);
  });
});

describe('read_my_draft', () => {
  const settings = { connected: true, ai, choice: null, snapshot: null, levelMinutes: { some: 120, little: 30 } };

  it('returns the student\'s own text only when help is allowed and a draft is linked', async () => {
    const read = () => runTool(db, settings, 'read_my_draft', JSON.stringify({ assignment_id: 'essay' }), now);
    expect((await read()).forModel).toContain('No readable draft is linked');
    await db.docLinks.put({ assignmentId: 'essay', docId: DOC, url: 'u', linkedAt: now.toISOString() });
    await db.docReads.put({ docId: DOC, readState: 'ok', lastAttemptAt: now.toISOString(), nextReadAt: now.toISOString(), backoffMs: 0, current: { observedAt: now.toISOString(), hash: 'h', text: 'Victor abandons the Creature in chapter 5.' }, previous: null });
    expect(JSON.parse((await read()).forModel)).toMatchObject({ scope: 'full', words: 7, text: 'Victor abandons the Creature in chapter 5.' });

    await db.studentContext.put({ key: 'essay', policyAnswer: { value: 'teacher-forbids-ai', answeredAt: now.toISOString() } });
    expect((await read()).forModel).toContain('Help on this assignment is off');
  });
});

describe('stored attachments', () => {
  it('keeps the newest files up to the cap and removes the oldest, reading only dates and sizes', async () => {
    const file = (n: number, bytes: number) => ({ threadKey: 'essay', attachment: { kind: 'text' as const, name: `f${n}`, text: 'x', truncated: false }, at: new Date(now.getTime() + n * 1000).toISOString(), bytes });
    await db.chatFiles.bulkAdd([file(1, 60), file(2, 60), file(3, 60)]);
    expect(await capAttachments(db, 130)).toBe(1);
    expect((await db.chatFiles.toArray()).map((f) => f.attachment.name).sort()).toEqual(['f2', 'f3']);
  });
});
