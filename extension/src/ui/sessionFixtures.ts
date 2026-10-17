// Typed SessionModel fixtures for the work-session screen (pick 3B) and Chat.
// They reuse the Home fixture assignments so both previews tell one story.
// Covered: no session, Doc not linked (with candidates), reading normally with a
// hint, paused, Google rate limit, no access, policy question, blocked policy,
// and AI turned off.
import type { ChatMessage, SessionModel } from '../model/session';
import { buildFixtures } from './fixtures';

const MIN = 60_000;

export function buildSessionFixtures(now: Date) {
  const home = buildFixtures(now);
  const essay = home.ready.next.item;
  const reflection = home['ready-blocked'].next.item;
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN).toISOString();

  const sources = [
    {
      id: 's-epa',
      title: 'EPA: Heat Island Effect',
      url: 'https://www.epa.gov/heatislands',
      capturedAt: ago(34),
      excerptChars: 1840,
    },
    {
      id: 's-canopy',
      title: '2025 Tree Canopy Report',
      url: 'https://cityofexample.gov/forestry/canopy-2025',
      capturedAt: ago(6),
      excerptChars: 2210,
    },
  ];

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
      doc: {
        status: 'not-linked',
        candidates: [
          { docId: '1aBcDraft', url: 'https://docs.google.com/document/d/1aBcDraft/edit' },
          { docId: '9zTemplate', url: 'https://docs.google.com/document/d/9zTemplate/edit' },
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

    'rate-limited': { ...base, doc: { ...linkedDoc, readState: 'rate-limited', lastReadAt: ago(4) } },

    'no-access': { ...base, doc: { ...linkedDoc, readState: 'no-access', lastReadAt: null, studentWords: null } },

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
