import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment, type PrepRecord } from '../core/db';
import { dayKinds, planDays, readiness, topicStandings } from './plan';
import { answerPractice, endPractice, loadPracticeModel, loadPrep, mathRight, practiceLike, setupPrep, startPractice } from './prep';

// Tuesday Oct 20, local 9 AM; the test is Friday morning.
const now = new Date(2026, 9, 20, 9);
const test: Assignment = {
  id: 't', sourceKey: 'k', origin: 'https://s.test', replay: false, kind: 'assignment', canvasId: '1', courseId: '1', courseName: 'US History',
  title: 'Unit 5 Test: Imperialism', url: null, dueAt: new Date(2026, 9, 23, 9).toISOString(), pointsPossible: null, submission: null,
  firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), presence: 'seen-in-last-check',
  detail: { observedAt: now.toISOString(), hash: 'h', text: 'Study guide: the annexation of Hawaii, the Congo under Leopold II, and the Roosevelt Corollary. Multiple choice and one free response.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
};
const ai = async () => ({ enabled: true, brokerOrigin: 'http://127.0.0.1:8787' });

/** A fake local AI service answering each route in turn. */
function service(replies: Record<string, object[]>) {
  const calls: { route: string; body: Record<string, unknown> }[] = [];
  const f = async (url: unknown, init?: RequestInit) => {
    const route = new URL(String(url)).pathname;
    calls.push({ route, body: JSON.parse(String(init?.body)) });
    const result = replies[route]!.shift();
    return new Response(JSON.stringify({ ok: true, model: 'test', result }));
  };
  return Object.assign(f, { calls });
}

const topicsReply = {
  topics: [
    { text: 'Annexation of Hawaii', quote: 'the annexation of Hawaii' },
    { text: 'The Congo under Leopold II', quote: 'the Congo under Leopold II' },
    { text: 'Made-up topic', quote: 'not in the guide' },
  ],
  terms: [{ term: 'Roosevelt Corollary', definition: 'The US claim to police Latin America.' }],
  formats: { mcq: true, frq: true, vocab: false, short: false, math: false },
};
const mcq = (topic: string, n: number) => ({ topic, kind: 'mcq', label: `Q${n}`, prompt: `Question ${n}?`, options: ['A', 'B', 'C', 'D'], answerIndex: 1, why: 'Because B.', term: '', definition: '', answer: '', worked: null, needs: [] });

let db: LoomerDb;
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.put(test);
  await db.courses.put({ id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'US History', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null });
});

describe('plan rules', () => {
  it('plans a quick check first, focus days, a practice test the day before, and a warm-up the morning of', () => {
    expect(dayKinds(5)).toEqual(['check-all', 'focus', 'focus', 'practice-test', 'warm-up']);
    expect(dayKinds(2)).toEqual(['practice-test', 'warm-up']);
    expect(dayKinds(1)).toEqual(['warm-up']);
  });

  it('accepts math answers as numbers within rounding', () => {
    expect([mathRight('3.14', '3.14159'), mathRight(' 1,200 ', '1200'), mathRight('x=4', 'X = 4'), mathRight('5', '6')]).toEqual([true, true, true, false]);
  });
});

describe('test prep', () => {
  it('finds topics that quote the study guide, then runs a practice that updates standings and the chat', async () => {
    const f = service({ '/ai/prep-topics': [topicsReply], '/ai/practice': [{ questions: [mcq('Annexation of Hawaii', 1), mcq('The Congo under Leopold II', 2)] }] });
    await setupPrep({ db, ai, fetch: f, now: () => now }, test);
    const prep = (await loadPrep(db, test, now))!;
    expect(prep.topics.map((t) => t.text)).toEqual(['Annexation of Hawaii', 'The Congo under Leopold II']);
    expect(prep.formats.selected).toEqual(['mcq', 'frq']);
    expect(prep.plan.map((d) => [d.kind, d.status])).toEqual([['check-all', 'today'], ['focus', 'later'], ['practice-test', 'later'], ['warm-up', 'later']]);

    expect(await startPractice({ db, ai, fetch: f, now: () => now }, 't')).toBeNull();
    let practice = (await loadPracticeModel(db, now))!;
    expect(practice.question).toMatchObject({ prompt: 'Question 1?' });
    expect([...practice.question!.options].sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(JSON.stringify(practice)).not.toContain('answerIndex');

    // Options are shuffled; pick wherever "B" (the right one) landed.
    const right = practice.question!.options.indexOf('B');
    await answerPractice({ db, ai, fetch: f, now: () => now }, practice.id, practice.question!.id, { choice: right });
    practice = (await loadPracticeModel(db, now))!;
    expect(practice.answer).toEqual({ kind: 'mcq', picked: right, correct: right, right: true, why: 'Because B.' });

    await endPractice(db, practice.id, now);
    expect((await loadPracticeModel(db, now))!.done).toMatchObject({ line: 'You checked 1 topic on this test.', mistakes: 0 });
    const [line] = await db.chatTurns.where('threadKey').equals('t').toArray();
    expect(line!.blocks[0]).toMatchObject({ kind: 'practice-result' });
    const after = (await loadPrep(db, test, now))!;
    expect(after.plan[0]!.status).toBe('done');
    expect(after.readiness).toBe('1 of 2 topics on this test is solid, and The Congo under Leopold II still needs work.');
  });

  it('checks a free response against its needs, keeping only quotes from the student\'s own words, and inserts "Try one like it" next', async () => {
    const frq = { ...mcq('Annexation of Hawaii', 3), kind: 'frq', options: [], answerIndex: -1, prompt: 'Compare Hawaii and the Congo.', needs: ['A clear claim', 'Evidence from Hawaii'] };
    const f = service({
      '/ai/prep-topics': [topicsReply],
      '/ai/practice': [{ questions: [frq, mcq('Annexation of Hawaii', 4)] }, { questions: [{ ...frq, prompt: 'Compare Hawaii and the Philippines.' }] }],
      '/ai/practice-grade': [{ needs: [{ need: 'A clear claim', met: true, quote: 'both were about money', hint: '' }, { need: 'Evidence from Hawaii', met: true, quote: 'invented quote', hint: '' }] }],
    });
    const deps = { db, ai, fetch: f, now: () => now };
    await setupPrep(deps, test);
    await startPractice(deps, 't');
    const p = (await loadPracticeModel(db, now))!;
    await answerPractice(deps, p.id, p.question!.id, { text: 'I think both were about money and land.' });
    expect((await loadPracticeModel(db, now))!.answer).toEqual({
      kind: 'frq',
      status: 'ready',
      needs: [
        { need: 'A clear claim', met: true, note: 'both were about money' },
        { need: 'Evidence from Hawaii', met: true, note: '' },
      ],
    });
    await practiceLike(deps, p.id, p.question!.id);
    const next = (await loadPracticeModel(db, now))!;
    expect([next.index, next.total, next.question?.prompt, next.question?.like]).toEqual([1, 3, 'Compare Hawaii and the Philippines.', true]);
  });

  it('reads the readiness line honestly before any practice', () => {
    const prep: PrepRecord = { assignmentId: 't', startDay: '2026-10-20', status: 'ready', topics: [{ id: 'a', text: 'Hawaii', source: 'guide', new: false, removed: false }], terms: [], formats: { selected: ['mcq'], found: {}, asked: false }, notes: { photos: 0, found: null } };
    const topics = topicStandings(prep, []);
    expect(readiness(topics, [])).toBe("Loomer found 1 topic on this test and hasn't checked any yet, so start with the quick check.");
    expect(planDays(prep, test.dueAt!, topics, [], [], now).at(-1)).toMatchObject({ kind: 'warm-up', sub: 'Morning of' });
  });
});
