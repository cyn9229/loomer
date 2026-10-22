// Typed SessionModel fixtures for the work-session screen (pick 3B) and Chat.
// They reuse the Home fixture assignments so both previews tell one story.
// Covered: no session, Doc not linked (with candidates), reading normally with a
// hint, paused, Google rate limit, no access, policy question, blocked policy,
// AI turned off, and the other kinds of work: practice (two teacher sheets with
// grouped topics, one sheet, and sheets Loomer couldn't read), reading, and a quiz.
import type { SessionModel } from '../model/session';
import type { Pending } from '../model/wait';
import type { TrailView } from '../model/trail';
import { buildFixtures, essaySources } from './fixtures';

const MIN = 60_000;

export function buildSessionFixtures(now: Date) {
  const home = buildFixtures(now);
  const essay = home.ready.next.item;
  const reflection = home['ready-blocked'].next.item;
  const byId = (id: string) => home.ready.rest.find((i) => i.assignmentId === id)!;
  const sheet = byId('a-sheet');
  const lectura = byId('a-lectura');
  const quiz = byId('a-quiz');
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN).toISOString();

  const sources = essaySources(now);

  const activity = [
    { at: ago(2), text: 'Edited your draft (+120 words)' },
    { at: ago(6), text: 'Added source: 2025 Tree Canopy Report' },
    { at: ago(21), text: 'Edited your draft (+64 words)' },
    { at: ago(38), text: 'Started this session' },
  ];

  const linkedDoc = {
    status: 'linked' as const,
    docId: '1aBcDraft',
    url: 'https://docs.google.com/document/d/1aBcDraft/edit',
    readState: 'ok' as const,
    lastReadAt: ago(1),
    studentWords: 412,
  };

  /** The study trail with nothing asked, picked, or noticed yet. */
  const noTrail: TrailView = { ask: null, setup: false, other: null, picked: [], noticed: [] };

  /** A wait that started `secAgo` seconds ago. */
  const wait = (title: string, about: string | null, secAgo: number, usualSec: [number, number]): Pending => ({
    title,
    about,
    startedAt: new Date(now.getTime() - secAgo * 1000).toISOString(),
    usualSec,
    steps: null,
    canCancel: false,
  });
  const base = {
    status: 'active' as const,
    sessionId: 7,
    assignment: essay,
    startedAt: ago(38),
    plannedUntil: null,
    topics: null,
    teacherSheets: [],
    sourceNeed: { required: 3, saved: 2, quote: 'Use at least three sources' },
    doc: linkedDoc,
    sources,
    activity,
    help: { availability: 'available' as const, reviewPending: false },
    hint: null,
    focus: { text: 'Compare your two sources', why: 'Your draft summarizes each source but does not compare them yet.', requirement: 'Compare the two sources' },
    handledHints: [{ id: 30, text: 'What does the EPA number show about your city?', at: ago(9) }],
    suggestion: null,
    focusPending: null,
    focusFailed: null,
    hintPending: null,
    trail: null,
    // What End shows: the planner's recap sentence, and the next step once asked for.
    recap: { text: 'You added 240 words and saved 2 sources in 35 minutes.', noun: 'this essay', minutes: 35, wordsDelta: 240, edits: 3, sourcesSaved: 2, topicsChecked: 0, trail: null, trailNext: null },
    nextStep: { status: 'ready' as const, text: 'Compare your two sources', aiGenerated: true },
  };

  return {
    none: { status: 'none' },

    'not-linked': {
      ...base,
      startedAt: ago(1),
      plannedUntil: null,
      topics: null,
      teacherSheets: [],
      sourceNeed: null,
      doc: {
        status: 'not-linked',
        candidates: [
          { docId: '1aBcDraft', url: 'https://docs.google.com/document/d/1aBcDraft/edit', label: 'Your draft (make a copy)' },
          { docId: '9zTemplate', url: 'https://docs.google.com/document/d/9zTemplate/edit', label: 'Essay template' },
        ],
      },
      sources: [],
      activity: [{ at: ago(1), text: 'Started this session' }],
      help: { availability: 'available', reviewPending: false },
    },

    reading: base,

    'with-hint': {
      ...base,
      hint: {
        id: 31,
        text: 'How could the tree data explain the EPA’s temperature gap?',
        reference: { quote: 'The EPA says cities can be 7°F warmer. The city report says shaded blocks are cooler.', from: 'your draft' },
        createdAt: ago(0),
        requirement: 'Compare the two sources',
      },
    },

    // Round 45 waits: the focus being picked, a quiet hint read, and the next step at the end.
    'focus-pending': {
      ...base,
      startedAt: ago(1),
      focus: null,
      handledHints: [],
      focusPending: wait('Picking a focus', 'Your draft and the 4 things it asks for', 12, [10, 30]),
    },
    'hint-pending': { ...base, hintPending: wait('Looking for a hint', 'Your latest paragraph', 6, [10, 30]) },
    'next-pending': { ...base, nextStep: { status: 'pending', pending: wait('Picking where to start next time', null, 3, [3, 10]) } },

    // Round 47, the study trail: the ask, the general ask without tab access, an unknown site, and what Loomer noticed.
    'trail-ask': { ...base, trail: { ...noTrail, ask: { origin: 'https://quizlet.com', name: 'Quizlet' } } },
    'trail-setup': { ...base, trail: { ...noTrail, setup: true } },
    'trail-other': { ...base, trail: { ...noTrail, picked: [{ origin: 'https://quizlet.com', name: 'Quizlet', paused: false }], other: { origin: 'https://brainscape.com', matched: 'the Monroe Doctrine' } } },
    'trail-noticed': {
      ...base,
      trail: {
        ...noTrail,
        picked: [
          { origin: 'https://chatgpt.com', name: 'ChatGPT', paused: false },
          { origin: 'https://quizlet.com', name: 'Quizlet', paused: false },
          { origin: 'https://www.khanacademy.org', name: 'Khan Academy', paused: true },
        ],
        noticed: [
          { origin: 'https://chatgpt.com', name: 'ChatGPT', minutes: 15, took: 'You asked about the thesis twice and the EPA numbers once.', paused: false },
          { origin: 'https://quizlet.com', name: 'Quizlet', minutes: 10, took: '14 key terms from this essay came up.', paused: false },
          { origin: 'https://www.khanacademy.org', name: 'Khan Academy', minutes: 4, took: 'Urban heat islands came up.', paused: true },
        ],
      },
      recap: { ...base.recap, trail: 'You studied 25 minutes on ChatGPT and Quizlet, mostly the thesis and the EPA numbers.', trailNext: null },
    },

    'help-pending': {
      ...base,
      // A draft check is running; its reply streams into the essay's chat.
      help: { availability: 'available', reviewPending: true },
    },

    suggestion: {
      ...base,
      suggestion: {
        tabId: 412,
        title: 'Urban Heat Islands: Causes and Effects',
        url: 'https://www.example.org/science/urban-heat-islands',
        matched: ['heat island', 'urban'],
      },
    },

    paused: { ...base, status: 'paused' },

    // The student said they have 30 min: the clock counts down, a note at 5 min, then they choose.
    'time-left': { ...base, startedAt: ago(2), plannedUntil: ago(-28) },
    'time-5-min': { ...base, startedAt: ago(26), plannedUntil: ago(-4) },
    'time-up': { ...base, startedAt: ago(31), plannedUntil: ago(1) },

    'rate-limited': { ...base, doc: { ...linkedDoc, readState: 'rate-limited', lastReadAt: ago(4) } },

    'no-access': { ...base, doc: { ...linkedDoc, readState: 'no-access', lastReadAt: null, studentWords: null } },

    // Practice with two teacher sheets read from the instructions: topics grouped by sheet, no word count, own copy not linked.
    practice: {
      ...base,
      assignment: sheet,
      startedAt: ago(12),
      doc: {
        status: 'not-linked',
        candidates: [{ docId: '5eCopy', url: 'https://docs.google.com/document/d/5eCopy/edit', label: 'Answer sheet (make a copy)' }],
      },
      sources: [],
      activity: [],
      help: { availability: 'available' as const, reviewPending: false },
      teacherSheets: [
        { docId: '3cSheet', url: 'https://docs.google.com/document/d/3cSheet/edit', title: 'Unit 6 Review: Quadratics', state: 'ok', topics: 4 },
        { docId: '3dForm', url: 'https://docs.google.com/document/d/3dForm/edit', title: 'Formula sheet', state: 'ok', topics: 2 },
      ],
      sourceNeed: null,
      topics: {
        status: 'ok',
        items: [
          { text: 'Factor quadratics', quote: 'Factor each quadratic completely.', sheet: 'Unit 6 Review: Quadratics', standing: 'solid', lastCheck: { correct: 3, total: 3, at: ago(20) }, skipped: false },
          { text: 'Complete the square', quote: 'Rewrite by completing the square.', sheet: 'Unit 6 Review: Quadratics', standing: 'solid', lastCheck: { correct: 3, total: 3, at: ago(20) }, skipped: false },
          { text: 'Vertex form', quote: 'Write each function in vertex form.', sheet: 'Unit 6 Review: Quadratics', standing: 'shaky', lastCheck: { correct: 1, total: 3, at: ago(10) }, skipped: false },
          { text: 'Projectile word problems', quote: 'A ball is thrown upward from a height of 6 feet…', sheet: 'Unit 6 Review: Quadratics', standing: 'unchecked', lastCheck: null, skipped: false },
          { text: 'Quadratic formula', quote: 'x = (−b ± √(b² − 4ac)) / 2a', sheet: 'Formula sheet', standing: 'unchecked', lastCheck: null, skipped: false },
          { text: 'Discriminant', quote: 'b² − 4ac tells you how many solutions.', sheet: 'Formula sheet', standing: 'unchecked', lastCheck: null, skipped: false },
          { text: 'Graphing by hand', quote: 'Sketch each parabola without a calculator.', sheet: 'Unit 6 Review: Quadratics', standing: 'unchecked', lastCheck: null, skipped: true },
        ],
        next: { topic: 'Vertex form', reason: 'You missed 2 of 3 on the last check.', mode: 'check' },
        pending: null,
        retryAt: null,
      },
    },
    // One sheet read: a single line, flat topics, and the own-copy line.
    'practice-one-sheet': {
      ...base,
      assignment: sheet,
      startedAt: ago(1),
      plannedUntil: ago(-29),
      doc: { status: 'not-linked', candidates: [] },
      sources: [],
      activity: [],
      help: { availability: 'available' as const, reviewPending: false },
      teacherSheets: [{ docId: '3cSheet', url: 'https://docs.google.com/document/d/3cSheet/edit', title: 'Unit 6 Review: Quadratics', state: 'ok', topics: 4 }],
      sourceNeed: null,
      topics: {
        status: 'ok',
        items: [
          { text: 'Factor quadratics', quote: 'Factor each quadratic completely.', sheet: 'Unit 6 Review: Quadratics', standing: 'unchecked', lastCheck: null, skipped: false },
          { text: 'Complete the square', quote: 'Rewrite by completing the square.', sheet: 'Unit 6 Review: Quadratics', standing: 'unchecked', lastCheck: null, skipped: false },
          { text: 'Vertex form', quote: 'Write each function in vertex form.', sheet: 'Unit 6 Review: Quadratics', standing: 'shaky', lastCheck: { correct: 1, total: 3, at: ago(10) }, skipped: false },
          { text: 'Projectile word problems', quote: 'A ball is thrown upward from a height of 6 feet…', sheet: 'Unit 6 Review: Quadratics', standing: 'unchecked', lastCheck: null, skipped: false },
        ],
        next: { topic: 'Vertex form', reason: 'You missed 2 of 3 on the last check.', mode: 'explain' },
        pending: null,
        retryAt: null,
      },
    },
    // Three sheets, three states: read, needs Google Docs, and Google refused.
    'practice-sheet-states': {
      ...base,
      assignment: sheet,
      startedAt: ago(4),
      doc: { status: 'not-linked', candidates: [] },
      sources: [],
      activity: [],
      help: { availability: 'available' as const, reviewPending: false },
      teacherSheets: [
        { docId: '3cSheet', url: 'https://docs.google.com/document/d/3cSheet/edit', title: 'Unit 6 Review: Quadratics', state: 'ok', topics: 4 },
        { docId: '3fSetB', url: 'https://docs.google.com/document/d/3fSetB/edit', title: 'Practice set B', state: 'needs-permission', topics: null },
        { docId: '3gKey', url: 'https://docs.google.com/document/d/3gKey/edit', title: 'Answer key (teacher view)', state: 'no-access', topics: null },
      ],
      sourceNeed: null,
      topics: { status: 'reading', items: [], next: null, pending: wait('Reading the sheet for topics', 'Unit 6 Review: Quadratics', 2, [5, 5]), retryAt: null },
    },
    'reading-work': {
      ...base,
      assignment: lectura,
      startedAt: ago(9),
      doc: { status: 'not-linked', candidates: [] },
      sources: [],
      activity: [],
      help: { availability: 'available' as const, reviewPending: false },
    },
    // A Canvas quiz: no help, and Ask Loomer is paused while it's open.
    quiz: {
      ...base,
      assignment: quiz,
      startedAt: ago(3),
      doc: { status: 'not-linked', candidates: [] },
      sources: [],
      activity: [],
      help: { availability: 'quiz', reviewPending: false },
    },

    'needs-policy': {
      ...base,
      help: { availability: 'needs-policy-answer', reviewPending: false },
    },

    blocked: {
      ...base,
      assignment: reflection,
      doc: { ...linkedDoc, docId: '2bReflect', url: 'https://docs.google.com/document/d/2bReflect/edit', studentWords: 180 },
      sources: sources.slice(0, 1),
      help: {
        availability: 'blocked',
        policyQuote: reflection.policy.quote,
        policySource: reflection.policy.sourceLabel,
        reviewPending: false,
      },
    },

    'ai-off': {
      ...base,
      help: { availability: 'ai-off', reviewPending: false },
    },
  } satisfies Record<string, SessionModel>;
}

export type SessionFixtureName = keyof ReturnType<typeof buildSessionFixtures>;
