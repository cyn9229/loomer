// Builds the HomeModel from stored evidence with inspectable rules. AI output
// only supplies effort labels and first-step wording; the order is computed here.
import type { Analysis, Assignment, CollectionRun, Course, ResumePacket, Source, StudentContext } from '../core/db';
import { checkAiDispatch } from '../core/gate';
import type { AiSettings, Choice } from '../core/settings';
import type { CheckInfo, EffortLabel, Evidence, HomeModel, NextAction, OlderReview, ResumeBriefing, WorkItem } from '../model/home';
import { assignmentPolicy, courseKey, effectiveDue, HORIZON_DAYS, inDecisionSet, isOpen, policyAnswer, type EffectiveDue } from './facts';
import type { PolicyResult } from './policy';

const DAY_MS = 86_400_000;
/** Days of lead time per effort label. A starting rule, not a duration estimate. */
const LEAD_DAYS: Record<EffortLabel, number> = { Short: 0.5, Moderate: 2, Substantial: 4, Unknown: 2 };
/** How long Home waits for running AI analysis before ranking without it. */
const ANALYSIS_WAIT_MS = 20_000;

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
};

type Candidate = { a: Assignment; item: WorkItem; due: EffectiveDue; policy: PolicyResult; analysis: Extract<Analysis, { status: 'ok' }> | null };

type CoreModel = DistributiveOmit<Exclude<HomeModel, { status: 'not-connected' }>, 'resume' | 'olderReview'> | { status: 'not-connected' };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function buildHomeModel(input: RecommendInput): HomeModel {
  const core = buildCore(input);
  if (core.status === 'not-connected') return core;
  const next = core.status === 'ready' ? core.next.item.assignmentId : null;
  return { ...core, resume: resumeBriefing(input, next), olderReview: olderReview(input) };
}

function buildCore(input: RecommendInput): CoreModel {
  const { connected, lastRun, now } = input;
  if (!connected) return { status: 'not-connected' };
  const lastCheck = lastRun ? checkInfo(lastRun) : null;

  const courseById = new Map(input.courses.map((c) => [c.id, c]));
  const contextByKey = new Map(input.context.map((c) => [c.key, c]));
  const analysisById = new Map(input.analyses.map((a) => [a.assignmentId, a]));
  const sourceKey = lastRun?.sourceKey;

  const open: Candidate[] = input.assignments
    .filter((a) => a.sourceKey === sourceKey && isOpen(a))
    .map((a) => candidateFor(a, { course: courseById.get(courseKey(a)), analysis: analysisById.get(a.id), context: contextByKey }, now));

  // Hidden and done-offline items leave ranking; kept-active items join it even outside the window.
  const decision = open.filter(
    (c) => !c.item.hidden && c.item.correction !== 'done-offline' && (inDecisionSet(c.a, c.due, now) || c.item.correction === 'kept-active'),
  );
  const rankDue = (c: Candidate) => (c.due.at ? Date.parse(c.due.at) : now.getTime() + HORIZON_DAYS * DAY_MS);
  const latestStart = (c: Candidate) => rankDue(c) - LEAD_DAYS[c.analysis?.effort ?? 'Unknown'] * DAY_MS;
  // The student's choice stands until its due date or requirement text changes.
  const chosen = open.find(
    (c) =>
      c.a.id === input.choice?.assignmentId &&
      !c.item.hidden &&
      c.item.correction !== 'done-offline' &&
      input.choice.dueAt === c.a.dueAt &&
      input.choice.detailHash === (c.a.detail?.hash ?? null),
  );
  const rest = (exclude?: Candidate) => open.filter((c) => c !== exclude).map((c) => c.item).sort(byDue);

  if (!lastRun) {
    return { status: 'checking', progress: { checked: 0, total: 0 }, pending: [], rest: rest(), lastCheck };
  }

  // Wait briefly for analysis that is allowed and running, then rank without it.
  const analysisPending = decision.filter(
    (c) =>
      c.a.detail &&
      !analysisById.has(c.a.id) &&
      now.getTime() - Date.parse(lastRun.finishedAt) < ANALYSIS_WAIT_MS &&
      checkAiDispatch({ aiEnabled: input.ai.enabled, policy: c.policy, answer: policyAnswer(c.a, contextByKey), purpose: 'requirements-analysis' })
        .allowed,
  );
  if (analysisPending.length > 0) {
    return {
      status: 'checking',
      progress: { checked: decision.length - analysisPending.length, total: decision.length },
      pending: analysisPending.map((c) => ({ title: c.a.title, detail: 'Reading requirements' })),
      rest: rest(),
      lastCheck,
    };
  }

  const ranked = [...decision].sort((x, y) => latestStart(x) - latestStart(y) || rankDue(x) - rankDue(y));
  const top = ranked[0];

  // Anything that could come first but was not checked blocks a confident pick.
  const limitations: Evidence[] = top
    ? [
        ...(top.item.requirements !== 'checked' ? limitationFor(top) : []),
        ...decision.filter((c) => c !== top && rankDue(c) <= rankDue(top) + LEAD_DAYS.Substantial * DAY_MS).flatMap((c) => limitationFor(c)),
      ]
    : [];
  const loomerTop = top && limitations.length === 0 ? top : undefined;

  if (chosen) {
    const loomerPick = loomerTop && loomerTop !== chosen ? { item: loomerTop.item, reason: pickReason(loomerTop, ranked[1]) } : null;
    return { status: 'ready', next: nextAction(chosen, undefined, { chosenByStudent: true, loomerPick }), rest: rest(chosen), lastCheck };
  }
  if (!top) return { status: 'empty', rest: rest(), lastCheck };
  if (!loomerTop) return { status: 'cannot-compare', limitations, rest: rest(), lastCheck };
  return { status: 'ready', next: nextAction(top, ranked[1], { chosenByStudent: false, loomerPick: null }), rest: rest(top), lastCheck };
}

type CandidateInputs = { course: Course | undefined; analysis: Analysis | undefined; context: Map<string, StudentContext> };

function candidateFor(a: Assignment, { course, analysis: stored, context }: CandidateInputs, now: Date): Candidate {
  const due = effectiveDue(a, now);
  const policy = assignmentPolicy(a, course);
  const blocked = policy.state === 'blocked' || policyAnswer(a, context) === 'teacher-forbids-ai';
  // Only a current, successful analysis counts; never AI content for a blocked assignment.
  const analysis = stored?.status === 'ok' && stored.detailHash === a.detail?.hash && !blocked ? stored : null;
  const ctx = context.get(a.id);
  return { a, due, policy, analysis, item: toWorkItem(a, due, policy, analysis, blocked, ctx, now) };
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
    const words = packet.wordsDelta === 0 ? '' : ` (${packet.wordsDelta > 0 ? '+' : '−'}${Math.abs(packet.wordsDelta)} words)`;
    facts.push(`Edited your draft ${packet.edits} ${packet.edits === 1 ? 'time' : 'times'}${words}`);
  }
  if (sources.length > 0) facts.push(`Saved ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`);
  if (facts.length === 0) facts.push('No edits or saved sources were recorded in that session.');

  return {
    assignment: candidate.item,
    at: packet.at,
    facts,
    sources: sources.map((src) => ({ title: src.title, url: src.url })),
    docUrl: packet.docId ? (input.docUrls.get(a.id) ?? null) : null,
    requirements: candidate.analysis?.deliverables ?? [],
    recommendationChanged: nextAssignmentId !== null && nextAssignmentId !== a.id,
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
      if (!ctx?.olderReview) return [{ item: c.item, reason: missingNow ? 'Canvas marks this missing.' : `The deadline passed on ${formatDue(c.due.at!)}.` }];
      if (missingNow && !ctx.olderReview.missing) return [{ item: c.item, reason: 'Canvas now marks this missing.' }];
      return [];
    })
    .slice(0, 8);
  return items.length ? { items } : null;
}

function limitationFor(c: Candidate): Evidence[] {
  const out: Evidence[] = [];
  if (c.item.requirements === 'unreadable' || c.item.requirements === 'not-checked') {
    out.push({ kind: 'limitation', text: `Loomer could not read the instructions for "${c.a.title}".`, sourceLabel: 'Canvas', sourceUrl: c.a.url ?? undefined });
  }
  if (c.due.conflict) {
    out.push({
      kind: 'limitation',
      text: `"${c.a.title}" has a due date in its instructions that differs from Canvas.`,
      quote: c.due.instructionDates.at(-1)?.quote,
      sourceLabel: 'Assignment instructions',
      sourceUrl: c.a.url ?? undefined,
    });
  }
  return out;
}

/** Why Loomer ranks this first, in one source-backed sentence. */
function pickReason(top: Candidate, runnerUp: Candidate | undefined): string {
  if (!top.due.at) return 'You kept this active.';
  const dueText = formatDue(top.due.at);
  const effort = top.analysis?.effort ?? 'Unknown';
  return runnerUp?.due.at && Date.parse(runnerUp.due.at) < Date.parse(top.due.at)
    ? `${runnerUp.a.title} is due sooner, but this needs more lead time (${effort.toLowerCase()} effort, ${dueText}).`
    : `Due ${dueText}, the soonest of your checked work.`;
}

function nextAction(
  top: Candidate,
  runnerUp: Candidate | undefined,
  choice: Pick<NextAction, 'chosenByStudent' | 'loomerPick'>,
): NextAction {
  const { a, item, analysis, due } = top;
  const dueText = due.at ? formatDue(due.at) : 'no due date';
  const reason = choice.chosenByStudent ? `You chose this. ${due.at ? `Due ${dueText}.` : 'No due date found.'}` : pickReason(top, runnerUp);

  const evidence: Evidence[] = [
    !due.at
      ? { kind: 'limitation', text: 'No due date was found in Canvas or the instructions.', sourceLabel: 'Canvas assignment', sourceUrl: a.url ?? undefined }
      : due.source === 'instructions'
      ? { kind: 'school-fact', text: `Due ${dueText}, from the instructions.`, quote: due.instructionDates[0]?.quote, sourceLabel: 'Assignment instructions', sourceUrl: a.url ?? undefined }
      : { kind: 'school-fact', text: `Due ${dueText}.`, sourceLabel: 'Canvas assignment', sourceUrl: a.url ?? undefined, observedAt: a.lastSeenAt },
  ];
  if (analysis) {
    evidence.push({ kind: 'ai-interpretation', text: `${analysis.effort}: ${analysis.effortReason.text}`, quote: analysis.effortReason.quote || undefined, sourceLabel: 'Canvas assignment' });
    for (const d of analysis.deliverables) evidence.push({ kind: 'ai-interpretation', text: d.text, quote: d.quote, sourceLabel: 'Canvas assignment' });
    for (const m of analysis.milestones) evidence.push({ kind: 'ai-interpretation', text: m.text, quote: m.quote, sourceLabel: 'Canvas assignment' });
  } else {
    evidence.push({ kind: 'limitation', text: 'Effort is unknown. AI analysis is off or unavailable for this assignment.', sourceLabel: 'Loomer' });
  }
  if (runnerUp?.due.at) {
    evidence.push({ kind: 'school-fact', text: `Next: ${runnerUp.a.title}, due ${formatDue(runnerUp.due.at)}.`, sourceLabel: 'Canvas assignment', sourceUrl: runnerUp.a.url ?? undefined });
  }

  return analysis
    ? { item, action: analysis.firstStep, reason, evidence, aiGenerated: true, ...choice }
    : { item, action: 'Open the instructions', reason, evidence, aiGenerated: false, ...choice };
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
    effort: analysis ? { label: analysis.effort, reason: analysis.effortReason.text } : { label: 'Unknown', reason: null },
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

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
