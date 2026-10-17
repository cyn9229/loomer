// Typed HomeModel fixtures for visual work and review. They cover every status and
// the edge cases the UI must show honestly: replay data, a blocked AI policy, a
// due-date conflict, an undated item, and unreadable requirements. Dates are
// relative to `now` so the fixtures never expire. Opened in the side panel with
// ?fixture=<name>; the panel labels them "Fixture preview" so they are never
// mistaken for live data.
import type { CheckInfo, Evidence, HomeModel, WorkItem } from '../model/home';
import { dateTime } from './format';

const HOUR = 3_600_000;

/** A local date `days` from now at hh:mm, as ISO. */
function at(now: Date, days: number, hh: number, mm: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hh, mm);
  return d.toISOString();
}

function item(over: Partial<WorkItem> & Pick<WorkItem, 'assignmentId' | 'title'>): WorkItem {
  return {
    courseName: null,
    url: 'https://lincolnhs.instructure.com/courses/1840/assignments/88213',
    due: null,
    dueConflict: false,
    effort: { label: 'Unknown', reason: null },
    policy: { state: 'none-found' },
    requirements: 'checked',
    replay: false,
    ...over,
  };
}

export function buildFixtures(now: Date) {
  const checkedAt = new Date(now.getTime() - 0.2 * HOUR).toISOString();

  const essayDue = at(now, 5, 23, 59);
  const essay = item({
    assignmentId: 'a-essay',
    title: 'Heat islands comparison essay',
    courseName: 'English 10',
    due: { at: essayDue, source: 'canvas' },
    effort: { label: 'Substantial', reason: 'Compare two sources, build an argument, and revise.' },
    policy: { state: 'permitted', sourceLabel: 'Course syllabus' },
  });
  const vocab = item({
    assignmentId: 'a-vocab',
    title: 'Ch. 6 vocabulary check',
    courseName: 'Biology',
    url: 'https://lincolnhs.instructure.com/courses/1841/assignments/88301',
    due: { at: at(now, 2, 8, 0), source: 'canvas' },
    effort: { label: 'Short', reason: 'Twenty terms, one short quiz.' },
  });
  const reflection = item({
    assignmentId: 'a-reflection',
    title: 'Heat and health reflection',
    courseName: 'Health',
    url: 'https://lincolnhs.instructure.com/courses/1842/assignments/90211',
    due: { at: at(now, 4, 23, 59), source: 'canvas' },
    effort: { label: 'Moderate', reason: 'One 300 to 500 word reflection with a source.' },
    policy: {
      state: 'blocked',
      quote: 'Complete this reflection on your own. Do not use AI tools.',
      sourceLabel: 'Assignment instructions',
    },
  });
  const lab = item({
    assignmentId: 'a-lab',
    title: 'Urban field lab',
    courseName: 'Environmental Science',
    url: 'https://lincolnhs.instructure.com/courses/1843/assignments/90400',
    due: { at: at(now, 13, 15, 0), source: 'canvas' },
    requirements: 'unreadable',
  });
  const proposal = item({
    assignmentId: 'a-proposal',
    title: 'Research proposal',
    courseName: 'English 10',
    url: 'https://lincolnhs.instructure.com/courses/1840/assignments/88290',
    due: { at: at(now, 9, 23, 59), source: 'canvas' },
    dueConflict: true,
    effort: { label: 'Moderate', reason: 'One page with three sources.' },
  });
  const reading = item({
    assignmentId: 'a-reading',
    title: 'Independent reading log',
    courseName: 'English 10',
    url: 'https://lincolnhs.instructure.com/courses/1840/assignments/88111',
    due: null,
  });
  const replayItem = item({
    assignmentId: 'r-replay',
    title: 'Sample: tree canopy data table',
    courseName: 'Environmental Science (replay)',
    url: 'http://127.0.0.1:8787/courses/9001/assignments/1',
    due: { at: at(now, 3, 23, 59), source: 'canvas' },
    effort: { label: 'Short', reason: 'Fill one data table.' },
    replay: true,
  });

  const lastCheck: CheckInfo = { at: checkedAt, outcome: 'ok', courses: 4, partial: false, replay: false };

  const essayEvidence: Evidence[] = [
    {
      kind: 'school-fact',
      text: `Due ${dateTime(essayDue)}.`,
      sourceLabel: 'Canvas assignment',
      sourceUrl: essay.url ?? undefined,
      observedAt: checkedAt,
    },
    {
      kind: 'school-fact',
      text: 'The rubric asks you to compare both sources.',
      quote: 'Compare the sources’ findings and explain what each one adds.',
      sourceLabel: 'Rubric, criterion 2',
      sourceUrl: essay.url ?? undefined,
      observedAt: checkedAt,
    },
    {
      kind: 'ai-interpretation',
      text: 'This is the largest open requirement due this week. The vocabulary check is short and fits Monday morning.',
      sourceLabel: 'Based on the two assignments above',
    },
    {
      kind: 'limitation',
      text: 'The Urban field lab instructions are a PDF Loomer cannot read yet, so its size is unknown.',
      sourceLabel: 'lab-packet.pdf',
      sourceUrl: lab.url ?? undefined,
    },
  ];

  return {
    'not-connected': { status: 'not-connected' },

    'checking-first': {
      status: 'checking',
      progress: { checked: 0, total: 0 },
      pending: [],
      rest: [],
      lastCheck: null,
    },

    checking: {
      status: 'checking',
      progress: { checked: 4, total: 6 },
      pending: [{ title: vocab.title, detail: 'Reading description' }],
      rest: [
        essay,
        reflection,
        proposal,
        { ...vocab, requirements: 'checking' },
        lab,
        { ...reading, requirements: 'not-checked' },
      ],
      lastCheck,
    },

    'cannot-compare': {
      status: 'cannot-compare',
      limitations: [
        {
          kind: 'limitation',
          text: 'The Urban field lab instructions are a PDF Loomer cannot read yet. It could change what comes first.',
          sourceLabel: 'lab-packet.pdf',
          sourceUrl: lab.url ?? undefined,
        },
        {
          kind: 'limitation',
          text: 'One course could not be read in the last check.',
          sourceLabel: 'Canvas',
        },
      ],
      rest: [vocab, reflection, essay, lab, reading],
      lastCheck: { ...lastCheck, outcome: 'partial', partial: true },
    },

    ready: {
      status: 'ready',
      next: {
        item: essay,
        action: 'Outline the comparison between your two sources',
        reason: 'Connect the EPA findings to the city’s tree cover data. The rubric asks for a comparison, and the deadline is this week.',
        evidence: essayEvidence,
        aiGenerated: true,
      },
      rest: [vocab, replayItem, reflection, proposal, lab, reading],
      lastCheck,
    },

    'ready-blocked': {
      status: 'ready',
      next: {
        item: reflection,
        action: 'Open the reflection prompt',
        reason: 'You chose this one. AI help is off for it, so Loomer only keeps its deadline and links.',
        evidence: [
          {
            kind: 'student-context',
            text: 'You picked this assignment to work on now.',
            sourceLabel: 'Your choice',
            observedAt: checkedAt,
          },
          {
            kind: 'school-fact',
            text: 'The instructions forbid AI tools.',
            quote: reflection.policy.quote,
            sourceLabel: 'Assignment instructions',
            sourceUrl: reflection.url ?? undefined,
            observedAt: checkedAt,
          },
        ],
        aiGenerated: false,
      },
      rest: [essay, vocab, lab],
      lastCheck,
    },

    'ready-replay': {
      status: 'ready',
      next: {
        item: replayItem,
        action: 'Fill in the canopy data table',
        reason: 'Short and due in three days. Replay data for the demo.',
        evidence: [
          {
            kind: 'school-fact',
            text: 'Due in three days.',
            sourceLabel: 'Replay assignment',
            sourceUrl: replayItem.url ?? undefined,
            observedAt: checkedAt,
          },
        ],
        aiGenerated: true,
      },
      rest: [{ ...essay, replay: true }],
      lastCheck: { ...lastCheck, replay: true, courses: 1 },
    },

    'signed-out': {
      status: 'ready',
      next: {
        item: essay,
        action: 'Outline the comparison between your two sources',
        reason: 'From the last successful check. Canvas needs you to sign in again before Loomer can update.',
        evidence: essayEvidence.slice(0, 2),
        aiGenerated: true,
      },
      rest: [vocab, reflection],
      lastCheck: { ...lastCheck, outcome: 'auth-expired', at: new Date(now.getTime() - 26 * HOUR).toISOString() },
    },

    empty: {
      status: 'empty',
      rest: [reading],
      lastCheck,
    },
  } satisfies Record<string, HomeModel>;
}

export type FixtureName = keyof ReturnType<typeof buildFixtures>;
