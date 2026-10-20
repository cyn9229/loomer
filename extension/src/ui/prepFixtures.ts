// Typed fixtures for test prep: the test's page (setup and the live plan) and
// the practice view in every question kind and state. The example is a U.S.
// History test on imperialism; every question is invented for the preview.
import type { Practice, PracticeAnswer, PracticeQuestion, TestPrep } from '../model/prep';

const TOPICS: TestPrep['topics'] = [
  { id: 't-hawaii', text: 'Hawaii', standing: 'solid', lastCheck: { correct: 3, total: 3 }, source: 'guide', new: false },
  { id: 't-war', text: 'The Spanish-American War', standing: 'solid', lastCheck: { correct: 3, total: 3 }, source: 'guide', new: false },
  { id: 't-phil', text: 'The Philippines', standing: 'solid', lastCheck: { correct: 2, total: 2 }, source: 'guide', new: false },
  { id: 't-canal', text: 'The Panama Canal', standing: 'solid', lastCheck: { correct: 2, total: 2 }, source: 'guide', new: false },
  { id: 't-africa', text: 'The Scramble for Africa', standing: 'solid', lastCheck: { correct: 3, total: 3 }, source: 'guide', new: false },
  { id: 't-china', text: 'China and the Open Door', standing: 'shaky', lastCheck: { correct: 2, total: 3 }, source: 'guide', new: false },
  { id: 't-congo', text: 'The Congo under Leopold II', standing: 'shaky', lastCheck: { correct: 1, total: 3 }, source: 'guide', new: false },
  { id: 't-latam', text: 'Latin America and the Roosevelt Corollary', standing: 'shaky', lastCheck: { correct: 1, total: 3 }, source: 'guide', new: false },
];

const day = (now: Date, offset: number) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function buildPrepFixtures(now: Date) {
  const testAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 9, 0).toISOString();
  const base: TestPrep = {
    assignmentId: 'a-test',
    testAt,
    status: 'ready',
    error: null,
    readiness: '5 of 8 topics on this test are solid, and Latin America still needs work.',
    counts: { solid: 5, shaky: 3, unchecked: 0 },
    topics: TOPICS,
    formats: { selected: ['mcq', 'frq', 'vocab'], found: { mcq: 'canvas', frq: 'canvas', vocab: 'guide' }, asked: false },
    plan: [
      { date: day(now, -1), kind: 'check-all', step: 'Quick check on all 8 topics', sub: 'Done, 5 solid', status: 'done' },
      { date: day(now, 0), kind: 'focus', step: '10 minutes on the Congo and Latin America', sub: 'Today', status: 'today' },
      { date: day(now, 1), kind: 'practice-test', step: 'Practice test: 10 multiple choice, 1 free response', sub: 'The day before', status: 'later' },
      { date: day(now, 2), kind: 'warm-up', step: '5-minute warm-up on your 2 weakest topics', sub: 'Morning of', status: 'later' },
    ],
    mistakes: [
      { id: 'm1', topicId: 't-congo', topic: 'The Congo', label: 'Why Leopold II’s rule drew protests', sub: 'Missed yesterday, then right' },
      { id: 'm2', topicId: 't-latam', topic: 'Latin America', label: 'What the Roosevelt Corollary added', sub: 'Missed yesterday' },
    ],
    notes: { photos: 0, found: null },
  };
  return {
    ready: base,
    setup: {
      ...base,
      status: 'setup',
      readiness: '',
      counts: { solid: 0, shaky: 0, unchecked: 8 },
      topics: TOPICS.map((t) => ({ ...t, standing: 'unchecked', lastCheck: null })),
      plan: [],
      mistakes: [],
    },
    'setup-notes': {
      ...base,
      status: 'setup',
      readiness: '',
      counts: { solid: 0, shaky: 0, unchecked: 10 },
      topics: [
        ...TOPICS.map((t) => ({ ...t, standing: 'unchecked' as const, lastCheck: null })),
        { id: 'n1', text: 'The Boxer Rebellion', standing: 'unchecked', lastCheck: null, source: 'notes', new: true },
        { id: 'n2', text: 'Dollar diplomacy', standing: 'unchecked', lastCheck: null, source: 'notes', new: true },
      ],
      plan: [],
      mistakes: [],
      notes: { photos: 3, found: 'From your notes, Loomer found 2 more topics and 7 key terms.' },
    },
    'setup-format': {
      ...base,
      status: 'setup',
      readiness: '',
      topics: TOPICS.map((t) => ({ ...t, standing: 'unchecked', lastCheck: null })),
      formats: { selected: [], found: {}, asked: false },
      plan: [],
      mistakes: [],
    },
  } satisfies Record<string, TestPrep>;
}

export type PrepFixtureName = keyof ReturnType<typeof buildPrepFixtures>;

const MCQ: PracticeQuestion = {
  id: 'q-mcq',
  topic: 'Latin America and the Roosevelt Corollary',
  kind: 'mcq',
  prompt: 'What did the Roosevelt Corollary add to the Monroe Doctrine?',
  options: ['It closed Latin American ports to European ships', 'It let the United States step in to keep order in Latin American countries', 'It made Cuba a U.S. state', 'It ended U.S. trade with Latin America'],
  term: null,
  definition: null,
  like: false,
};
const CONGO: PracticeQuestion = {
  id: 'q-congo',
  topic: 'The Congo under Leopold II',
  kind: 'mcq',
  prompt: 'Why did Leopold II’s rule of the Congo draw protests from other countries?',
  options: ['He banned all missionaries', 'Reports exposed forced labor and brutal punishments for missed rubber quotas', 'He sold the Congo to Britain', 'He freed the Congo too quickly'],
  term: null,
  definition: null,
  like: false,
};
const SHORT: PracticeQuestion = { id: 'q-short', topic: 'The Panama Canal', kind: 'short', prompt: 'In one or two sentences, why did the United States want a canal across Panama?', options: [], term: null, definition: null, like: false };
const FRQ: PracticeQuestion = { id: 'q-frq', topic: 'Hawaii and the Congo', kind: 'frq', prompt: 'Compare how the United States took control of Hawaii with how Belgium ruled the Congo.', options: [], term: null, definition: null, like: false };
const VOCAB: PracticeQuestion = {
  id: 'q-vocab',
  topic: 'Key terms',
  kind: 'vocab',
  prompt: 'Say what it means, then flip.',
  options: [],
  term: 'Roosevelt Corollary',
  definition: 'Theodore Roosevelt’s 1904 addition to the Monroe Doctrine: the United States could step in to keep order in Latin American countries, so Europe wouldn’t.',
  like: false,
};
const EXPLAIN: PracticeQuestion = { id: 'q-explain', topic: 'China and the Open Door', kind: 'explain', prompt: 'Explain the Open Door Policy in your own words, like you’re telling a friend.', options: [], term: null, definition: null, like: false };
const MATH: PracticeQuestion = { id: 'q-math', topic: 'Solving quadratics', kind: 'math', prompt: 'Solve for x: 2x² − 8 = 0', options: [], term: null, definition: null, like: false };

const practice = (question: PracticeQuestion | null, answer: PracticeAnswer | null, index = 3, extra: Partial<Practice> = {}): Practice => ({
  id: 'p1',
  assignmentId: 'a-test',
  title: 'Unit 5 Test',
  index,
  total: 10,
  question,
  answer,
  done: null,
  error: null,
  ...extra,
});

export function buildPracticeFixtures() {
  return {
    writing: practice(null, null, 0),
    mcq: practice(MCQ, null),
    'mcq-right': practice(MCQ, { kind: 'mcq', picked: 1, correct: 1, right: true, why: 'Right. Roosevelt said the United States could act as an “international police power” so European countries had no reason to step in.' }),
    'mcq-wrong': practice(CONGO, { kind: 'mcq', picked: 0, correct: 1, right: false, why: 'Not this one: missionaries were among the people who reported the abuse, which turned opinion against Leopold.' }, 1),
    'like-it': practice({ ...CONGO, id: 'q-like', prompt: 'What did the Congo Reform Association want?', options: ['More rubber from the Congo', 'An end to the abuse of Congolese workers under Leopold', 'A canal through the Congo', 'Belgian rule over Hawaii'], like: true }, null, 1),
    short: practice(SHORT, null, 4),
    'short-pending': practice(SHORT, { kind: 'short', text: 'So ships could get from the Atlantic to the Pacific faster.', status: 'pending', met: [], missing: [] }, 4),
    'short-ready': practice(SHORT, {
      kind: 'short',
      text: 'So ships could get from the Atlantic to the Pacific faster.',
      status: 'ready',
      met: [{ need: 'The main reason', quote: 'So ships could get from the Atlantic to the Pacific faster.' }],
      missing: [{ need: 'Why it mattered', hint: 'Say why a shorter route mattered, like moving the navy quickly or cheaper trade.' }],
    }, 4),
    frq: practice(FRQ, null, 9),
    'frq-ready': practice(FRQ, {
      kind: 'frq',
      text: 'Both were imperialism, but the Congo was far more violent than Hawaii. American sugar planters overthrew Queen Liliuokalani in 1893, and Hawaii was taken by a small group, while Leopold ran the whole Congo for profit. He was cruel to the people there.',
      status: 'ready',
      needs: [
        { need: 'A clear claim', met: true, note: 'Both were imperialism, but the Congo was far more violent than Hawaii.' },
        { need: 'Evidence from Hawaii', met: true, note: 'American sugar planters overthrew Queen Liliuokalani in 1893.' },
        { need: 'Evidence from the Congo', met: false, note: 'You say it was cruel, so name a fact, like the rubber quotas or the punishments that reports exposed.' },
        { need: 'The comparison', met: true, note: 'Hawaii was taken by a small group, while Leopold ran the whole Congo for profit.' },
        { need: 'Cause and effect', met: false, note: 'Say why each happened, like sugar profits in Hawaii and the demand for rubber in the Congo.' },
      ],
    }, 9),
    vocab: practice(VOCAB, null, 2, { total: 12 }),
    explain: practice(EXPLAIN, null, 5),
    'explain-ready': practice(EXPLAIN, {
      kind: 'explain',
      text: 'It was when the US said every country should get to trade with China, not just the ones that had taken parts of it.',
      status: 'ready',
      met: [{ need: 'The core idea', quote: 'every country should get to trade with China' }],
      missing: [
        { need: 'Who proposed it', hint: 'Secretary of State John Hay, in 1899.' },
        { need: 'Its aim', hint: 'It was meant to keep China from being split up among other powers.' },
      ],
    }, 5),
    math: practice(MATH, null, 1, { title: 'Quiz 6.2', total: 8 }),
    'math-wrong': practice(MATH, {
      kind: 'math',
      text: 'x = 4',
      right: false,
      answer: 'x = 2 or x = −2',
      why: 'Not quite: 2 · 4² − 8 is 24, not 0. Here is one like it, worked out.',
      worked: { problem: '3x² − 27 = 0', steps: ['Add 27 to both sides: 3x² = 27', 'Divide by 3: x² = 9', 'Take both square roots: x = 3 or x = −3'] },
    }, 1, { title: 'Quiz 6.2', total: 8 }),
    done: practice(null, null, 10, {
      done: {
        line: 'You did 10 minutes on the Congo and Latin America.',
        detail: 'The Congo is solid now, and Latin America still needs one more round before Friday.',
        topics: [
          { text: 'The Congo under Leopold II', standing: 'solid', lastCheck: { correct: 3, total: 3 } },
          { text: 'Latin America and the Roosevelt Corollary', standing: 'shaky', lastCheck: { correct: 2, total: 4 } },
        ],
        mistakes: 2,
      },
    }),
    failed: practice(null, null, 0, { error: 'Loomer couldn’t write questions just now, so try again in a minute.' }),
  } satisfies Record<string, Practice>;
}

export type PracticeFixtureName = keyof ReturnType<typeof buildPracticeFixtures>;
