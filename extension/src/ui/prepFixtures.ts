// Typed fixtures for test prep: the test's page (setup and the live plan) and
// the practice view in every question kind and state. The example is a U.S.
// History test on imperialism; every question is invented for the preview.
import type { Practice, PracticeAnswer, PracticeQuestion, TeachBlock, TestPrep } from '../model/prep';

const TOPICS: TestPrep['topics'] = [
  { id: 't-hawaii', text: 'Hawaii', standing: 'shaky', lastCheck: { correct: 2, total: 3 }, source: 'guide', new: false, mixup: true, progress: 0.3 },
  { id: 't-war', text: 'The Spanish-American War', standing: 'solid', lastCheck: { correct: 3, total: 3 }, source: 'guide', new: false, mixup: false, progress: 1 },
  { id: 't-phil', text: 'The Philippines', standing: 'solid', lastCheck: { correct: 2, total: 2 }, source: 'guide', new: false, mixup: false, progress: 1 },
  { id: 't-canal', text: 'The Panama Canal', standing: 'solid', lastCheck: { correct: 2, total: 2 }, source: 'guide', new: false, mixup: false, progress: 1 },
  { id: 't-africa', text: 'The Scramble for Africa', standing: 'solid', lastCheck: { correct: 3, total: 3 }, source: 'guide', new: false, mixup: false, progress: 1 },
  { id: 't-china', text: 'China and the Open Door', standing: 'shaky', lastCheck: { correct: 2, total: 3 }, source: 'guide', new: false, mixup: false, progress: 0.65 },
  { id: 't-congo', text: 'The Congo under Leopold II', standing: 'shaky', lastCheck: { correct: 1, total: 3 }, source: 'guide', new: false, mixup: false, progress: 0.4 },
  { id: 't-latam', text: 'Latin America and the Roosevelt Corollary', standing: 'shaky', lastCheck: { correct: 1, total: 3 }, source: 'guide', new: false, mixup: false, progress: 0.35 },
];

const day = (now: Date, offset: number) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function buildPrepFixtures(now: Date) {
  // The test is tomorrow at 9:00 AM, so today is planned in sessions.
  const testAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0).toISOString();
  const at = (h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0).toISOString();
  const base: TestPrep = {
    assignmentId: 'a-test',
    testAt,
    status: 'ready',
    error: null,
    readiness: '4 of 8 topics on this test are ready, and the Hawaii mix-up is the first thing to fix.',
    counts: { solid: 4, shaky: 4, unchecked: 0 },
    topics: TOPICS,
    formats: { selected: ['mcq', 'frq', 'vocab'], found: { mcq: 'canvas', frq: 'canvas', vocab: 'guide' }, asked: false },
    today: { minutes: 60, asked: true },
    fits: 'Fits your 1 hour',
    note: 'Loomer won’t plan a late-night session, because sleep helps you remember more than another hour of studying.',
    plan: [
      { id: 's1', date: day(now, 0), when: 'now', label: 'Now', kind: 'diagnostic', minutes: 15, step: 'Diagnostic on 8 topics', detail: 'All 8 topics, 2 or 3 questions each', sub: 'Done, 4 ready', status: 'done', back: null, remindAt: null, reminder: false },
      { id: 's2', date: day(now, 0), when: 'next', label: 'Next', kind: 'focus', minutes: 20, step: '20 minutes on weak spots', detail: 'On Hawaii, the Congo, and Latin America', sub: '', status: 'today', back: null, remindAt: null, reminder: false },
      { id: 's3', date: day(now, 0), when: 'later-today', label: 'After dinner, around 7 PM', kind: 'mixed-check', minutes: 10, step: '10-minute mixed check', detail: 'On Hawaii, the Congo, and Latin America', sub: '', status: 'later', back: null, remindAt: at(19), reminder: false },
      { id: 's4', date: day(now, 1), when: 'morning', label: 'Tomorrow morning', kind: 'warm-up', minutes: 5, step: '5-minute warm-up', detail: 'Your 2 weakest topics, before the test', sub: 'Before the 9:00 AM test', status: 'later', back: null, remindAt: null, reminder: false },
    ],
    mistakes: [
      { id: 'm1', topicId: 't-congo', topic: 'The Congo', label: 'Why Leopold II’s rule drew protests', sub: 'Missed yesterday, then right' },
      { id: 'm2', topicId: 't-latam', topic: 'Latin America', label: 'What the Roosevelt Corollary added', sub: 'Missed yesterday' },
    ],
    blocks: [
      {
        id: 'b1',
        topic: 'Hawaii',
        kind: 'compare',
        title: 'Compare: Hawaii and the Congo',
        miss: null,
        text: null,
        quote: null,
        compare: {
          heads: ['Hawaii', 'The Congo'],
          rows: [
            { label: 'Who took control', a: 'American sugar planters, then the U.S.', b: 'King Leopold II, as his own property' },
            { label: 'Why', a: 'Sugar profits and a Pacific naval base', b: 'Rubber and ivory profits' },
          ],
        },
        steps: null,
        frame: null,
        again: false,
      },
      {
        id: 'b3',
        topic: 'The Congo under Leopold II',
        kind: 'explain',
        title: 'Why Leopold wanted the Congo',
        miss: null,
        text: 'The Congo belonged to Leopold himself, not to Belgium, and rubber made it pay.',
        quote: { text: 'Leopold II ran the Congo Free State as his own property and made money from rubber.', source: 'Your study guide, page 2' },
        compare: null,
        steps: null,
        frame: null,
        again: false,
      },
    ],
    notes: { photos: 0, found: null },
  };
  const fresh = { today: { minutes: null, asked: false }, fits: null, note: null, blocks: [] };
  return {
    ready: base,
    'ready-time': { ...base, today: { minutes: null, asked: false }, fits: null },
    setup: {
      ...base,
      ...fresh,
      status: 'setup',
      readiness: '',
      counts: { solid: 0, shaky: 0, unchecked: 8 },
      topics: TOPICS.map((t) => ({ ...t, standing: 'unchecked', lastCheck: null })),
      plan: [],
      mistakes: [],
    },
    'setup-notes': {
      ...base,
      ...fresh,
      status: 'setup',
      readiness: '',
      counts: { solid: 0, shaky: 0, unchecked: 10 },
      topics: [
        ...TOPICS.map((t) => ({ ...t, standing: 'unchecked' as const, lastCheck: null, progress: 0 })),
        { id: 'n1', text: 'The Boxer Rebellion', standing: 'unchecked', lastCheck: null, source: 'notes', new: true, mixup: false, progress: 0 },
        { id: 'n2', text: 'Dollar diplomacy', standing: 'unchecked', lastCheck: null, source: 'notes', new: true, mixup: false, progress: 0 },
      ],
      plan: [],
      mistakes: [],
      notes: { photos: 3, found: 'From your notes, Loomer found 2 more topics and 7 key terms.' },
    },
    'setup-format': {
      ...base,
      ...fresh,
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
  skill: 'remember',
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
  skill: 'remember',
  prompt: 'Why did Leopold II’s rule of the Congo draw protests from other countries?',
  options: ['He banned all missionaries', 'Reports exposed forced labor and brutal punishments for missed rubber quotas', 'He sold the Congo to Britain', 'He freed the Congo too quickly'],
  term: null,
  definition: null,
  like: false,
};
const SHORT: PracticeQuestion = { id: 'q-short', topic: 'The Panama Canal', kind: 'short', skill: 'understand', prompt: 'In one or two sentences, why did the United States want a canal across Panama?', options: [], term: null, definition: null, like: false };
const FRQ: PracticeQuestion = { id: 'q-frq', topic: 'Hawaii and the Congo', kind: 'frq', skill: 'apply', prompt: 'Compare how the United States took control of Hawaii with how Belgium ruled the Congo.', options: [], term: null, definition: null, like: false };
const VOCAB: PracticeQuestion = {
  id: 'q-vocab',
  topic: 'Key terms',
  kind: 'vocab', skill: 'remember',
  prompt: 'Say what it means, then flip.',
  options: [],
  term: 'Roosevelt Corollary',
  definition: 'Theodore Roosevelt’s 1904 addition to the Monroe Doctrine: the United States could step in to keep order in Latin American countries, so Europe wouldn’t.',
  like: false,
};
const EXPLAIN: PracticeQuestion = { id: 'q-explain', topic: 'China and the Open Door', kind: 'explain', skill: 'understand', prompt: 'Explain the Open Door Policy in your own words, like you’re telling a friend.', options: [], term: null, definition: null, like: false };
const MATH: PracticeQuestion = { id: 'q-math', topic: 'Solving quadratics', kind: 'math', skill: 'apply', prompt: 'Solve for x: 2x² − 8 = 0', options: [], term: null, definition: null, like: false };

const practice = (question: PracticeQuestion | null, answer: PracticeAnswer | null, index = 3, extra: Partial<Practice> = {}): Practice => ({
  id: 'p1',
  assignmentId: 'a-test',
  title: 'Unit 5 Test',
  index,
  total: 10,
  mode: 'practice',
  question,
  answer,
  teach: null,
  done: null,
  error: null,
  ...extra,
});

export function buildPracticeFixtures() {
  return {
    writing: practice(null, null, 0),
    mcq: practice(MCQ, null),
    'mcq-right': practice(MCQ, { kind: 'mcq', picked: 1, correct: 1, right: true, confidence: 'sure', outcome: 'solid', why: 'Roosevelt said the United States could act as an “international police power” so European countries had no reason to step in.', next: '' }),
    'mcq-wrong': practice(CONGO, { kind: 'mcq', picked: 0, correct: 1, right: false, confidence: 'guessing', outcome: 'gap', why: 'Missionaries were among the people who reported the abuse, which turned opinion against Leopold.', next: 'Loomer explains this next, then asks one like it.' }, 1),
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
        detail: 'The Congo is ready now, and Latin America still needs one more round before Friday.',
        topics: [
          { text: 'The Congo under Leopold II', standing: 'solid', lastCheck: { correct: 3, total: 3 } },
          { text: 'Latin America and the Roosevelt Corollary', standing: 'shaky', lastCheck: { correct: 2, total: 4 } },
        ],
        mistakes: 2,
        diagnosis: null,
      },
    }),
    failed: practice(null, null, 0, { error: 'Loomer couldn’t write questions just now, so try again in a minute.' }),
    ...round44(),
  } satisfies Record<string, Practice>;
}

export type PracticeFixtureName = keyof ReturnType<typeof buildPracticeFixtures>;

// Round 44: the diagnostic with Sure or Guessing, its diagnosis, and teaching blocks.
const HAWAII: PracticeQuestion = {
  id: 'q-haw',
  topic: 'Hawaii',
  kind: 'mcq',
  skill: 'remember',
  prompt: 'How did the United States gain control of Hawaii?',
  options: ['Hawaii’s people voted to join the United States', 'American planters overthrew Queen Liliuokalani, and the U.S. annexed Hawaii', 'Spain gave Hawaii to the U.S. after the war', 'The U.S. bought Hawaii from Britain'],
  term: null,
  definition: null,
  like: false,
};
const LEOPOLD: PracticeQuestion = {
  id: 'q-leo',
  topic: 'The Congo under Leopold II',
  kind: 'mcq',
  skill: 'understand',
  prompt: 'Why did Leopold II want control of the Congo?',
  options: ['To spread democracy', 'To profit from rubber and ivory', 'To protect it from Britain', 'To end the slave trade'],
  term: null,
  definition: null,
  like: false,
};
const diag = (p: Practice): Practice => ({ ...p, mode: 'diagnostic', title: 'Unit 5 Test', total: 20 });
const teach = (block: TeachBlock): Practice => ({ ...practice(null, null, 3, { total: 12 }), teach: block });
const MISS = 'You picked “Hawaii’s people voted to join the United States.” American sugar planters actually overthrew Queen Liliuokalani in 1893, and the U.S. annexed Hawaii in 1898, so it wasn’t Hawaii’s choice.';
const block: Pick<TeachBlock, 'topic' | 'miss' | 'text' | 'quote' | 'compare' | 'steps' | 'frame' | 'again'> = { topic: 'Hawaii', miss: null, text: null, quote: null, compare: null, steps: null, frame: null, again: false };

function round44() {
  return {
    'diag-pick': diag(practice(HAWAII, null, 2)),
    'diag-mixup': diag(
      practice(HAWAII, { kind: 'mcq', picked: 0, correct: 1, right: false, confidence: 'sure', outcome: 'mixup', why: 'American planters overthrew the queen, and the U.S. annexed Hawaii, so it wasn’t a vote.', next: 'You were sure, and the answer was B, so Loomer will explain this one after the check.' }, 2),
    ),
    'diag-guess': diag(
      practice(LEOPOLD, { kind: 'mcq', picked: 1, correct: 1, right: true, confidence: 'guessing', outcome: 'shaky', why: 'Leopold ran the Congo for profit, mostly rubber.', next: 'You were guessing, so this comes back later to make sure it sticks.' }, 7),
    ),
    'diag-done': diag(
      practice(null, null, 20, {
        done: {
          line: 'Here’s where you are for tomorrow’s Unit 5 Test.',
          detail: '4 of 8 topics look strong so far, and the Hawaii mix-up is the first thing to fix.',
          topics: [],
          mistakes: 3,
          diagnosis: [
            { topicId: 't-hawaii', topic: 'Hawaii', outcome: 'mixup', line: 'You were sure about one answer on Hawaii that wasn’t right, so it’s the first thing to fix.' },
            { topicId: 't-congo', topic: 'The Congo under Leopold II', outcome: 'shaky', line: 'You know the facts of the Congo, but its causes are shaky, so Loomer starts with why it happened.' },
            { topicId: 't-latam', topic: 'Latin America and the Roosevelt Corollary', outcome: 'gap', line: 'Latin America looks new to you, so Loomer will teach it before checking again.' },
            { topicId: 't-china', topic: 'China and the Open Door', outcome: 'shaky', line: 'You got China right, but you were guessing on 2 of 3, so it comes back after dinner.' },
            { topicId: 't-war', topic: 'The Spanish-American War', outcome: 'solid', line: 'You were right and sure on all 3.' },
            { topicId: 't-phil', topic: 'The Philippines', outcome: 'solid', line: 'You were right and sure on all 3.' },
            { topicId: 't-canal', topic: 'The Panama Canal', outcome: 'solid', line: 'You were right and sure on both.' },
            { topicId: 't-africa', topic: 'The Scramble for Africa', outcome: 'solid', line: 'You were right and sure on all 3.' },
          ],
        },
      }),
    ),
    'teach-compare': teach({
      ...block,
      id: 'b1',
      kind: 'compare',
      title: 'Compare: Hawaii and the Congo',
      miss: MISS,
      compare: {
        heads: ['Hawaii', 'The Congo'],
        rows: [
          { label: 'Who took control', a: 'American sugar planters, then the U.S.', b: 'King Leopold II, as his own property' },
          { label: 'How', a: 'Overthrew the queen in 1893, annexed in 1898', b: 'Claimed it in 1885 and ran it by force' },
          { label: 'Why', a: 'Sugar profits and a Pacific naval base', b: 'Rubber and ivory profits' },
          { label: 'What happened to people', a: 'Native Hawaiians lost their government', b: 'Forced labor and brutal punishments' },
        ],
      },
    }),
    'teach-timeline': teach({
      ...block,
      id: 'b2',
      kind: 'timeline',
      title: 'Timeline: how Hawaii became a U.S. territory',
      steps: [
        { when: '1875', text: 'A treaty lets Hawaiian sugar into the U.S. tax-free, so American planters grow rich.' },
        { when: '1887', text: 'Planters force the king to sign the Bayonet Constitution, which takes away his power.' },
        { when: '1893', text: 'Planters overthrow Queen Liliuokalani with help from U.S. Marines.' },
        { when: '1898', text: 'During the Spanish-American War, the U.S. annexes Hawaii as a naval base.' },
      ],
    }),
    'teach-quote': teach({
      ...block,
      id: 'b3',
      topic: 'The Congo under Leopold II',
      kind: 'explain',
      title: 'Why Leopold wanted the Congo',
      miss: 'You picked “to spread democracy.” Leopold wanted the Congo for profit, not for the people there.',
      quote: { text: 'Leopold II ran the Congo Free State as his own property and made money from rubber.', source: 'Your study guide, page 2' },
      text: 'Your study guide already says it: the Congo belonged to Leopold himself, not to Belgium, and rubber made it pay. Quotas forced people to collect rubber, which is why the abuse grew.',
    }),
    'teach-frame': teach({
      ...block,
      id: 'b4',
      topic: 'Hawaii and the Congo',
      kind: 'frq-skill',
      title: 'Building a comparison claim',
      text: null,
      frame: ['Both', { blank: 'first case' }, 'and', { blank: 'second case' }, 'were examples of', { blank: 'what they share' }, ', but', { blank: 'one case' }, 'was different because', { blank: 'the key difference' }, ', which happened because', { blank: 'the cause' }, '.'],
    }),
    'teach-visual': teach({
      ...block,
      id: 'b5',
      kind: 'visual',
      title: 'Who held the power in Hawaii',
      miss: 'Still tricky, so here it is as a picture instead of a table.',
      again: true,
      steps: [
        { when: '1', text: 'Planters grow rich from sugar' },
        { when: '2', text: 'They take the king’s power' },
        { when: '3', text: 'They overthrow the queen' },
        { when: '4', text: 'The U.S. annexes Hawaii' },
      ],
      text: 'Think of a store where the biggest supplier slowly takes over the owner’s office: the planters ran the money first, then the government.',
    }),
  };
}
