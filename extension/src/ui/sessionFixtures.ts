// Typed SessionModel fixtures for the work-session screen (pick 3B) and Chat.
// They reuse the Home fixture assignments so both previews tell one story.
// Covered: no session, Doc not linked (with candidates), reading normally with a
// hint, paused, Google rate limit, no access, policy question, blocked policy,
// AI turned off, and the other kinds of work: practice (two teacher sheets with
// grouped topics, one sheet, and sheets Loomer couldn't read), reading, and a quiz.
import type { ChatMessage, SessionModel } from '../model/session';
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

  const messages: ChatMessage[] = [
    {
      id: 1,
      role: 'student',
      text: 'how do i start the comparison part',
      kind: 'question',
      references: [],
      createdAt: ago(12),
    },
    {
      id: 2,
      role: 'loomer',
      text: 'Look at the two causes your sources name. Which one does the tree cover report measure directly?',
      kind: 'hint',
      references: [
        { quote: 'Blocks with the least tree cover were up to 9°F warmer.', from: 'your draft' },
        { quote: 'Compare the sources’ findings and explain what each one adds.', from: 'the instructions' },
      ],
      createdAt: ago(12),
    },
  ];

  const linkedDoc = {
    status: 'linked' as const,
    docId: '1aBcDraft',
    url: 'https://docs.google.com/document/d/1aBcDraft/edit',
    readState: 'ok' as const,
    lastReadAt: ago(1),
    studentWords: 412,
  };

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
    help: { availability: 'available' as const, messages, pending: false },
    hint: null,
    suggestion: null,
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
      help: { availability: 'available', messages: [], pending: false },
    },

    reading: base,

    'with-hint': {
      ...base,
      hint: {
        id: 31,
        text: 'Your third paragraph puts both findings side by side. How could the tree cover data explain the temperature gap the EPA describes?',
        reference: { quote: 'The EPA says cities can be 7°F warmer. The city report says shaded blocks are cooler.', from: 'your draft' },
        createdAt: ago(0),
      },
    },

    'help-pending': {
      ...base,
      help: {
        availability: 'available',
        messages: [
          ...messages,
          { id: 3, role: 'student', text: 'Can you explain more?', kind: 'question', references: [], createdAt: ago(0) },
        ],
        pending: true,
      },
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
      help: { availability: 'available' as const, messages: [], pending: false },
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
      help: { availability: 'available' as const, messages: [], pending: false },
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
      help: { availability: 'available' as const, messages: [], pending: false },
      teacherSheets: [
        { docId: '3cSheet', url: 'https://docs.google.com/document/d/3cSheet/edit', title: 'Unit 6 Review: Quadratics', state: 'ok', topics: 4 },
        { docId: '3fSetB', url: 'https://docs.google.com/document/d/3fSetB/edit', title: 'Practice set B', state: 'needs-permission', topics: null },
        { docId: '3gKey', url: 'https://docs.google.com/document/d/3gKey/edit', title: 'Answer key (teacher view)', state: 'no-access', topics: null },
      ],
      sourceNeed: null,
      topics: { status: 'reading', items: [], next: null },
    },
    'reading-work': {
      ...base,
      assignment: lectura,
      startedAt: ago(9),
      doc: { status: 'not-linked', candidates: [] },
      sources: [],
      activity: [],
      help: { availability: 'available' as const, messages: [], pending: false },
    },
    // A Canvas quiz: no help, and Ask Loomer is paused while it's open.
    quiz: {
      ...base,
      assignment: quiz,
      startedAt: ago(3),
      doc: { status: 'not-linked', candidates: [] },
      sources: [],
      activity: [],
      help: { availability: 'quiz', messages: [], pending: false },
    },

    'needs-policy': {
      ...base,
      help: { availability: 'needs-policy-answer', messages: [], pending: false },
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
        messages: [],
        pending: false,
      },
    },

    'ai-off': {
      ...base,
      help: { availability: 'ai-off', messages: [], pending: false },
    },
  } satisfies Record<string, SessionModel>;
}

export type SessionFixtureName = keyof ReturnType<typeof buildSessionFixtures>;
