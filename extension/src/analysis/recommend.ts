// Builds the HomeModel from stored evidence. The order comes from the planner
// (plan.ts); AI output only supplies effort labels, checkpoints read from the
// instructions, and first-step wording.
import type { Analysis, Assignment, CollectionRun, Course, DayRoomRecord, PlanChangeRecord, ResumePacket, SheetTopicsRecord, Source, StudentContext, TopicCheckRecord } from '../core/db';
import { checkAiDispatch } from '../core/gate';
import type { AiSettings, Choice } from '../core/settings';
import type { CheckInfo, Evidence, HomeModel, NextAction, OlderReview, ResumeBriefing, WorkItem } from '../model/home';
import { assignmentPolicy, courseKey, effectiveDue, HORIZON_DAYS, inDecisionSet, isOpen, policyAnswer, type EffectiveDue } from './facts';
import type { PlanChangeView } from '../model/plan';
import { comparePlanned, crowdedWeek, dailyBrief, dueWords, keepPreviousTop, localDay, plan, rankReasons, WORKLOAD_WORDS, type LevelMinutes, type PlanEntry, type Planned, type RoomFor } from './plan';
import { roomDays, roomLookup } from './room';
import { nextTopic, topicItems } from './topicStanding';
import { isQuiz, workTypeFor } from './workType';
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
  /** Topics read from sheets, and the student's quick-check answers on them. */
  sheetTopics: SheetTopicsRecord[];
  topicChecks: TopicCheckRecord[];
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
  | DistributiveOmit<Exclude<HomeModel, { status: 'not-connected' }>, 'resume' | 'olderReview' | 'crowded' | 'brief' | 'room' | 'yourChanges'>
  | { status: 'not-connected' };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function buildHomeModel(input: RecommendInput): HomeModel {
  if (!input.connected) return { status: 'not-connected' };
  const roomFor = roomLookup(input.room);
  const ranking = rank(input, roomFor);
  const core = withTopic(input, buildCore(input, ranking));
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
  const evidence: Evidence =
    topic.mode === 'explain'
      ? { kind: 'student-context', text: topic.reason, sourceLabel: 'Your quick checks' }
      : { kind: 'ai-interpretation', text: `${t.text} is on your sheet, and you haven't checked it yet.`, quote: t.quote, sourceLabel: t.sheet ?? 'Your sheet' };
  return {
    ...core,
    next: { ...core.next, action: `${topic.mode === 'explain' ? 'Review' : 'Check'} ${topic.topic}`, aiGenerated: true, topic, evidence: [...core.next.evidence, evidence] },
  };
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
function rank(input: RecommendInput, roomFor: RoomFor): Ranking {
  const { lastRun, now } = input;
  const courseById = new Map(input.courses.map((c) => [c.id, c]));
  const contextByKey = new Map(input.context.map((c) => [c.key, c]));
  const analysisById = new Map(input.analyses.map((a) => [a.assignmentId, a]));

  const base = input.assignments
    .filter((a) => a.sourceKey === lastRun?.sourceKey && isOpen(a))
    .map((a) => candidateFor(a, { course: courseById.get(courseKey(a)), analysis: analysisById.get(a.id), context: contextByKey }, now));

  // Start-by dates and checkpoints for every visible item; only the decision set is ranked.
  const entry = (c: Candidate): PlanEntry => ({
    id: c.a.id,
    title: c.a.title,
    due: c.due.at,
    effort: c.item.effort.label,
    milestones: c.analysis?.milestones ?? [],
    keptActive: c.item.correction === 'kept-active',
    startOn: contextByKey.get(c.a.id)?.startOn ?? null,
    guessMinutes: c.item.guessMinutes,
  });
  // Room is shared by every visible start, so place them together.
  const plannedById = new Map(plan(base.filter((c) => !c.item.hidden && c.item.correction !== 'done-offline').map(entry), now, roomFor, input.levelMinutes).map((p) => [p.id, p]));
  const inDecision = (c: Candidate) =>
    !c.item.hidden && c.item.correction !== 'done-offline' && (inDecisionSet(c.a, c.due, now) || c.item.correction === 'kept-active');
  // Ranked items keep the start days placement gave them across all visible work.
  const decisionIds = new Set(base.filter(inDecision).map((c) => c.a.id));
  const rankedPlans = keepPreviousTop([...plannedById.values()].filter((p) => decisionIds.has(p.id)).sort(comparePlanned), input.snapshot?.topId ?? null);
  const reasons = rankReasons(rankedPlans);

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
      c.item.correction !== 'done-offline' &&
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
  return { topId, entries, change: moved ? { text: describeMove(prev, topId, entries), at: input.now.toISOString() } : (prev?.change ?? null) };
}

function describeMove(prev: NonNullable<PlanSnapshot>, topId: string, entries: NonNullable<PlanSnapshot>['entries']): string {
  const was = prev.entries[prev.topId!];
  const now = entries[topId]!;
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'long' }) : 'no date');
  if (!entries[prev.topId!]) return `${was?.title ?? 'Your last top item'} is off your list now, so ${now.title} is next.`;
  if (!prev.entries[topId]) return `${now.title} is new from Canvas.`;
  if (prev.entries[topId]!.due !== now.due) return `${now.title} is now due ${day(now.due)}.`;
  if (was && was.due !== entries[prev.topId!]!.due) return `${was.title} moved to ${day(entries[prev.topId!]!.due)}, so ${now.title} is next.`;
  return `${now.title} now needs to start sooner.`;
}

type CandidateInputs = { course: Course | undefined; analysis: Analysis | undefined; context: Map<string, StudentContext> };

function candidateFor(a: Assignment, { course, analysis: stored, context }: CandidateInputs, now: Date): Candidate {
  const due = effectiveDue(a, now);
  const policy = assignmentPolicy(a, course);
  const blocked = policy.state === 'blocked' || policyAnswer(a, context) === 'teacher-forbids-ai';
  // Only a current, successful analysis counts; never AI content for a blocked assignment.
  const analysis = stored?.status === 'ok' && stored.detailHash === a.detail?.hash && !blocked ? stored : null;
  const ctx = context.get(a.id);
  return { a, due, policy, analysis, item: toWorkItem(a, due, policy, analysis, blocked, ctx, now), planned: null };
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
  const candidate = candidateFor(a, { course, analysis: stored, context: contextByKey }, input.now);
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
      if (ctx?.hidden || ctx?.correction) return [];
      const c = candidateFor(a, { course: input.courses.find((x) => x.id === courseKey(a)), analysis: undefined, context: contextByKey }, input.now);
      if (c.item.bucket !== 'past') return [];
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
  const { a, item, analysis, due } = top;
  const dueText = due.at ? dueWords(due.at, now) : null;
  const reason = extra.chosenByStudent
    ? dueText
      ? `You picked this one, and it's due ${dueText}.`
      : "You picked this one, and Loomer didn't find a due date."
    : (item.rankReason ?? (dueText ? `It's due ${dueText}.` : "Loomer didn't find a due date for this one."));
  const choice = extra;

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
      text: `The instructions set an earlier step, ${lowerFirstWord(c.text)}, for ${dueWords(c.at, now)}.`,
      quote: c.quote,
      sourceLabel: 'Canvas assignment',
    });
  }

  return analysis
    ? { item, action: analysis.firstStep, reason, evidence, aiGenerated: true, topic: null, ...choice }
    : { item, action: 'Open the instructions', reason, evidence, aiGenerated: false, topic: null, ...choice };
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
    requirements: a.detail ? 'checked' : a.detailError ? 'unreadable' : 'not-checked',
    replay: a.replay,
    bucket: bucketFor(due, now),
    hidden: ctx?.hidden === true,
    correction: ctx?.correction ?? null,
    // Filled in by the planner for visible items.
    startBy: null,
    checkpoints: [],
    rankReason: null,
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

/** "Draft for peer review" mid-sentence: "draft for peer review" (a name such as "MLA" keeps its capitals). */
const lowerFirstWord = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
