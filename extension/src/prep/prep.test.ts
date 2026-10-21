import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LoomerDb, type Assignment, type PrepRecord } from '../core/db';
import { outcomeOf, planSessions, sessionSlots, topicStandings } from './plan';
import { strictnessFor } from './ladder';
import { answerPractice, endPractice, loadPracticeModel, loadPrep, mathRight, nextQuestion, practiceLike, setupPrep, startPractice, teachAfter } from './prep';

// Tuesday Oct 20, local 9 AM; the test is Friday morning.
const now = new Date(2026, 9, 20, 9);
const test: Assignment = {
  id: 't', sourceKey: 'k', origin: 'https://s.test', replay: false, kind: 'assignment', canvasId: '1', courseId: '1', courseName: 'US History',
  title: 'Unit 5 Test', url: null, dueAt: new Date(2026, 9, 23, 9).toISOString(), pointsPossible: null, submission: null,
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
    return new Response(JSON.stringify({ ok: true, model: 'test', result: replies[route]!.shift() }));
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
const mcq = (topic: string, n: number, skill = 'remember') => ({ topic, kind: 'mcq', skill, label: `Q${n}`, prompt: `Question ${n}?`, options: ['A', 'B', 'C', 'D'], answerIndex: 1, why: 'Because B.', term: '', definition: '', answer: '', worked: null, needs: [] });
const teachReply = {
  block: { kind: 'compare', title: 'Hawaii and the Congo', text: 'Both were taken by outsiders.', quote: 'the annexation of Hawaii', compare: { heads: ['Hawaii', 'Congo'], rows: [{ label: 'Who', a: 'US planters', b: 'Leopold II' }] }, steps: null, frame: null },
  checks: [mcq('Annexation of Hawaii', 9, 'understand')],
};

let db: LoomerDb;
const deps = (f: typeof fetch) => ({ db, ai, fetch: f, now: () => now });
beforeEach(async () => {
  db = new LoomerDb(`test-${crypto.randomUUID()}`);
  await db.assignments.put(test);
  await db.courses.put({ id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'US History', syllabus: { observedAt: '', hash: '', text: '' }, syllabusError: null });
});

describe('sessions by the time left', () => {
  it('plans a rescue, a spaced day, a short run, and a week with topics coming back', () => {
    const kinds = (start: string, end: string) => sessionSlots(start, end).map((s) => `${s.date.slice(8)} ${s.kind} ${s.when}`);
    expect(kinds('2026-10-20', '2026-10-20')).toEqual(['20 rescue now']);
    expect(kinds('2026-10-20', '2026-10-21')).toEqual(['20 diagnostic now', '20 focus next', '20 mixed-check later-today', '21 warm-up morning']);
    expect(kinds('2026-10-20', '2026-10-23')).toEqual(['20 diagnostic now', '20 focus next', '21 focus day', '22 practice-test day', '23 warm-up morning']);
    expect(kinds('2026-10-20', '2026-10-30').map((k) => k.split(' ')[1])).toEqual(['diagnostic', 'focus', 'focus', 'focus', 'focus', 'practice-test', 'review', 'warm-up']);
  });

  it('fits today to the time given, opens the evening check at 7 PM, and plans nothing late', () => {
    const prep: PrepRecord = { assignmentId: 't', startDay: '2026-10-20', status: 'ready', topics: [{ id: 'a', text: 'Hawaii', source: 'guide', new: false, removed: false }], terms: [], formats: { selected: ['mcq'], found: {}, asked: false }, notes: { photos: 0, found: null }, today: { day: '2026-10-20', minutes: 30 } };
    const tomorrow = new Date(2026, 9, 21, 9).toISOString();
    const topics = topicStandings(prep, [], [], strictnessFor(tomorrow, now));
    const plan = planSessions(prep, tomorrow, topics, [], [], now);
    expect(plan.sessions.map((s) => [s.kind, s.minutes, s.status])).toEqual([['diagnostic', 15, 'today'], ['focus', 15, 'later'], ['warm-up', 5, 'later']]);
    expect([plan.fits, plan.note?.startsWith("Loomer won't plan anything late tonight")]).toEqual(['Fits your 30 minutes', true]);
    expect(plan.sessions.map((x) => x.detail)).toEqual(['All 1 topic, 3 questions each', 'On Hawaii', 'On Hawaii']);
    const roomy = planSessions({ ...prep, today: undefined }, tomorrow, topics, [], [], now);
    expect(roomy.sessions.find((s) => s.kind === 'mixed-check')).toMatchObject({ label: 'After dinner, around 7 PM', when: 'later-today' });
    const late = planSessions({ ...prep, today: undefined }, tomorrow, topics, [], [], new Date(2026, 9, 20, 22));
    expect(late.sessions.some((s) => s.kind === 'mixed-check')).toBe(false);
  });
});

describe('diagnostic, teaching, and diagnosis', () => {
  it('tells right-and-sure from a guess, and wrong-but-sure from a gap', () => {
    expect([outcomeOf(true, 'sure'), outcomeOf(true, 'guessing'), outcomeOf(false, 'sure'), outcomeOf(false, 'guessing'), outcomeOf(true, null)]).toEqual(['solid', 'shaky', 'mixup', 'gap', 'solid']);
  });

  it('teaches a mix-up as its own step, checks it, and ends with a calm diagnosis', async () => {
    const f = service({
      '/ai/prep-topics': [topicsReply],
      '/ai/practice': [{ questions: [mcq('Annexation of Hawaii', 1), mcq('Annexation of Hawaii', 2, 'understand'), mcq('The Congo under Leopold II', 3), mcq('The Congo under Leopold II', 4, 'understand')] }],
      '/ai/teach': [teachReply],
    });
    await setupPrep(deps(f), test);
    expect(await startPractice(deps(f), 't')).toBeNull();
    expect(f.calls.at(-1)!.body).toMatchObject({ perTopic: 3, kinds: [{ kind: 'mcq', count: 6 }] });
    const answer = async (confidence: 'sure' | 'guessing', right: boolean) => {
      const p = (await loadPracticeModel(db, now))!;
      const correct = p.question!.options.indexOf('B');
      const teach = await answerPractice(deps(f), p.id, p.question!.id, { choice: right ? correct : (correct + 1) % 4, confidence });
      if (teach) await teachAfter(deps(f), p.id, p.question!.id);
      return p;
    };

    let p = await answer('sure', false);
    expect((await loadPracticeModel(db, now))!.answer).toMatchObject({ outcome: 'mixup', next: 'You were sure, and the answer was “B”, so Loomer explains this one next.' });
    await nextQuestion(db, p.id, now);
    const teach = (await loadPracticeModel(db, now))!;
    expect([teach.question, teach.teach?.kind, teach.teach?.miss?.endsWith('and the answer is “B”.'), teach.teach?.quote?.source]).toEqual([null, 'compare', true, 'Your study guide']);
    await nextQuestion(db, p.id, now);
    expect((await loadPracticeModel(db, now))!.question).toMatchObject({ prompt: 'Question 9?', like: true });

    for (const [confidence, right] of [['sure', true], ['sure', true], ['sure', true], ['guessing', true]] as const) {
      p = await answer(confidence, right);
      await nextQuestion(db, p.id, now);
    }
    const done = (await loadPracticeModel(db, now))!.done!;
    expect(done.line).toBe("Here's where you are for Friday's Unit 5 Test.");
    expect(done.diagnosis!.map((d) => [d.outcome, d.line])).toEqual([
      ['mixup', 'You were sure about a wrong answer on Annexation of Hawaii, so Loomer fixes that first.'],
      ['shaky', 'You know the facts of The Congo under Leopold II, but its causes are shaky, so Loomer starts with why it happened.'],
    ]);
    const prep = (await loadPrep(db, test, now))!;
    expect([prep.blocks.length, prep.plan[0]!.status]).toEqual([1, 'done']);
  });
});

describe('test prep', () => {
  it('finds topics that quote the study guide, and checks math answers within rounding', async () => {
    await setupPrep(deps(service({ '/ai/prep-topics': [topicsReply] })), test);
    const prep = (await loadPrep(db, test, now))!;
    expect(prep.topics.map((t) => t.text)).toEqual(['Annexation of Hawaii', 'The Congo under Leopold II']);
    expect(prep.formats.selected).toEqual(['mcq', 'frq']);
    expect([mathRight('3.14', '3.14159'), mathRight(' 1,200 ', '1200'), mathRight('x=4', 'X = 4'), mathRight('5', '6')]).toEqual([true, true, true, false]);
  });

  it('checks a free response against its needs, keeping only quotes from the student\'s own words, and inserts "Try one like it" next', async () => {
    const frq = { ...mcq('Annexation of Hawaii', 3), kind: 'frq', options: [], answerIndex: -1, prompt: 'Compare Hawaii and the Congo.', needs: ['A clear claim', 'Evidence from Hawaii'] };
    const f = service({
      '/ai/prep-topics': [topicsReply],
      '/ai/practice': [{ questions: [frq, mcq('Annexation of Hawaii', 4)] }, { questions: [{ ...frq, prompt: 'Compare Hawaii and the Philippines.' }] }],
      '/ai/practice-grade': [{ needs: [{ need: 'A clear claim', met: true, quote: 'both were about money', hint: '' }, { need: 'Evidence from Hawaii', met: true, quote: 'invented quote', hint: '' }] }],
    });
    await setupPrep(deps(f), test);
    await startPractice(deps(f), 't');
    const p = (await loadPracticeModel(db, now))!;
    await answerPractice(deps(f), p.id, p.question!.id, { text: 'I think both were about money and land.' });
    expect((await loadPracticeModel(db, now))!.answer).toEqual({
      kind: 'frq',
      text: 'I think both were about money and land.',
      status: 'ready',
      needs: [
        { need: 'A clear claim', met: true, note: 'both were about money' },
        { need: 'Evidence from Hawaii', met: true, note: '' },
      ],
    });
    await practiceLike(deps(f), p.id, p.question!.id);
    const next = (await loadPracticeModel(db, now))!;
    expect([next.index, next.total, next.question?.prompt, next.question?.like]).toEqual([1, 3, 'Compare Hawaii and the Philippines.', true]);
  });

  it('practices one mistake with a question like it on the same topic', async () => {
    const f = service({ '/ai/prep-topics': [topicsReply], '/ai/practice': [{ questions: [mcq('Annexation of Hawaii', 1)] }, { questions: [mcq('Annexation of Hawaii', 5), mcq('Annexation of Hawaii', 6)] }] });
    await setupPrep(deps(f), test);
    await startPractice(deps(f), 't');
    const p = (await loadPracticeModel(db, now))!;
    const wrong = p.question!.options.findIndex((o) => o !== 'B');
    await answerPractice(deps(f), p.id, p.question!.id, { choice: wrong, confidence: 'guessing' });
    await endPractice(db, p.id, now);
    const [mistake] = (await loadPrep(db, test, now))!.mistakes;
    expect(mistake).toMatchObject({ topic: 'Annexation of Hawaii', label: 'Q1', sub: 'Missed Tue' });
    expect(await startPractice(deps(f), 't', mistake!.id)).toBeNull();
    expect(f.calls.at(-1)!.body).toMatchObject({ topics: ['Annexation of Hawaii'], like: { kind: 'mcq', prompt: 'Question 1?' } });
    expect((await loadPracticeModel(db, now))!).toMatchObject({ mode: 'mistake', question: { prompt: 'Question 5?' } });
  });
});
