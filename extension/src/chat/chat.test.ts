import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment } from '../core/db';
import { sendChat, type ChatDeps } from './engine';
import { cleanSvg } from './sanitize';
import { runTool, type ToolSettings } from './tools';

const now = new Date('2026-10-17T12:00:00Z');
const settings: ToolSettings = { connected: true, ai: { enabled: true, brokerOrigin: 'http://127.0.0.1:8787' }, choice: null, snapshot: null, levelMinutes: { some: 120, little: 30 } };

const assignment = (id: string, text: string): Assignment => ({
  id,
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: id,
  courseId: '1',
  courseName: 'English',
  title: `Title ${id}`,
  url: null,
  dueAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
  pointsPossible: null,
  submission: null,
  firstSeenAt: '',
  lastSeenAt: '',
  presence: 'seen-in-last-check',
  detail: { observedAt: '', hash: `h-${id}`, text, links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
});

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.bulkPut([assignment('open', 'Compare two sources.'), assignment('banned', 'Do not use AI for any part of this assignment.')]);
  await db.runs.add({
    sourceKey: 'k',
    origin: 'https://s.test',
    startedAt: now.toISOString(),
    finishedAt: new Date(now.getTime() - 60_000).toISOString(),
    outcome: 'ok',
    coverage: { courses: 1, plannerItems: 2, plannerTruncated: false, undatedCoursesChecked: 1, detailsFetched: 2, detailFailures: 0 },
    error: null,
  });
});

describe('cleanSvg', () => {
  it('strips scripts, handlers, and outside links, and rejects non-SVG', () => {
    const out = cleanSvg('<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><a href="https://evil.test"><rect/></a><use href="#a"/></svg>');
    expect(out).toBe('<svg viewBox="0 0 10 10"><a><rect/></a><use href="#a"/></svg>');
    expect(cleanSvg('<div>hi</div>')).toBeNull();
    expect(cleanSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).not.toMatch(/javascript/);
    const sneaky = cleanSvg('<svg><style>@import "https://evil.test/x.css";</style><a><set attributeName="href" to="https://evil.test"/><text>t</text></a></svg>');
    expect(sneaky).not.toMatch(/evil\.test/);
  });
});

describe('runTool', () => {
  it('never shares the content of an assignment whose teacher bans AI', async () => {
    const r = await runTool(db, settings, 'get_assignment', JSON.stringify({ assignment_id: 'banned' }), now);
    expect(JSON.parse(r.forModel)).toMatchObject({ blocked: true });
    expect(r.forModel).not.toContain('instructions');
  });

  it('withholds instructions when the AI policy is unclear', async () => {
    await db.assignments.put(assignment('unclear', 'We will discuss AI in class.'));
    const r = JSON.parse((await runTool(db, settings, 'get_assignment', JSON.stringify({ assignment_id: 'unclear' }), now)).forModel) as Record<string, unknown>;
    expect(r).toMatchObject({ paused: true });
    expect(r.instructions).toBeUndefined();
  });

  it('validates visuals and quizzes before showing them', async () => {
    const chart = await runTool(db, settings, 'show_visual', JSON.stringify({ type: 'chart', title: 't', svg: null, html: null, height: null, chart: { kind: 'bar', labels: ['a', 'b'], series: [{ name: 's', values: [1] }], x_label: null, y_label: null } }), now);
    expect(chart.block).toBeUndefined();
    const quiz = await runTool(
      db,
      settings,
      'quiz_me',
      JSON.stringify({ concept: 'albedo', questions: [{ prompt: 'q1', choices: ['a', 'b'], answer_index: 1, explanation: 'e' }, { prompt: 'q2', choices: ['a', 'b'], answer_index: 4, explanation: 'e' }] }),
      now,
    );
    expect(quiz.block?.kind === 'quiz' && quiz.block.quiz.questions.map((q) => q.prompt)).toEqual(['q1']);
    expect((await runTool(db, settings, 'delete_everything', '{}', now)).block).toBeUndefined();
  });

  it('lists only open work for the week, with start-by dates and the AI rule', async () => {
    const r = JSON.parse((await runTool(db, settings, 'list_work', '{"range":"week"}', now)).forModel) as { items: { id: string; ai_help: string; start_by: string | null }[] };
    expect(r.items.map((i) => [i.id, i.ai_help])).toEqual(
      expect.arrayContaining([
        ['open', 'allowed'],
        ['banned', 'off (teacher rule)'],
      ]),
    );
    expect(r.items.every((i) => i.start_by)).toBe(true);
  });
});

/** A fake broker that streams scripted rounds of NDJSON events. */
function broker(rounds: object[][]): typeof fetch & { calls: unknown[] } {
  const calls: unknown[] = [];
  const f = async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    const events = rounds[calls.length - 1] ?? [{ type: 'done' }];
    return new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  };
  return Object.assign(f, { calls });
}

const deps = (fetch: typeof globalThis.fetch, enabled = true): ChatDeps => ({
  db,
  ai: async () => ({ enabled, brokerOrigin: 'http://127.0.0.1:8787' }),
  settings: async () => settings,
  fetch,
  now: () => now,
});

describe('sendChat', () => {
  it('sends attachments with their message only, keeps the files whole, and shows a short view', async () => {
    const f = broker([[{ type: 'text', delta: 'I see it.' }, { type: 'done' }], [{ type: 'text', delta: 'Sure.' }, { type: 'done' }]]);
    const image = { kind: 'image' as const, name: 'ch10.jpg', dataUrl: 'data:image/jpeg;base64,AAAA', width: 1200, height: 800, thumb: 'data:image/jpeg;base64,BB' };
    const pdf = { kind: 'pdf' as const, name: 'rubric.pdf', dataUrl: 'data:application/pdf;base64,CCCC', bytes: 2_500_000 };
    const notes = { kind: 'text' as const, name: 'notes.md', text: 'Victor flees.', truncated: false };
    await sendChat(deps(f), 'general', '', { attachments: [image, pdf, notes] });
    expect(await db.chatFiles.count()).toBe(3);
    const [student] = await db.chatTurns.toArray();
    expect(student!.blocks).toEqual([
      { kind: 'attachment', fileId: expect.any(Number), file: { kind: 'image', name: 'ch10.jpg', thumb: image.thumb, detail: '1200 × 800' } },
      { kind: 'attachment', fileId: expect.any(Number), file: { kind: 'pdf', name: 'rubric.pdf', thumb: null, detail: '2.4 MB' } },
      { kind: 'attachment', fileId: expect.any(Number), file: { kind: 'text', name: 'notes.md', thumb: null, detail: '13 characters' } },
    ]);
    type Sent = { messages: { role: string; content: unknown }[] };
    const first = (f.calls[0] as Sent).messages.at(-1)!.content as { type: string }[];
    expect(first.map((p) => p.type)).toEqual(['text', 'image_url', 'file', 'text']);
    // The next message carries only a short note about earlier attachments.
    await sendChat(deps(f), 'general', 'And the rubric?');
    const history = JSON.stringify((f.calls[1] as Sent).messages);
    expect(history).toContain('[Attached a PDF: rubric.pdf]');
    expect(history).not.toContain('CCCC');
  });

  it('streams text, runs a tool between rounds, and stores the visual in order', async () => {
    const svg = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>';
    const f = broker([
      [{ type: 'text', delta: 'Here is ' }, { type: 'text', delta: 'a picture.' }, { type: 'tool_call', id: 'c1', name: 'show_visual', arguments: JSON.stringify({ type: 'svg', title: 'Heat', svg, chart: null, html: null, height: null }) }, { type: 'done' }],
      [{ type: 'text', delta: 'Roads hold heat.' }, { type: 'done' }],
    ]);
    await sendChat(deps(f), 'general', 'Explain heat islands');
    const [student, loomer] = await db.chatTurns.toArray();
    expect(student).toMatchObject({ role: 'student', blocks: [{ kind: 'markdown', text: 'Explain heat islands' }] });
    expect(loomer!.status).toBe('done');
    expect(loomer!.blocks.map((b) => b.kind)).toEqual(['markdown', 'tool', 'visual', 'markdown']);
    // Round two carries the tool call and its result back to the model.
    expect(JSON.stringify(f.calls[1])).toContain('"role":"tool"');
  });

  it('sends nothing when AI is off or the assignment bans AI', async () => {
    const f = broker([]);
    await sendChat(deps(f, false), 'general', 'hi');
    await sendChat(deps(f), 'banned', 'help me');
    expect(f.calls).toHaveLength(0);
    const replies = (await db.chatTurns.toArray()).filter((t) => t.role === 'loomer');
    expect(replies.map((t) => t.status)).toEqual(['error', 'error']);
    expect(replies[1]!.blocks[0]).toMatchObject({ kind: 'markdown', text: expect.stringContaining('Your teacher turned off AI help') });
  });

  it('pauses all of Ask Loomer while a session on a quiz is open', async () => {
    await db.assignments.put({ ...assignment('quiz', 'Answer each question.'), kind: 'quiz' });
    await db.sessions.add({ sourceKey: 'k', assignmentId: 'quiz', state: 'active', startedAt: now.toISOString(), endedAt: null, lastActivityAt: now.toISOString() });
    const f = broker([]);
    await sendChat(deps(f), 'general', 'what is an ellipse?');
    expect(f.calls).toHaveLength(0);
    expect((await db.chatTurns.toArray()).at(-1)).toMatchObject({ status: 'error', blocks: [{ kind: 'markdown', text: expect.stringContaining('paused during your quiz') }] });
  });

  it('says plainly when the AI service is not running', async () => {
    const down = async () => {
      throw new TypeError('Failed to fetch');
    };
    await sendChat(deps(down), 'general', 'hi');
    const reply = (await db.chatTurns.toArray()).at(-1);
    expect(reply).toMatchObject({ status: 'error', error: expect.stringContaining("Loomer's AI isn't running") });
  });
});
