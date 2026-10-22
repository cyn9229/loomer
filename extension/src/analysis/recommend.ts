// Builds the HomeModel from stored evidence. The order comes from the planner
// (plan.ts); AI output only supplies effort labels, checkpoints read from the
// instructions, and first-step wording.
import type { Analysis, Assignment, CollectionRun, Course, DayRoomRecord, PlanChangeRecord, PracticeRecord, PrepRecord, ResumePacket, SheetTopicsRecord, Source, StudentContext, TopicCheckRecord, TrailNoteRecord, WaitRecord } from '../core/db';
import { checkAiDispatch } from '../core/gate';
import type { AiSettings, Choice } from '../core/settings';
import type { CheckInfo, Evidence, HomeModel, Insight, NextAction, OlderReview, ResumeBriefing, WorkItem } from '../model/home';
import { assignmentPolicy, courseKey, effectiveDue, HORIZON_DAYS, inDecisionSet, isOpen, offPlan, policyAnswer, type EffectiveDue } from './facts';
import type { PlanChangeView } from '../model/plan';
import { comparePlanned, crowdedWeek, dailyBrief, dayIndex, dayWords, dueWords, keepPreviousTop, localDay, lowerFirst, plan, weekdayLong, rankReasons, WORKLOAD_WORDS, type LevelMinutes, type PlanEntry, type Planned, type RoomFor } from './plan';
import { roomDays, roomLookup } from './room';
import { readStateOf, type ReadInputs } from './read';
import { waitKey, type WaitTimes } from '../core/waits';
import { nextTopic, topicItems } from './topicStanding';
import { assignmentNoun, insightFor, weakTopicInsight } from './insight';
import { QUICK_START_MINUTES, slipInsight, slipOf, wantsQuickStart } from './slip';
import { prepStep } from '../prep/prep';
import { isQuiz, workTypeFor } from './workType';
import { sameAsCanvas } from '../session/added';
import type { PolicyResult } from './policy';

const DAY_MS = 86_400_000;
/** How long Home waits for running AI analysis before ranking without it. */
const ANALYSIS_WAIT_MS = 20_000;
/** An unchecked item whose start-by is within this many days of the top could come first. */
const COMPARE_WINDOW_DAYS = 2;
/** How long a "what moved" line stays on Home. */
const CHANGE_SHOWN_MS = 24 * 60 * 60 * 1000;

/**
 * The last plan the worker saw: the top item and each ranked item's dates and
 * title. It keeps the top steady between checks and explains why it moved.
 */
export type PlanSnapshot = {
  topId: string | null;
  entries: Record<string, { title: string; due: string | null; startBy: string | null }>;
  change: { text: string; at: string } | null;
} | null;

export type RecommendInput = {
  connected: boolean;
  assignments: Assignment[];
  courses: Course[];
  analyses: Analysis[];
  context: StudentContext[];
  ai: AiSettings;
  lastRun: CollectionRun | undefined;
  now: Date;
  /** Resume packets; the newest undismissed one becomes Home's briefing. */
  packets: ResumePacket[];
  sources: Source[];
  docUrls: Map<string, string>;
  /** An active session hides the briefing; the session banner covers it. */
  activeSession: boolean;
  /** The student's remembered choice, if any. */
  choice: Choice;
  snapshot: PlanSnapshot;
  /** Local date (YYYY-MM-DD) the student dismissed the daily brief, if any. */
  briefDismissedOn: string | null;
  /** Room the student gave days (dated, weekly, and their normal day). */
  room: DayRoomRecord[];
  /** Plan changes, for Home's "Your changes" line. */
  planChanges: PlanChangeRecord[];
  /** Minutes a "some" or "little" day gives guessed work (settings). */
  levelMinutes: LevelMinutes;
  /** AI calls running or failed, and how long each kind usually takes. */
  waits: WaitRecord[];
  waitTimes: WaitTimes;
  /** What the study trail took from each site, per session. Orders prep checks; never changes standing. */
  trailNotes: TrailNoteRecord[];
  /** Topics read from sheets, and the student's quick-check answers on them. */
  sheetTopics: SheetTopicsRecord[];
  topicChecks: TopicCheckRecord[];
  /** Local days (YYYY-MM-DD) with a work session, by assignment id. Missed starts are suggested days without one. */
  workedDays: Map<string, string[]>;
  /** Test prep records and practice runs, for Home's daily practice step. */
  preps: PrepRecord[];
  practices: PracticeRecord[];
};

/** Applied changes shown on Home, newest first. */
const YOUR_CHANGES_SHOWN = 10;

type Candidate = {
  a: Assignment;
  item: WorkItem;
  due: EffectiveDue;
  policy: PolicyResult;
  analysis: Extract<Analysis, { status: 'ok' }> | null;
  planned: Planned | null;
};

type CoreModel =
  | DistributiveOmit<Exclude<HomeModel, { status: 'not-connected' }>, 'resume' | 'olderReview' | 'crowded' | 'brief' | 'room' | 'yourChanges' | 'courses'>
  | { status: 'not-connected' };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function buildHomeModel(input: RecommendInput): HomeModel {
  if (!input.connected) return { status: 'not-connected' };
  const roomFor = roomLookup(input.room);
  const ranking = rank(input, roomFor);
  const core = withWhy(input.now, withPrep(input, withSlip(input, withNextStep(input, withTopic(input, buildCore(input, ranking))))));
  if (core.status === 'not-connected') return core;
  const next = core.status === 'ready' ? core.next.item.assignmentId : null;
  const today = localDay(input.now);
  const plannedOpen = ranking.ranked.flatMap((c) => (c.planned ? [c.planned] : []));
  return {
    ...core,
    resume: resumeBriefing(input, next),
    olderReview: olderReview(input),
    crowded: crowdedWeek(plannedOpen, input.now),
    brief: input.briefDismissedOn !== today && plannedOpen.length > 0 ? { date: today, text: dailyBrief(plannedOpen, input.now) } : null,
    room: roomDays(roomFor, today),
    courses: input.courses.filter((c) => c.sourceKey === input.lastRun?.sourceKey).map((c) => ({ key: c.id, name: c.name })).sort((x, y) => x.name.localeCompare(y.name)),
    yourChanges: input.planChanges
      .filter((c) => c.status === 'applied')
      .sort((x, y) => (y.appliedAt ?? '').localeCompare(x.appliedAt ?? ''))
      .slice(0, YOUR_CHANGES_SHOWN)
      .map(planChangeView),
  };
}

/**
 * For practice or study work with a sheet, the next step names a topic: review
 * the shakiest one, else check the first unchecked one. The reason is the
 * student's own quick-check result.
 */
function withTopic(input: RecommendInput, core: CoreModel): CoreModel {
  if (core.status !== 'ready') return core;
  const { item } = core.next;
  if (item.quiz || (item.workType.type !== 'practice' && item.workType.type !== 'study')) return core;
  const record = input.sheetTopics.find((r) => r.assignmentId === item.assignmentId);
  if (record?.status !== 'ok') return core;
  const a = input.assignments.find((x) => x.id === item.assignmentId);
  const ctx = input.context.find((c) => c.key === item.assignmentId);
  const items = topicItems(
    record,
    input.topicChecks.filter((c) => c.assignmentId === item.assignmentId),
    new Set(ctx?.topicsSkipped ?? []),
    new Map((a?.detail?.sheets ?? []).map((s) => [s.docId, s.title])),
  );
  const topic = nextTopic(items);
  if (!topic) return core;
  const t = items.find((x) => x.text === topic.topic)!;
  // A shaky topic outranks only the plain countdown (change, hidden deadline, and busy day come first).
  const weak = core.next.insight.kind === 'countdown' && a ? weakTopicInsight(a, t, effectiveDue(a, input.now), input.now) : null;
  const evidence: Evidence =
    topic.mode === 'explain'
      ? { kind: 'student-context', text: topic.reason, sourceLabel: 'Your quick checks' }
      : { kind: 'ai-interpretation', text: `${t.text} is on your sheet, and you haven't checked it yet.`, quote: t.quote, sourceLabel: t.sheet ?? 'Your sheet' };
  return {
    ...core,
    next: { ...core.next, action: `${topic.mode === 'explain' ? 'Review' : 'Check'} ${topic.topic}`, aiGenerated: true, topic, evidence: [...core.next.evidence, evidence], insight: weak ?? core.next.insight },
  };
}

/**
 * The step the student kept at the end of their last session becomes the next
 * action, and the insight says what they did then. Topic standings win for
 * practice and study, because they are newer than any kept step.
 */
function withNextStep(input: RecommendInput, core: CoreModel): CoreModel {
  if (core.status !== 'ready' || core.next.topic) return core;
  const id = core.next.item.assignmentId;
  const packet = input.packets.filter((p) => p.assignmentId === id && !p.dismissed).sort((x, y) => y.at.localeCompare(x.at))[0];
  const a = input.assignments.find((x) => x.id === id);
  if (!packet?.nextStep || !a || input.activeSession) return core;
  const insight: Insight = core.next.insight.kind === 'change' ? core.next.insight : { kind: 'continue', text: lastTime(packet, assignmentNoun(a)), aiFound: false };
  return { ...core, next: { ...core.next, action: packet.nextStep.text, aiGenerated: packet.nextStep.aiGenerated, insight } };
}

/** Home's short line under the title, from whatever decided the step: about 8 words, no topic names. */
function withWhy(now: Date, core: CoreModel): CoreModel {
  if (core.status !== 'ready') return core;
  return { ...core, next: { ...core.next, why: shortWhy(core.next, now) } };
}

function shortWhy(next: NextAction, now: Date): string {
  const due = next.item.due?.at ?? null;
  const days = due ? dayIndex(Date.parse(due)) - dayIndex(now.getTime()) : null;
  const dueLine = (): string => {
    if (!due || days === null) return "Loomer didn't find a due date.";
    if (days < 0) return `This was due ${dayWords(due, now)}.`;
    if (days === 0) return 'Due today.';
    if (days === 1) return 'Due tomorrow.';
    return days <= 6 ? `Due ${weekdayLong(due)}, in ${days} days.` : `Due ${dayWords(due, now)}.`;
  };
  if (next.prep) {
    const test = !due || days === null ? 'the test' : days === 0 ? "today's test" : days === 1 ? "tomorrow's test" : `${weekdayLong(due)}'s test`;
    if (next.prep.waiting) return `${next.prep.waiting.label}, so it sticks.`;
    if (next.prep.kind === 'diagnostic') return `Find your weak spots before ${test}.`;
    const left = next.prep.counts.shaky + next.prep.counts.unchecked;
    return left ? `${left} ${left === 1 ? 'topic still needs' : 'topics still need'} work before ${test}.` : `Everything is ready for ${test}.`;
  }
  if (next.slip) {
    switch (next.slip.answer) {
      case 'too-big':
        return 'Made smaller: just 10 minutes.';
      case 'not-feeling-it':
        return 'A small start still counts.';
      case 'not-sure':
        return "Here's what it asks for.";
      case 'no-time':
        return 'Pick a day that works.';
      case null:
        return next.slip.count > 1 ? `${dueLine().replace(/\.$/, '')}, so start small.` : 'You missed the last planned start.';
    }
  }
  switch (next.insight.kind) {
    case 'change':
      return 'Your plan changed since last time.';
    case 'continue':
      return 'Pick up where you left off.';
    case 'hidden-deadline': {
      const cp = next.item.checkpoints.find((c) => Date.parse(c.at) >= now.getTime());
      return cp ? `${cp.label} ${dayWords(cp.at, now)}.` : 'An earlier step is due first.';
    }
    case 'busy-day':
      return 'Moved up around your busy day.';
    case 'weak-topic':
      return 'Your last check found a weak spot.';
    default:
      return next.chosenByStudent ? `You picked this. ${dueLine()}` : dueLine();
  }
}

/** A test with prep: today's practice step replaces the generic next step. */
function withPrep(input: RecommendInput, core: CoreModel): CoreModel {
  if (core.status !== 'ready' || input.activeSession) return core;
  const id = core.next.item.assignmentId;
  const prep = input.preps.find((p) => p.assignmentId === id);
  const a = input.assignments.find((x) => x.id === id);
  if (!prep || !a) return core;
  const today = prepStep(prep, a, input.topicChecks.filter((c) => c.assignmentId === id), input.practices.filter((p) => p.assignmentId === id), input.trailNotes.filter((n) => n.assignmentId === id), input.now);
  if (!today) return core;
  return { ...core, next: { ...core.next, prep: today.step, action: today.action, detail: today.detail, aiGenerated: false, insight: { kind: 'prep', text: today.insight, aiFound: false }, slip: null, quickStart: null, plainWords: null } };
}

/**
 * A start Home suggested on an earlier day that didn't happen. Named once,
 * then made smaller: a 10-minute step and session after "too big" or "didn't
 * feel like it", or when it was missed more than once.
 */
function withSlip(input: RecommendInput, core: CoreModel): CoreModel {
  if (core.status !== 'ready' || input.activeSession) return core;
  const id = core.next.item.assignmentId;
  const slip = slipOf(id, input.context.find((c) => c.key === id), input.workedDays.get(id) ?? [], localDay(input.now));
  const a = input.assignments.find((x) => x.id === id);
  if (!slip || !a) return core;
  const analysis = input.analyses.find((x) => x.assignmentId === id);
  const plainWords = slip.answer === 'not-sure' && analysis?.status === 'ok' && analysis.detailHash === a.detail?.hash ? (analysis.plainWords ?? null) : null;
  const quick = wantsQuickStart(slip);
  return {
    ...core,
    next: {
      ...core.next,
      slip,
      quickStart: quick ? { minutes: QUICK_START_MINUTES } : null,
      plainWords,
      insight: slipInsight(slip, assignmentNoun(a), core.next.item.due?.at ?? null, plainWords, input.now),
    },
  };
}

/** "Last time you added 240 words to this essay and saved 2 sources." */
function lastTime(p: ResumePacket, noun: string): string {
  const words = p.wordsDelta > 0 ? `added ${p.wordsDelta} ${p.wordsDelta === 1 ? 'word' : 'words'} to ${noun}` : p.edits > 0 ? `worked on ${noun}` : null;
  const n = p.sourceIds.length;
  const sources = n > 0 ? `saved ${n} ${n === 1 ? 'source' : 'sources'}` : null;
  if (words && sources) return `Last time you ${words} and ${sources}.`;
  if (words) return `Last time you ${words}.`;
  if (sources) return `Last time you ${sources} for ${noun}.`;
  return `Last time you planned ${noun} and left yourself this step.`;
}

export function planChangeView(c: PlanChangeRecord): PlanChangeView {
  return { id: c.id, status: c.status, preview: c.preview, createdAt: c.createdAt, appliedAt: c.appliedAt };
}

type Ranking = {
  open: Candidate[];
  ranked: Candidate[];
  limitations: Evidence[];
  loomerTop: Candidate | undefined;
  chosen: Candidate | undefined;
  analysisPending: Candidate[];
  decisionCount: number;
};

/** Plans every open item, ranks the decision set, and applies calm re-ranking. */
/** What the student said about an item, in the planner's terms. */
function saidOf(ctx: StudentContext | undefined): PlanEntry['said'] {
  return {
    during: ctx?.startOn ? (ctx.startDuring ?? null) : null,
    stakes: ctx?.stakes ?? null,
    progress: ctx?.progress ?? null,
    checkpointsDone: ctx?.checkpointsDone ?? [],
    stepsDone: ctx?.stepsDone ?? 0,
  };
}

const readInputsOf = (input: RecommendInput, a: Assignment): ReadInputs => ({
  aiEnabled: input.ai.enabled,
  wait: input.waits.find((w) => w.key === waitKey('analysis', a.id)),
  times: input.waitTimes,
});

function rank(input: RecommendInput, roomFor: RoomFor): Ranking {
  const { lastRun, now } = input;
  const courseById = new Map(input.courses.map((c) => [c.id, c]));
  const contextByKey = new Map(input.context.map((c) => [c.key, c]));
  const analysisById = new Map(input.analyses.map((a) => [a.assignmentId, a]));

  const base = input.assignments
    .filter((a) => a.sourceKey === lastRun?.sourceKey && isOpen(a))
    .map((a) => candidateFor(a, { course: courseById.get(courseKey(a)), analysis: analysisById.get(a.id), context: contextByKey, read: readInputsOf(input, a) }, now));

  const canvasOpen = base.filter((c) => !c.a.addedBy).map((c) => c.a);
  for (const c of base) {
    const twin = c.a.addedBy ? sameAsCanvas(c.a, canvasOpen) : null;
    if (twin) c.item = { ...c.item, sameAsCanvas: { assignmentId: twin.id, title: twin.title } };
  }

  // Start-by dates and checkpoints for every visible item; only the decision set is ranked.
  const entry = (c: Candidate): PlanEntry => ({
    id: c.a.id,
    title: c.a.title,
    noun: assignmentNoun(c.a),
    due: c.due.at,
    effort: c.item.effort.label,
    milestones: c.analysis?.milestones ?? [],
    keptActive: c.item.correction === 'kept-active',
    startOn: contextByKey.get(c.a.id)?.startOn ?? null,
    guessMinutes: c.item.guessMinutes,
    paceDays: c.analysis?.pace?.days ?? null,
    said: saidOf(contextByKey.get(c.a.id)),
  });
  // Room is shared by every visible start, so place them together.
  const plannedById = new Map(plan(base.filter((c) => !c.item.hidden && !offPlan(c.item.correction)).map(entry), now, roomFor, input.levelMinutes).map((p) => [p.id, p]));
  const inDecision = (c: Candidate) =>
    !c.item.hidden && !offPlan(c.item.correction) && (inDecisionSet(c.a, c.due, now) || c.item.correction === 'kept-active');
  // Ranked items keep the start days placement gave them across all visible work.
  const decisionIds = new Set(base.filter(inDecision).map((c) => c.a.id));
  const rankedPlans = keepPreviousTop([...plannedById.values()].filter((p) => decisionIds.has(p.id)).sort(comparePlanned), input.snapshot?.topId ?? null);
  const reasons = rankReasons(rankedPlans, now);

  const open = base.map((c) => {
    const planned = plannedById.get(c.a.id) ?? null;
    const item: WorkItem = { ...c.item, startBy: planned?.startBy ?? null, checkpoints: planned?.checkpoints ?? [], rankReason: reasons.get(c.a.id) ?? null };
    return { ...c, item, planned };
  });
  const byId = new Map(open.map((c) => [c.a.id, c]));
  const ranked = rankedPlans.flatMap((p) => {
    const c = byId.get(p.id);
    return c ? [{ ...c, planned: p }] : [];
  });

  const analysisPending = lastRun
    ? ranked.filter(
        (c) =>
          c.a.detail &&
          !analysisById.has(c.a.id) &&
          now.getTime() - Date.parse(lastRun.finishedAt) < ANALYSIS_WAIT_MS &&
          checkAiDispatch({ aiEnabled: input.ai.enabled, policy: c.policy, answer: policyAnswer(c.a, contextByKey), purpose: 'requirements-analysis' })
            .allowed,
      )
    : [];

  // Anything unchecked that could come first blocks a confident pick.
  const top = ranked[0];
  const startAt = (c: Candidate) => (c.planned?.startBy ? Date.parse(c.planned.startBy.at) : Number.POSITIVE_INFINITY);
  const limitations: Evidence[] = top
    ? [
        ...(top.item.requirements !== 'checked' ? limitationFor(top) : []),
        ...ranked.filter((c) => c !== top && startAt(c) <= startAt(top) + COMPARE_WINDOW_DAYS * DAY_MS).flatMap((c) => limitationFor(c)),
      ]
    : [];

  // The student's choice stands until its due date or requirement text changes.
  const chosen = open.find(
    (c) =>
      c.a.id === input.choice?.assignmentId &&
      !c.item.hidden &&
      !offPlan(c.item.correction) &&
      input.choice.dueAt === c.a.dueAt &&
      input.choice.detailHash === (c.a.detail?.hash ?? null),
  );

  return { open, ranked, limitations, loomerTop: top && limitations.length === 0 ? top : undefined, chosen, analysisPending, decisionCount: ranked.length };
}

function buildCore(input: RecommendInput, r: Ranking): CoreModel {
  const { lastRun, now } = input;
  const lastCheck = lastRun ? checkInfo(lastRun) : null;
  const rest = (exclude?: Candidate) => r.open.filter((c) => c.a.id !== exclude?.a.id).map((c) => c.item).sort(byDue);

  if (!lastRun) return { status: 'checking', progress: { checked: 0, total: 0 }, pending: [], rest: rest(), lastCheck };
  if (r.analysisPending.length > 0) {
    return {
      status: 'checking',
      progress: { checked: r.decisionCount - r.analysisPending.length, total: r.decisionCount },
      pending: r.analysisPending.map((c) => ({ title: c.a.title, detail: 'Reading the instructions' })),
      rest: rest(),
      lastCheck,
    };
  }

  const change =
    input.snapshot?.change && input.snapshot.topId === r.loomerTop?.a.id && now.getTime() - Date.parse(input.snapshot.change.at) < CHANGE_SHOWN_MS
      ? input.snapshot.change.text
      : null;

  if (r.chosen) {
    const loomerPick = r.loomerTop && r.loomerTop.a.id !== r.chosen.a.id ? { item: r.loomerTop.item, reason: r.loomerTop.item.rankReason ?? '' } : null;
    return { status: 'ready', next: nextAction(r.chosen, { chosenByStudent: true, loomerPick, change: null }, now), rest: rest(r.chosen), lastCheck };
  }
  if (!r.ranked[0]) return { status: 'empty', rest: rest(), lastCheck };
  if (!r.loomerTop) return { status: 'cannot-compare', limitations: r.limitations, rest: rest(), lastCheck };
  return { status: 'ready', next: nextAction(r.loomerTop, { chosenByStudent: false, loomerPick: null, change }, now), rest: rest(r.loomerTop), lastCheck };
}

/**
 * The worker's view of the plan after each check: the current top plus a
 * plain-words line when the top moved, saying why.
 */
export function nextPlanSnapshot(input: RecommendInput, prev: PlanSnapshot): PlanSnapshot {
  if (!input.connected) return prev;
  const r = rank({ ...input, snapshot: prev }, roomLookup(input.room));
  const top = r.loomerTop;
  const entries: NonNullable<PlanSnapshot>['entries'] = {};
  for (const c of r.ranked) entries[c.a.id] = { title: c.a.title, due: c.due.at, startBy: c.planned?.startBy?.at ?? null };
  const topId = top?.a.id ?? null;
  const moved = prev?.topId && topId && prev.topId !== topId;
  return { topId, entries, change: moved ? { text: describeMove(prev, topId, entries, assignmentNoun(top!.a)), at: input.now.toISOString() } : (prev?.change ?? null) };
}

/** Why the top moved, naming both assignments: "Your teacher moved Lab 4 to Friday, so this essay is first now." */
function describeMove(prev: NonNullable<PlanSnapshot>, topId: string, entries: NonNullable<PlanSnapshot>['entries'], noun: string): string {
  const was = prev.entries[prev.topId!];
  const now = entries[topId]!;
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'long' }) : 'no date');
  if (!entries[prev.topId!]) return `${was?.title ?? 'Your last top item'} is off your list now, so ${noun} is first.`;
  if (!prev.entries[topId]) return `${now.title} is new from Canvas and needs to start first.`;
  if (prev.entries[topId]!.due !== now.due) return `${now.title} is now due ${day(now.due)}, so Loomer moved ${noun} to the top.`;
  if (was && was.due !== entries[prev.topId!]!.due) return `Your teacher moved ${was.title} to ${day(entries[prev.topId!]!.due)}, so ${noun} is first now.`;
  return `${now.title} now needs to start sooner, so Loomer moved ${noun} to the top.`;
}

type CandidateInputs = { course: Course | undefined; analysis: Analysis | undefined; context: Map<string, StudentContext>; read: ReadInputs };

function candidateFor(a: Assignment, { course, analysis: stored, context, read }: CandidateInputs, now: Date): Candidate {
  const due = effectiveDue(a, now);
  const policy = assignmentPolicy(a, course);
  const blocked = policy.state === 'blocked' || policyAnswer(a, context) === 'teacher-forbids-ai';
  // Only a current, successful analysis counts; never AI content for a blocked assignment.
  const analysis = stored?.status === 'ok' && stored.detailHash === a.detail?.hash && !blocked ? stored : null;
  const ctx = context.get(a.id);
  const readState = readStateOf(a, stored, policy, policyAnswer(a, context), due, read, now);
  return { a, due, policy, analysis, item: { ...toWorkItem(a, due, policy, analysis, blocked, ctx, now), read: readState }, planned: null };
}

/** The WorkItem for one assignment, built with the same rules Home uses. */
export function workItemFor(a: Assignment, inputs: CandidateInputs, now: Date): WorkItem {
  return candidateFor(a, inputs, now).item;
}

function resumeBriefing(input: RecommendInput, nextAssignmentId: string | null): ResumeBriefing | null {
  if (input.activeSession) return null;
  const packet = input.packets.filter((p) => !p.dismissed).sort((x, y) => y.at.localeCompare(x.at))[0];
  const a = packet && input.assignments.find((x) => x.id === packet.assignmentId);
  if (!packet || !a || !isOpen(a)) return null;

  const contextByKey = new Map(input.context.map((c) => [c.key, c]));
  const stored = input.analyses.find((x) => x.assignmentId === a.id);
  const course = input.courses.find((c) => c.id === courseKey(a));
  const candidate = candidateFor(a, { course, analysis: stored, context: contextByKey, read: readInputsOf(input, a) }, input.now);
  const sources = input.sources.filter((src) => packet.sourceIds.includes(src.id));

  const facts: string[] = [];
  if (packet.edits > 0) {
    const times = `${packet.edits} ${packet.edits === 1 ? 'time' : 'times'}`;
    const delta = Math.abs(packet.wordsDelta);
    const words = packet.wordsDelta === 0 ? '' : ` and ${packet.wordsDelta > 0 ? 'added' : 'cut'} ${delta} ${delta === 1 ? 'word' : 'words'}`;
    facts.push(`You edited your draft ${times}${words}.`);
  }
  if (sources.length > 0) facts.push(`You saved ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}.`);
  if (facts.length === 0) facts.push("You didn't edit or save anything last time.");

  return {
    assignment: candidate.item,
    at: packet.at,
    facts,
    sources: sources.map((src) => ({ title: src.title, url: src.url })),
    docUrl: packet.docId ? (input.docUrls.get(a.id) ?? null) : null,
    requirements: candidate.analysis?.deliverables ?? [],
    recommendationChanged: nextAssignmentId !== null && nextAssignmentId !== a.id,
    focus: packet.focus ?? null,
    handledHints: packet.handledHints ?? 0,
    nextStep: packet.nextStep ?? null,
  };
}

/**
 * Unresolved past-due work for one quiet review. Past due alone is not "missing":
 * the reason says only what is known. An item comes back after review only if
 * Canvas newly marks it missing.
 */
function olderReview(input: RecommendInput): OlderReview {
  const contextByKey = new Map(input.context.map((c) => [c.key, c]));
  const items = input.assignments
    .filter((a) => a.sourceKey === input.lastRun?.sourceKey && isOpen(a))
    .flatMap((a) => {
      const ctx = contextByKey.get(a.id);
      if (ctx?.hidden || (ctx?.correction && ctx.correction !== 'turned-in')) return [];
      const c = candidateFor(a, { course: input.courses.find((x) => x.id === courseKey(a)), analysis: undefined, context: contextByKey, read: readInputsOf(input, a) }, input.now);
      if (c.item.bucket !== 'past') return [];
      // Turned in, but Canvas still shows no submission a day after the due date.
      if (ctx?.correction === 'turned-in') {
        // Hand-added work has no Canvas submission to wait for.
        const late = !a.addedBy && !ctx.olderReview && Date.parse(c.due.at!) + DAY_MS < input.now.getTime();
        return late ? [{ item: c.item, reason: `You said you turned in ${assignmentNoun(a)}, but Canvas doesn't show it yet, so check that it went through.` }] : [];
      }
      const missingNow = a.submission?.missing === true;
      if (!ctx?.olderReview) return [{ item: c.item, reason: missingNow ? 'Canvas marks this one missing.' : `This was due ${dueWords(c.due.at!, input.now)}.` }];
      if (missingNow && !ctx.olderReview.missing) return [{ item: c.item, reason: 'Canvas now marks this one missing.' }];
      return [];
    })
    .slice(0, 8);
  return items.length ? { items } : null;
}

function limitationFor(c: Candidate): Evidence[] {
  const out: Evidence[] = [];
  if (c.item.requirements === 'unreadable' || c.item.requirements === 'not-checked') {
    out.push({ kind: 'limitation', text: `Loomer couldn't read the instructions for ${c.a.title}.`, sourceLabel: 'Canvas', sourceUrl: c.a.url ?? undefined });
  }
  if (c.due.conflict) {
    out.push({
      kind: 'limitation',
      text: `${c.a.title}'s instructions list a different due date than Canvas.`,
      quote: c.due.instructionDates.at(-1)?.quote,
      sourceLabel: 'Assignment instructions',
      sourceUrl: c.a.url ?? undefined,
    });
  }
  return out;
}

function nextAction(top: Candidate, extra: Pick<NextAction, 'chosenByStudent' | 'loomerPick' | 'change'>, now: Date): NextAction {
  const { a, item, analysis, due, planned } = top;
  const dueText = due.at ? dueWords(due.at, now) : null;
  const noun = assignmentNoun(a);
  const reason = extra.chosenByStudent
    ? dueText
      ? `You picked ${noun}, and it's due ${dueText}.`
      : `You picked ${noun}, and Loomer didn't find a due date.`
    : (item.rankReason ?? (dueText ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} is due ${dueText}.` : `Loomer didn't find a due date for ${noun}.`));
  const choice = { ...extra, insight: insightFor({ a, planned, due, change: extra.change, now }) };

  const evidence: Evidence[] = [
    !due.at
      ? { kind: 'limitation', text: "Loomer didn't find a due date in Canvas or the instructions.", sourceLabel: 'Canvas assignment', sourceUrl: a.url ?? undefined }
      : due.source === 'instructions'
      ? { kind: 'school-fact', text: `The instructions say it's due ${dueText}.`, quote: due.instructionDates[0]?.quote, sourceLabel: 'Assignment instructions', sourceUrl: a.url ?? undefined }
      : { kind: 'school-fact', text: `Canvas says it's due ${dueText}.`, sourceLabel: 'Canvas assignment', sourceUrl: a.url ?? undefined, observedAt: a.lastSeenAt },
  ];
  if (item.effort.source === 'student') {
    evidence.push({ kind: 'student-context', text: `You set this as ${WORKLOAD_WORDS[item.effort.label].toLowerCase()}.`, sourceLabel: 'Your change' });
  }
  if (analysis) {
    evidence.push({ kind: 'ai-interpretation', text: `${WORKLOAD_WORDS[analysis.effort]}: ${analysis.effortReason.text}`, quote: analysis.effortReason.quote || undefined, sourceLabel: 'Canvas assignment' });
    for (const d of analysis.deliverables) evidence.push({ kind: 'ai-interpretation', text: d.text, quote: d.quote, sourceLabel: 'Canvas assignment' });
  } else {
    evidence.push({ kind: 'limitation', text: "Loomer can't tell how big this is because AI hasn't read the instructions.", sourceLabel: 'Loomer' });
  }
  for (const c of item.checkpoints) {
    evidence.push({
      kind: 'ai-interpretation',
      text: `The instructions set an earlier step, ${lowerFirst(c.text)}, for ${dueWords(c.at, now)}.`,
      quote: c.quote,
      sourceLabel: 'Canvas assignment',
    });
  }

  return analysis
    ? { item, action: analysis.firstStep, reason, evidence, aiGenerated: true, topic: null, slip: null, quickStart: null, plainWords: null, prep: null, why: '', detail: analysis.plainShort || null, ...choice }
    : { item, action: 'Open the instructions', reason, evidence, aiGenerated: false, topic: null, slip: null, quickStart: null, plainWords: null, prep: null, why: '', detail: null, ...choice };
}

function toWorkItem(
  a: Assignment,
  due: EffectiveDue,
  policy: PolicyResult,
  analysis: Candidate['analysis'],
  blocked: boolean,
  ctx: StudentContext | undefined,
  now: Date,
): WorkItem {
  return {
    assignmentId: a.id,
    title: a.title,
    source: a.addedBy ? 'student' : 'canvas',
    sameAsCanvas: null,
    courseKey: courseKey(a),
    courseName: a.courseName,
    url: a.url,
    due: due.at && due.source ? { at: due.at, source: due.source } : null,
    dueConflict: due.conflict,
    effort: ctx?.workload
      ? { label: ctx.workload, reason: null, source: 'student' }
      : analysis
        ? { label: analysis.effort, reason: analysis.effortReason.text, source: 'ai' }
        : { label: 'Unknown', reason: null, source: 'ai' },
    guessMinutes: ctx?.guessMinutes ?? null,
    workType: workTypeFor(a, analysis, ctx),
    quiz: isQuiz(a),
    policy: {
      state: blocked ? 'blocked' : policy.state,
      quote: policy.finding?.quote,
      sourceLabel: policy.finding?.sourceLabel,
    },
    // Hand-added work has what the student gave it; nothing more is waiting to be read.
    requirements: a.detail || a.addedBy ? 'checked' : a.detailError ? 'unreadable' : 'not-checked',
    replay: a.replay,
    bucket: bucketFor(due, now),
    hidden: ctx?.hidden === true,
    correction: ctx?.correction ?? null,
    // Filled in by the planner for visible items.
    startBy: null,
    checkpoints: [],
    rankReason: null,
    read: null,
  };
}

function bucketFor(due: EffectiveDue, now: Date): WorkItem['bucket'] {
  if (!due.at) return 'no-date';
  const t = Date.parse(due.at);
  if (t < now.getTime()) return 'past';
  return t <= now.getTime() + HORIZON_DAYS * DAY_MS ? 'soon' : 'later';
}

function checkInfo(run: CollectionRun): CheckInfo {
  return {
    at: run.finishedAt,
    outcome: run.outcome,
    courses: run.coverage.courses,
    partial: run.outcome === 'partial' || run.coverage.plannerTruncated,
    replay: run.origin ? new URL(run.origin).protocol === 'http:' : false,
  };
}

function byDue(x: WorkItem, y: WorkItem): number {
  if (!x.due) return y.due ? 1 : 0;
  if (!y.due) return -1;
  return Date.parse(x.due.at) - Date.parse(y.due.at);
}

