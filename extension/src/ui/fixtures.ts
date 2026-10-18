// Typed HomeModel fixtures for visual work and review. They cover every status and
// the edge cases the UI must show honestly: replay data, a blocked AI policy, a
// due-date conflict, an undated item, and unreadable requirements. Dates are
// relative to `now` so the fixtures never expire. Opened in the side panel with
// ?fixture=<name>; the panel labels them "Fixture preview" so they are never
// mistaken for live data.
import type { ScreenshotDraft } from '../capture/screenshot';
import type { AssignmentDetailModel } from '../model/detail';
import { LEAD_DAYS } from '../analysis/plan';
import type { Checkpoint, CheckInfo, Evidence, HomeModel, ResumeBriefing, WorkItem } from '../model/home';
import { dateTime } from './format';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Spread into each connected fixture: no resume briefing, older-work review, busy-days note, or brief.
const noResume = { resume: null, olderReview: null, crowded: null, brief: null, room: [], yourChanges: [] };

/** A local date `days` from now at hh:mm, as ISO. */
function at(now: Date, days: number, hh: number, mm: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hh, mm);
  return d.toISOString();
}

const WEEK = 7 * 24 * HOUR;

/** Bucket the way the logic does: undated and past items are listed, never ranked. */
function bucketFor(due: WorkItem['due'], now: Date): WorkItem['bucket'] {
  if (!due) return 'no-date';
  const t = Date.parse(due.at) - now.getTime();
  if (t < 0) return 'past';
  return t <= WEEK ? 'soon' : 'later';
}

/**
 * Start-by the way the planner sets it: the next checkpoint (or the due date)
 * minus the lead days for the workload.
 */
function startByFor(due: WorkItem['due'], checkpoints: Checkpoint[], effort: WorkItem['effort']['label'], now: Date): WorkItem['startBy'] {
  const checkpoint = checkpoints.find((c) => Date.parse(c.at) >= now.getTime());
  const target = checkpoint?.at ?? due?.at;
  if (!target) return null;
  return { at: new Date(Date.parse(target) - LEAD_DAYS[effort] * DAY).toISOString(), basis: checkpoint ? 'checkpoint' : 'due' };
}

function item(now: Date, over: Partial<WorkItem> & Pick<WorkItem, 'assignmentId' | 'title'>): WorkItem {
  const due = over.due ?? null;
  const checkpoints = over.checkpoints ?? [];
  return {
    courseKey: `course:${over.courseName ?? 'none'}`,
    bucket: bucketFor(due, now),
    hidden: false,
    correction: null,
    courseName: null,
    url: 'https://lincolnhs.instructure.com/courses/1840/assignments/88213',
    due: null,
    dueConflict: false,
    effort: { label: 'Unknown', reason: null, source: 'ai' },
    guessMinutes: null,
    policy: { state: 'none-found' },
    requirements: 'checked',
    replay: false,
    startBy: startByFor(due, checkpoints, over.effort?.label ?? 'Unknown', now),
    checkpoints,
    rankReason: null,
    ...over,
  };
}

export function buildFixtures(now: Date) {
  const checkedAt = new Date(now.getTime() - 0.2 * HOUR).toISOString();

  const essayDue = at(now, 5, 23, 59);
  const essay = item(now, {
    assignmentId: 'a-essay',
    title: 'Heat islands comparison essay',
    courseName: 'English 10',
    due: { at: essayDue, source: 'canvas' },
    effort: { label: 'Substantial', reason: 'Compare two sources, build an argument, and revise.', source: 'ai' },
    policy: { state: 'permitted', sourceLabel: 'Course syllabus' },
    checkpoints: [{ text: 'Draft for peer review', at: new Date(Date.parse(essayDue) - DAY).toISOString(), quote: 'Bring a full draft for peer review the day before the final deadline.', derived: true }],
    rankReason: `Start today: heavy workload, Draft for peer review by ${new Date(Date.parse(essayDue) - DAY).toLocaleDateString(undefined, { weekday: 'short' })}.`,
  });
  const photo = item(now, {
    assignmentId: 'a-photo',
    title: 'Photosynthesis short response',
    courseName: 'Biology',
    url: 'https://lincolnhs.instructure.com/courses/1841/assignments/88310',
    due: { at: at(now, 1, 19, 59), source: 'canvas' },
    effort: { label: 'Short', reason: 'One paragraph answer.', source: 'ai' },
    rankReason: 'Start today: light workload, due tomorrow. Second because Heat islands comparison essay needs a start today.',
  });
  const vocab = item(now, {
    assignmentId: 'a-vocab',
    title: 'Ch. 6 vocabulary check',
    courseName: 'Biology',
    url: 'https://lincolnhs.instructure.com/courses/1841/assignments/88301',
    due: { at: at(now, 2, 8, 0), source: 'canvas' },
    effort: { label: 'Short', reason: 'Twenty terms, one short quiz.', source: 'ai' },
    rankReason: 'Start tomorrow: light workload, due Mon.',
  });
  const reflection = item(now, {
    assignmentId: 'a-reflection',
    title: 'Heat and health reflection',
    courseName: 'Health',
    url: 'https://lincolnhs.instructure.com/courses/1842/assignments/90211',
    due: { at: at(now, 4, 23, 59), source: 'canvas' },
    effort: { label: 'Moderate', reason: 'One 300 to 500 word reflection with a source.', source: 'ai' },
    policy: {
      state: 'blocked',
      quote: 'Complete this reflection on your own. Do not use AI tools.',
      sourceLabel: 'Assignment instructions',
    },
  });
  const lab = item(now, {
    assignmentId: 'a-lab',
    title: 'Urban field lab',
    courseName: 'Environmental Science',
    url: 'https://lincolnhs.instructure.com/courses/1843/assignments/90400',
    due: { at: at(now, 13, 15, 0), source: 'canvas' },
    requirements: 'unreadable',
  });
  const proposal = item(now, {
    assignmentId: 'a-proposal',
    title: 'Research proposal',
    courseName: 'English 10',
    url: 'https://lincolnhs.instructure.com/courses/1840/assignments/88290',
    due: { at: at(now, 9, 23, 59), source: 'canvas' },
    dueConflict: true,
    effort: { label: 'Moderate', reason: 'One page with three sources.', source: 'ai' },
  });
  const reading = item(now, {
    assignmentId: 'a-reading',
    title: 'Independent reading log',
    courseName: 'English 10',
    url: 'https://lincolnhs.instructure.com/courses/1840/assignments/88111',
    due: null,
  });
  const pastQuiz = item(now, {
    assignmentId: 'a-past',
    title: 'Ch. 5 reading questions',
    courseName: 'Biology',
    url: 'https://lincolnhs.instructure.com/courses/1841/assignments/88200',
    due: { at: at(now, -3, 8, 0), source: 'canvas' },
    effort: { label: 'Short', reason: null, source: 'ai' },
  });
  const hiddenItem = { ...item(now, { assignmentId: 'a-hidden', title: 'Optional: extra credit poster', courseName: 'Health' }), hidden: true };
  const replayItem = item(now, {
    assignmentId: 'r-replay',
    title: 'Sample: tree canopy data table',
    courseName: 'Environmental Science (replay)',
    url: 'http://127.0.0.1:8787/courses/9001/assignments/1',
    due: { at: at(now, 3, 23, 59), source: 'canvas' },
    effort: { label: 'Short', reason: 'Fill one data table.', source: 'ai' },
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
      text: 'Substantial: it asks you to compare two sources and build an argument.',
      quote: 'Write a 600 word essay that compares how both sources explain heat islands and argue which explanation is stronger.',
      sourceLabel: 'Assignment instructions',
      sourceUrl: essay.url ?? undefined,
      observedAt: checkedAt,
    },
    {
      kind: 'limitation',
      text: 'The Urban field lab instructions are a PDF Loomer cannot read yet, so its size is unknown.',
      sourceLabel: 'lab-packet.pdf',
      sourceUrl: lab.url ?? undefined,
    },
  ];

  const readyNext = {
    item: essay,
    action: 'Outline the comparison between your two sources',
    reason: 'Connect the EPA findings to the city’s tree cover data. The rubric asks for a comparison, and the deadline is this week.',
    evidence: essayEvidence,
    aiGenerated: true,
    chosenByStudent: false,
    loomerPick: null,
    change: null,
  };
  const weekday = (iso: string | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short' }) : '');
  const crowded = {
    text: `${weekday(essay.startBy?.at)} and ${weekday(reflection.startBy?.at)} are busy: ${essay.title} and ${reflection.title} both need a start. Plan time for both.`,
    assignmentIds: [essay.assignmentId, reflection.assignmentId],
  };
  const brief = { date: now.toISOString().slice(0, 10), text: `1 due tomorrow; start ${essay.title} today (and 1 more).` };

  const essayResume = (recommendationChanged: boolean): ResumeBriefing => ({
    assignment: essay,
    at: new Date(now.getTime() - 3 * HOUR).toISOString(),
    facts: ['Edited your draft 3 times (+240 words)', 'Saved 2 sources', 'Asked for 1 hint'],
    sources: [
      { title: 'EPA: Heat Island Effect', url: 'https://www.epa.gov/heatislands' },
      { title: '2025 Tree Canopy Report', url: 'https://cityofexample.gov/forestry/canopy-2025' },
    ],
    docUrl: 'https://docs.google.com/document/d/1aBcDraft/edit',
    requirements: [
      { text: 'Compare how both sources explain heat islands.', quote: 'compares how both sources explain heat islands' },
      { text: 'Argue which explanation is stronger.', quote: 'argue which explanation is stronger' },
    ],
    recommendationChanged,
  });

  return {
    'not-connected': { status: 'not-connected' },

    'checking-first': {
      status: 'checking',
      ...noResume,
      progress: { checked: 0, total: 0 },
      pending: [],
      rest: [],
      lastCheck: null,
    },

    checking: {
      status: 'checking',
      ...noResume,
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
      ...noResume,
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
      ...noResume,
      crowded,
      brief,
      next: readyNext,
      rest: [photo, vocab, replayItem, reflection, proposal, lab, reading, pastQuiz, hiddenItem],
      lastCheck,
    },

    'ready-blocked': {
      status: 'ready',
      ...noResume,
      next: {
        item: reflection,
        action: 'Open the instructions',
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
        chosenByStudent: true,
        loomerPick: { item: essay, reason: 'The largest open requirement due this week.' },
        change: null,
      },
      rest: [essay, vocab, lab],
      lastCheck,
    },

    'ready-replay': {
      status: 'ready',
      ...noResume,
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
        chosenByStudent: false,
        loomerPick: null,
        change: null,
      },
      rest: [{ ...essay, replay: true }],
      lastCheck: { ...lastCheck, replay: true, courses: 1 },
    },

    'signed-out': {
      status: 'ready',
      ...noResume,
      next: {
        item: essay,
        action: 'Outline the comparison between your two sources',
        reason: 'From the last successful check. Canvas needs you to sign in again before Loomer can update.',
        evidence: essayEvidence.slice(0, 2),
        aiGenerated: true,
        chosenByStudent: false,
        loomerPick: null,
        change: null,
      },
      rest: [vocab, reflection],
      lastCheck: { ...lastCheck, outcome: 'auth-expired', at: new Date(now.getTime() - 26 * HOUR).toISOString() },
    },

    empty: {
      status: 'empty',
      ...noResume,
      rest: [reading],
      lastCheck,
    },

    resume: {
      status: 'ready',
      next: readyNext,
      rest: [vocab, reflection, lab],
      lastCheck,
      resume: essayResume(false),
      olderReview: null,
      crowded: null,
      brief: null,
      room: [],
      yourChanges: [],
    },

    'resume-changed': {
      status: 'ready',
      next: {
        item: vocab,
        action: 'Finish the Ch. 6 vocabulary check',
        reason: 'It is due soon and short. The essay is still due this week.',
        evidence: [
          {
            kind: 'school-fact',
            text: `Due ${dateTime(vocab.due?.at ?? checkedAt)}.`,
            sourceLabel: 'Canvas assignment',
            sourceUrl: vocab.url ?? undefined,
            observedAt: checkedAt,
          },
        ],
        aiGenerated: true,
        chosenByStudent: false,
        loomerPick: null,
        change: 'Moved up: the vocab check is due before the essay needs its start.',
      },
      rest: [essay, reflection, lab],
      lastCheck,
      resume: essayResume(true),
      olderReview: null,
      crowded: null,
      brief: null,
      room: [],
      yourChanges: [],
    },

    'your-pick': {
      status: 'ready',
      ...noResume,
      next: {
        item: essay,
        action: 'Outline the comparison between your two sources',
        reason: 'You picked this one. Loomer keeps it until something changes.',
        evidence: essayEvidence.slice(0, 2),
        aiGenerated: true,
        chosenByStudent: true,
        loomerPick: { item: vocab, reason: `It’s due ${dateTime(vocab.due?.at ?? checkedAt)} and it’s short.` },
        change: null,
      },
      rest: [vocab, reflection, lab],
      lastCheck,
    },

    'older-review': {
      status: 'ready',
      room: [],
      yourChanges: [],
      resume: null,
      crowded: null,
      brief: null,
      olderReview: {
        items: [
          { item: pastQuiz, reason: 'Canvas still shows it as not turned in.' },
          {
            item: item(now, {
              assignmentId: 'a-old-lab',
              title: 'Lab 2.1 Density of Common Liquids: Data and Conclusion',
              courseName: 'Chemistry',
              due: { at: at(now, -9, 23, 59), source: 'canvas' },
            }),
            reason: 'Canvas marks it missing.',
          },
        ],
      },
      next: readyNext,
      rest: [vocab, reflection, lab, pastQuiz],
      lastCheck,
    },

    // Stress case: a long action, long titles, 55 items, Loomer's own pick, older
    // work, and a resume briefing for the same assignment as the next step.
    busy: {
      status: 'ready',
      room: [],
      yourChanges: [],
      resume: essayResume(false),
      crowded,
      brief,
      olderReview: {
        items: [
          { item: pastQuiz, reason: 'Canvas still shows it as not turned in.' },
          {
            item: item(now, {
              assignmentId: 'a-old-2',
              title: 'Unit 2 Reflection: How the Internet Works, Packets, Routing, and the Domain Name System',
              courseName: 'AP Computer Science Principles',
              due: { at: at(now, -11, 23, 59), source: 'canvas' },
            }),
            reason: 'Canvas marks it missing.',
          },
        ],
      },
      next: {
        item: { ...essay, title: 'Unit 4 Synthesis Essay: Urban Heat Islands and the Ethics of Municipal Tree Canopy Investment' },
        action: 'Outline how the EPA data and the city canopy report disagree about which neighborhoods heat up first and why',
        reason: 'You picked this one. Loomer keeps it until something changes.',
        evidence: essayEvidence.slice(0, 2),
        aiGenerated: true,
        chosenByStudent: true,
        loomerPick: { item: vocab, reason: 'It’s due soon and it’s short.' },
        change: null,
      },
      rest: Array.from({ length: 55 }, (_, i) =>
        item(now, {
          assignmentId: `bulk-${i}`,
          title: [
            'Lab 3.2 Stoichiometry of Baking Soda and Vinegar: Pre-Lab Questions and Data Table Setup',
            'Problem Set 2.4: Rational Functions, Asymptotes, and End Behavior (odd problems 1 to 39)',
            'Lectura: La casa en Mango Street, capítulos 1 a 5, preguntas de comprensión',
            'Vocab quiz',
          ][i % 4]!,
          courseName: ['Honors Chemistry', 'Precalculus Honors', 'Spanish III', 'AP English Language and Composition'][i % 4],
          due: i % 5 === 4 ? null : { at: at(now, (i % 13) - 1, 23, 59), source: 'canvas' },
          replay: i % 7 === 0,
        }),
      ),
      lastCheck: { ...lastCheck, courses: 10 },
    },
  } satisfies Record<string, HomeModel>;
}

export type FixtureName = keyof ReturnType<typeof buildFixtures>;

/**
 * Detail fixture for any item: the essay gets a checked draft with all three
 * requirement states; everything else has requirements but no draft check yet.
 */
export function buildDetail(item: WorkItem, now: Date): AssignmentDetailModel {
  const checked = item.assignmentId === 'a-essay';
  return {
    status: 'ok',
    item,
    descriptionExcerpt: 'Compare how two sources explain urban heat islands. Use at least three sources and cite them in MLA format.',
    requirements: [
      {
        text: 'Compare the two sources',
        source: { quote: 'Compare how two sources explain urban heat islands.', label: 'Assignment instructions' },
        state: checked ? 'observed' : 'unknown',
        evidence: checked ? { quote: 'The EPA says cities can be 7°F warmer. The city report says shaded blocks are cooler.', note: 'Found in paragraph 3' } : null,
      },
      {
        text: 'Use at least 3 sources',
        source: { quote: 'Use at least three sources.', label: 'Assignment instructions' },
        state: checked ? 'needs-review' : 'unknown',
        evidence: checked ? { quote: 'According to the EPA…', note: 'You cite 2 so far' } : null,
      },
      {
        text: 'Cite in MLA format',
        source: { quote: 'cite them in MLA format', label: 'Assignment instructions' },
        state: 'unknown',
        evidence: null,
      },
    ],
    check: checked ? { at: new Date(now.getTime() - 0.3 * HOUR).toISOString(), scope: 'full', stale: false } : null,
    checkAvailability: checked ? 'available' : item.policy.state === 'blocked' ? 'blocked' : 'no-doc',
    checkPending: false,
    effort: { label: item.effort.label, reason: item.effort.reason, quote: null },
    plainWords: checked
      ? 'Read two sources about city heat. Explain what each one says and where they agree or disagree. Then argue which explanation is stronger, using both sources.'
      : null,
    links: {
      instructions: item.url ? [item.url] : [],
      doc: checked ? 'https://docs.google.com/document/d/1xEssayDraft/edit' : null,
      sources: [],
    },
    correction: item.correction,
    note: null,
  };
}

/** A captured page waiting to be cropped. The image is a drawn stand-in, not a real capture. */
export function buildScreenshotDraft(now: Date): ScreenshotDraft {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#fff"/><rect x="80" y="60" width="700" height="34" rx="6" fill="#cfcde0"/>${[140, 180, 220].map((y) => `<rect x="80" y="${y}" width="1000" height="14" rx="7" fill="#e2e1ea"/>`).join('')}<rect x="80" y="270" width="1120" height="260" rx="12" fill="#d9d6f0"/>${[570, 610, 650, 690].map((y) => `<rect x="80" y="${y}" width="${y % 80 ? 1040 : 820}" height="14" rx="7" fill="#e2e1ea"/>`).join('')}</svg>`;
  return {
    sessionId: 1,
    assignmentId: 'a-essay',
    url: 'https://www.epa.gov/heatislands/learn-about-heat-islands',
    title: 'Learn About Heat Islands',
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    width: 1280,
    height: 800,
    at: new Date(now.getTime() - 60_000).toISOString(),
  };
}
