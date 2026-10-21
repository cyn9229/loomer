// Typed HomeModel fixtures for visual work and review. They cover every status and
// the edge cases the UI must show honestly: replay data, a blocked AI policy, a
// due-date conflict, an undated item, and unreadable requirements. Dates are
// relative to `now` so the fixtures never expire. Opened in the side panel with
// ?fixture=<name>; the panel labels them "Fixture preview" so they are never
// mistaken for live data.
import type { ScreenshotDraft } from '../capture/screenshot';
import type { AssignmentDetailModel } from '../model/detail';
import { LEAD_DAYS } from '../analysis/plan';
import type { Checkpoint, CheckInfo, DayRoom, Evidence, HomeModel, NextAction, ResumeBriefing, SlipReason, WorkItem } from '../model/home';
import type { PlanChangeView } from '../model/plan';
import type { SourceItem } from '../model/session';
import { dateTime, ymd } from './format';
import { buildPrepFixtures } from './prepFixtures';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Spread into each connected fixture: no resume briefing, older-work review, busy-days note, or brief.
// The student's Canvas classes for the add form's class picker; keys match item() (course:<name>).
const COURSES = ['Algebra 2', 'Biology', 'English 10', 'Environmental Science (replay)', 'Health', 'Spanish III'].map((name) => ({ key: `course:${name}`, name }));
const noResume = { resume: null, olderReview: null, crowded: null, brief: null, room: [], yourChanges: [], courses: COURSES };

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

/**
 * Fourteen days of room the way the planner reports it: the next Thursday is
 * busy (one day), and every Tuesday has little room, about 30 min (the
 * student's own number). Every other day is free.
 */
export function roomFixture(now: Date): DayRoom[] {
  const days = Array.from({ length: 14 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
  const firstThu = days.find((d) => d.getDay() === 4);
  return days.map((d) => ({
    date: ymd(d),
    level: d === firstThu ? 'busy' : d.getDay() === 2 ? 'little' : 'free',
    minutes: d.getDay() === 2 ? 30 : null,
    repeating: d.getDay() === 2,
  }));
}

function item(now: Date, over: Partial<WorkItem> & Pick<WorkItem, 'assignmentId' | 'title'>): WorkItem {
  const due = over.due ?? null;
  const checkpoints = over.checkpoints ?? [];
  return {
    source: 'canvas',
    sameAsCanvas: null,
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
    workType: { type: 'writing', source: 'rule' },
    quiz: false,
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
    effort: { label: 'Substantial', reason: 'Compare two sources, build an argument, and revise.', source: 'student' },
    guessMinutes: 180,
    policy: { state: 'permitted', sourceLabel: 'Course syllabus' },
    checkpoints: [{ text: 'Draft for peer review', label: 'Draft due', at: new Date(Date.parse(essayDue) - DAY).toISOString(), quote: 'Bring a full draft for peer review the day before the final deadline.', derived: true }],
    rankReason: `The next step for this essay, draft for peer review, is due ${new Date(Date.parse(essayDue) - DAY).toLocaleDateString(undefined, { weekday: 'long' })}, so today is a good day to start.`,
  });
  const photo = item(now, {
    assignmentId: 'a-photo',
    title: 'Photosynthesis short response',
    courseName: 'Biology',
    url: 'https://lincolnhs.instructure.com/courses/1841/assignments/88310',
    due: { at: at(now, 1, 19, 59), source: 'canvas' },
    effort: { label: 'Short', reason: 'One paragraph answer.', source: 'ai' },
    rankReason: 'This short response comes second because Heat islands comparison essay needs to start first.',
  });
  const vocab = item(now, {
    assignmentId: 'a-vocab',
    title: 'Ch. 6 vocabulary check',
    courseName: 'Biology',
    url: 'https://lincolnhs.instructure.com/courses/1841/assignments/88301',
    due: { at: at(now, 2, 8, 0), source: 'canvas' },
    effort: { label: 'Short', reason: 'Twenty terms, one short quiz.', source: 'ai' },
    rankReason: `This vocabulary check is due ${new Date(at(now, 2, 8, 0)).toLocaleDateString(undefined, { weekday: 'long' })}, so tomorrow is a good day to start.`,
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
  // Work the student added by hand: a paper lab report, and a copy of the vocab check Canvas already has.
  const labReport = item(now, {
    assignmentId: 's-lab',
    title: 'Bio lab report: enzymes',
    source: 'student',
    courseName: 'Biology',
    url: null,
    due: { at: at(now, 4, 23, 59), source: 'canvas' },
    workType: { type: 'practice', source: 'student' },
    rankReason: `This lab report is due ${new Date(at(now, 4, 23, 59)).toLocaleDateString(undefined, { weekday: 'long' })}, so tomorrow is a good day to start.`,
  });
  const vocabCopy = item(now, {
    assignmentId: 's-vocab',
    title: 'Vocab check',
    source: 'student',
    courseName: 'Biology',
    url: null,
    due: { at: at(now, 2, 8, 0), source: 'canvas' },
    sameAsCanvas: { assignmentId: 'a-vocab', title: 'Ch. 6 vocabulary check' },
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
  // One of each other kind of work: a practice sheet, a reading, and a Canvas quiz (no AI help).
  const sheet = item(now, {
    assignmentId: 'a-sheet',
    title: 'Unit 6 Review Sheet: Quadratics',
    courseName: 'Algebra 2',
    due: { at: at(now, 3, 23, 59), source: 'canvas' },
    effort: { label: 'Moderate', reason: 'Twenty problems across five topics.', source: 'ai' },
    workType: { type: 'practice', source: 'ai' },
  });
  const readingCh = item(now, {
    assignmentId: 'a-lectura',
    title: 'Lectura: La casa en Mango Street, cap. 1 a 5',
    courseName: 'Spanish III',
    due: { at: at(now, 4, 15, 0), source: 'canvas' },
    effort: { label: 'Short', reason: 'Five short chapters.', source: 'ai' },
    workType: { type: 'reading', source: 'rule' },
  });
  const quizItem = item(now, {
    assignmentId: 'a-quiz',
    title: 'Unit 4 Quiz: Rational Functions',
    courseName: 'Precalculus',
    due: { at: at(now, 5, 8, 0), source: 'canvas' },
    effort: { label: 'Short', reason: null, source: 'ai' },
    workType: { type: 'practice', source: 'rule' },
    quiz: true,
  });
  // A test on paper in class with a study guide on Canvas: test prep runs on it.
  const histTest = item(now, {
    assignmentId: 'a-test',
    title: 'Unit 5 Test: Imperialism',
    courseName: 'U.S. History',
    due: { at: at(now, 1, 9, 0), source: 'canvas' },
    effort: { label: 'Moderate', reason: null, source: 'ai' },
    workType: { type: 'study', source: 'rule' },
  });
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

  // Weekday names and day counts for the insight sentences, so they match the relative dates.
  const dayName = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
  const daysAway = (iso: string) => Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);

  const readyNext: NextAction = {
    item: essay,
    action: 'Outline your comparison',
    reason: 'Connect the EPA findings to the city’s tree cover data. The rubric asks for a comparison, and the deadline is this week.',
    evidence: essayEvidence,
    aiGenerated: true,
    chosenByStudent: false,
    loomerPick: null,
    change: null,
    topic: null,
    slip: null,
    quickStart: null,
    plainWords: null,
    prep: null,
    why: `Your draft for peer review is due ${dayName(new Date(Date.parse(essayDue) - DAY).toISOString())}.`,
    insight: {
      kind: 'hidden-deadline',
      text: `Canvas says this essay is due ${dayName(essayDue)}, but the instructions ask for a draft for peer review by ${dayName(new Date(Date.parse(essayDue) - DAY).toISOString())}, so today is a good day to start.`,
      aiFound: true,
    },
  };
  const weekday = (iso: string | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short' }) : '');
  const crowded = {
    text: `${weekday(essay.startBy?.at)} and ${weekday(reflection.startBy?.at)} are busy: ${essay.title} and ${reflection.title} both need a start. Plan time for both.`,
    assignmentIds: [essay.assignmentId, reflection.assignmentId],
  };
  const brief = { date: now.toISOString().slice(0, 10), text: `1 due tomorrow; start ${essay.title} today (and 1 more).` };

  // Home after a skipped start on the essay (NextAction.slip), with the student's answer if any.
  const missedOn = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const slipped = (answer: SlipReason | null, next: Partial<NextAction>, count = 1): HomeModel => ({
    status: 'ready',
    next: { ...readyNext, slip: { assignmentId: essay.assignmentId, missedOn, count, answer }, ...next },
    rest: [vocab, reflection, lab],
    lastCheck,
    resume: null,
    olderReview: null,
    crowded: null,
    brief: null,
    room: [],
    yourChanges: [],
    courses: COURSES,
  });

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
    focus: 'Compare your two sources',
    handledHints: 2,
    nextStep: null,
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
      room: roomFixture(now),
      yourChanges: appliedChanges(now),
      next: readyNext,
      rest: [photo, vocab, sheet, replayItem, readingCh, reflection, quizItem, proposal, lab, reading, pastQuiz, hiddenItem, labReport, vocabCopy],
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
        topic: null,
        slip: null,
        quickStart: null,
        plainWords: null,
    prep: null,
        why: `${dayName(at(now, 1, 12, 0))} is busy, so this starts today.`,
        insight: { kind: 'busy-day', text: `This reflection is due ${dayName(reflection.due!.at)}, and since you said ${dayName(at(now, 1, 12, 0))} is busy, Loomer moved its start up to today.`, aiFound: false },
      },
      rest: [essay, vocab, lab],
      lastCheck,
    },

    'ready-replay': {
      status: 'ready',
      ...noResume,
      next: {
        item: replayItem,
        action: 'Fill in the data table',
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
        topic: null,
        slip: null,
        quickStart: null,
        plainWords: null,
    prep: null,
        why: `This data table is due ${dayName(replayItem.due!.at)}.`,
        insight: { kind: 'countdown', text: `This data table is due ${dayName(replayItem.due!.at)}, ${daysAway(replayItem.due!.at)} days from now, so today is a good day to start.`, aiFound: false },
      },
      rest: [{ ...essay, replay: true }],
      lastCheck: { ...lastCheck, replay: true, courses: 1 },
    },

    'signed-out': {
      status: 'ready',
      ...noResume,
      next: {
        item: essay,
        action: 'Outline your comparison',
        reason: 'From the last successful check. Canvas needs you to sign in again before Loomer can update.',
        evidence: essayEvidence.slice(0, 2),
        aiGenerated: true,
        chosenByStudent: false,
        loomerPick: null,
        change: null,
        topic: null,
        slip: null,
        quickStart: null,
        plainWords: null,
    prep: null,
        why: `This essay is due ${dayName(essayDue)}.`,
        insight: { kind: 'countdown', text: `This essay is due ${dayName(essayDue)}, ${daysAway(essayDue)} days from now, so today is a good day to start.`, aiFound: false },
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
      courses: COURSES,
    },

    'weak-topic': {
      status: 'ready',
      ...noResume,
      next: {
        item: sheet,
        action: 'Review vertex form',
        reason: 'You missed 2 of 3 on vertex form last time.',
        evidence: [],
        aiGenerated: true,
        chosenByStudent: false,
        loomerPick: null,
        change: null,
        topic: { topic: 'Vertex form', reason: 'You missed 2 of 3 on the last check.', mode: 'explain' },
        slip: null,
        quickStart: null,
        plainWords: null,
    prep: null,
        why: 'You missed 2 of 3 on vertex form last time.',
        insight: {
          kind: 'weak-topic',
          text: `You missed 2 of 3 on vertex form last time, and this review sheet is due ${dayName(sheet.due!.at)}, so start with that topic.`,
          aiFound: false,
        },
      },
      rest: [essay, vocab, reflection],
      lastCheck,
    },

    // A test with prep: today's practice step leads, with the readiness line under the card.
    'test-prep': {
      status: 'ready',
      next: {
        ...readyNext,
        item: histTest,
        action: '20 minutes on weak spots',
        aiGenerated: false,
        why: '3 topics still need work before tomorrow’s test.',
        insight: { kind: 'prep', text: 'Your diagnostic found a mix-up on Hawaii and two shaky topics, so the next 20 minutes teach and practice those before tomorrow’s test.', aiFound: false },
        prep: { assignmentId: histTest.assignmentId, kind: 'focus', minutes: 20, counts: { solid: 4, shaky: 4, unchecked: 0 }, readiness: '4 of 8 topics on this test are solid, and the Hawaii mix-up is the first thing to fix.', waiting: null },
      },
      rest: [essay, vocab, reflection],
      lastCheck,
      resume: null,
      olderReview: null,
      crowded: null,
      brief: null,
      room: [],
      yourChanges: [],
      courses: COURSES,
    },
    // Between today's sessions: the next one opens after dinner, with an optional reminder.
    'test-waiting': {
      status: 'ready',
      next: {
        ...readyNext,
        item: histTest,
        action: 'Mixed check at 7 PM',
        aiGenerated: false,
        why: 'A short check after dinner helps it stick.',
        insight: { kind: 'prep', text: 'You finished learning Hawaii, the Congo, and Latin America, so take a break, and the check after dinner helps it stick.', aiFound: false },
        prep: {
          assignmentId: histTest.assignmentId,
          kind: 'mixed-check',
          minutes: 10,
          counts: { solid: 6, shaky: 2, unchecked: 0 },
          readiness: '6 of 8 topics on this test are solid now, and Latin America still needs a check.',
          waiting: { sessionId: 's3', label: 'Next at 7:00 PM', step: 'A mixed check on those 3 topics', remindAt: at(now, 0, 19, 0), reminder: false },
        },
      },
      rest: [essay, vocab],
      lastCheck,
      resume: null,
      olderReview: null,
      crowded: null,
      brief: null,
      room: [],
      yourChanges: [],
      courses: COURSES,
    },

    // The student kept an AI-suggested step at the end of their last session: it leads under Continue.
    'kept-step': {
      status: 'ready',
      next: {
        ...readyNext,
        action: 'Compare your two sources',
        aiGenerated: true,
        why: 'Last time you added 240 words and saved 2 sources.',
        insight: { kind: 'continue', text: 'Last time you added 240 words to this essay and saved 2 sources.', aiFound: false },
      },
      rest: [vocab, reflection, lab],
      lastCheck,
      resume: { ...essayResume(false), nextStep: { text: 'Compare your two sources', aiGenerated: true } },
      olderReview: null,
      crowded: null,
      brief: null,
      room: [],
      yourChanges: [],
      courses: COURSES,
    },

    // Loomer suggested starting the essay yesterday and no session happened: named once, with the question.
    slipped: slipped(null, {
      why: 'You didn’t get to this essay yesterday.',
      insight: { kind: 'slipped', text: `You didn’t get to this essay yesterday, and it’s due ${dayName(essayDue)}, so today’s start matters more.`, aiFound: false },
    }),
    // After each answer to "What got in the way?".
    'slip-too-big': slipped('too-big', {
      action: 'List 2 ways they disagree',
      quickStart: { minutes: 10 },
      why: 'Loomer cut today’s step down to 10 minutes.',
      insight: { kind: 'slipped', text: 'You said this essay felt too big, so Loomer cut today’s step down to 10 minutes.', aiFound: false },
    }),
    'slip-not-sure': slipped('not-sure', {
      plainWords: 'Compare what your two sources say about why cities get hotter, then argue which one explains it better. Your outline only needs the main point from each source.',
      why: 'Talk it through first, then start.',
      insight: { kind: 'slipped', text: 'Here’s what this essay asks for in plain words, so you can talk it through before you start.', aiFound: false },
    }),
    'slip-no-time': slipped('no-time', {
      why: `Pick a day before it’s due ${dayName(essayDue)}.`,
      insight: { kind: 'slipped', text: `You said today has no time, so pick a day for this essay before it’s due ${dayName(essayDue)}.`, aiFound: false },
    }),
    'slip-not-feeling': slipped('not-feeling-it', {
      action: 'List 2 ways they disagree',
      quickStart: { minutes: 10 },
      why: 'Ten minutes is enough for today.',
      insight: { kind: 'slipped', text: 'Ten minutes on this essay is enough for today, and you can pick a day instead if that works better.', aiFound: false },
    }),
    // A second skipped start with 1 day left: a smaller step, no second question.
    'slip-second': slipped(
      null,
      {
        item: { ...essay, due: { at: at(now, 1, 23, 59), source: 'canvas' } },
        action: 'Write your first sentence',
        quickStart: { minutes: 10 },
        why: 'This essay is due tomorrow.',
        insight: { kind: 'slipped', text: 'This essay is due tomorrow, so a 10-minute start today keeps it from all landing on one night.', aiFound: false },
      },
      2,
    ),

    'resume-changed': {
      status: 'ready',
      next: {
        item: vocab,
        action: 'Finish the vocab check',
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
        change: 'Your vocab check is due before this essay needs to start, so it moved up.',
        topic: null,
        slip: null,
        quickStart: null,
        plainWords: null,
    prep: null,
        why: 'Your vocab check is due before this essay.',
        insight: { kind: 'change', text: 'Your vocab check is due before this essay needs to start, so it moved up.', aiFound: false },
      },
      rest: [essay, reflection, lab],
      lastCheck,
      resume: essayResume(true),
      olderReview: null,
      crowded: null,
      brief: null,
      room: [],
      yourChanges: [],
      courses: COURSES,
    },

    'your-pick': {
      status: 'ready',
      ...noResume,
      next: {
        item: essay,
        action: 'Outline your comparison',
        reason: 'You picked this one. Loomer keeps it until something changes.',
        evidence: essayEvidence.slice(0, 2),
        aiGenerated: true,
        chosenByStudent: true,
        loomerPick: { item: vocab, reason: `It’s due ${dateTime(vocab.due?.at ?? checkedAt)} and it’s short.` },
        change: null,
        topic: null,
        slip: null,
        quickStart: null,
        plainWords: null,
    prep: null,
        why: readyNext.why,
        insight: readyNext.insight,
      },
      rest: [vocab, reflection, lab],
      lastCheck,
    },

    'older-review': {
      status: 'ready',
      room: [],
      yourChanges: [],
      courses: COURSES,
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
      courses: COURSES,
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
        topic: null,
        slip: null,
        quickStart: null,
        plainWords: null,
    prep: null,
        why: `Your draft for the workshop is due ${dayName(new Date(Date.parse(essayDue) - DAY).toISOString())}.`,
        insight: {
          kind: 'hidden-deadline',
          text: `Canvas says this synthesis essay is due ${dayName(essayDue)}, but the instructions ask for a full draft for the peer review workshop by ${dayName(new Date(Date.parse(essayDue) - DAY).toISOString())}, so today is a good day to start.`,
          aiFound: true,
        },
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

/** The essay's two saved pages: the draft mentions the EPA one, not the canopy report yet. */
export function essaySources(now: Date): SourceItem[] {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  return [
    {
      id: 's-epa',
      title: 'EPA: Heat Island Effect',
      url: 'https://www.epa.gov/heatislands',
      capturedAt: ago(34),
      excerptChars: 1840,
      kind: 'page',
      image: null,
      inDraft: { used: true, matched: ['epa'] },
    },
    {
      id: 's-canopy',
      title: '2025 Tree Canopy Report',
      url: 'https://cityofexample.gov/forestry/canopy-2025',
      capturedAt: ago(6),
      excerptChars: 2210,
      kind: 'page',
      image: null,
      inDraft: { used: false, matched: [] },
    },
  ];
}

/**
 * Detail fixture for any item: the essay gets a checked draft with all three
 * requirement states; everything else has requirements but no draft check yet.
 */
export function buildDetail(item: WorkItem, now: Date): AssignmentDetailModel {
  const checked = item.assignmentId === 'a-essay';
  return {
    status: 'ok',
    item,
    prep: item.assignmentId === 'a-test' ? buildPrepFixtures(now).ready : null,
    descriptionExcerpt: 'Compare how two sources explain urban heat islands. Use at least three sources and cite them in MLA format.',
    requirements: [
      {
        text: 'Compare the two sources',
        source: { quote: 'Compare how two sources explain urban heat islands.', label: 'Assignment instructions' },
        state: checked ? 'observed' : 'unknown',
        evidence: checked ? { quote: 'The EPA says cities can be 7°F warmer. The city report says shaded blocks are cooler.', note: 'Found in paragraph 3' } : null,
        hint: checked ? { text: 'Where do the EPA numbers and the canopy report agree?', state: 'handled' } : null,
      },
      {
        text: 'Use at least 3 sources',
        source: { quote: 'Use at least three sources.', label: 'Assignment instructions' },
        state: checked ? 'needs-review' : 'unknown',
        evidence: checked ? { quote: 'According to the EPA…', note: 'You cite 2 so far' } : null,
        hint: checked ? { text: 'Find a third source on tree cover.', state: 'open' } : null,
      },
      {
        text: 'Cite in MLA format',
        source: { quote: 'cite them in MLA format', label: 'Assignment instructions' },
        state: 'unknown',
        evidence: null,
        hint: null,
      },
    ],
    check: checked ? { at: new Date(now.getTime() - 0.3 * HOUR).toISOString(), scope: 'full', stale: false } : null,
    checkAvailability: checked ? 'available' : item.policy.state === 'blocked' ? 'blocked' : 'no-doc',
    checkPending: false,
    effort: { label: item.effort.label, reason: item.effort.reason, quote: null },
    plainWords: checked
      ? 'Read two sources about city heat. Explain what each one says and where they agree or disagree. Then argue which explanation is stronger, using both sources.'
      : null,
    plainShort: checked ? 'Compare two sources on city heat, then argue which is stronger.' : null,
    links: {
      instructions: item.url ? [item.url] : [],
      doc: checked ? 'https://docs.google.com/document/d/1xEssayDraft/edit' : null,
      sources: checked ? essaySources(now) : [],
    },
    correction: item.correction,
    note: null,
    // The practice sheet's instructions embed a Doc Loomer may not read yet; the reading's embedded Doc was read.
    // Only hand-added work can be edited; workType is the student's own choice (null: Loomer guesses).
    editable:
      item.source === 'student'
        ? { title: item.title, courseKey: item.courseName ? item.courseKey : null, dueAt: item.due?.at ?? null, workType: item.workType.source === 'student' ? item.workType.type : null, instructions: null, docUrl: null }
        : null,
    // The essay asks for three sources and has two saved.
    sourceNeed: checked ? { required: 3, saved: 2, quote: 'Use at least three sources' } : null,
    sheets:
      item.assignmentId === 'a-sheet'
        ? [
            { docId: '3cSheet', url: 'https://docs.google.com/document/d/3cSheet/edit', title: 'Unit 6 Review: Quadratics', state: 'ok', topics: 4 },
            { docId: '3fSetB', url: 'https://docs.google.com/document/d/3fSetB/edit', title: 'Practice set B', state: 'needs-permission', topics: null },
          ]
        : item.assignmentId === 'a-lectura'
          ? [{ docId: '4dLectura', url: 'https://docs.google.com/document/d/4dLectura/edit', title: 'Lectura: El viaje', state: 'ok', topics: null }]
          : [],
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

/** Two changes the student applied: the busy Thursday and little-room Tuesdays, newest first. */
export function appliedChanges(now: Date): PlanChangeView[] {
  const room = roomFixture(now);
  const at = new Date(now.getTime() - 0.5 * HOUR).toISOString();
  const thu = room.find((r) => r.level === 'busy')!;
  const tue = room.filter((r) => r.level === 'little');
  return [
    {
      id: 'chg-thu',
      status: 'applied',
      preview: { lines: ['Thu: busy, no starts'], days: [{ date: thu.date, before: { ...thu, level: 'free', minutes: null }, after: thu }], moves: [] },
      createdAt: at,
      appliedAt: at,
    },
    {
      id: 'chg-tue',
      status: 'applied',
      preview: {
        lines: ['Tuesdays: little room, every week', 'About 30 min, your number'],
        days: tue.map((r) => ({ date: r.date, before: { ...r, level: 'free', minutes: null, repeating: false }, after: r })),
        moves: [],
      },
      createdAt: at,
      appliedAt: at,
    },
  ];
}
