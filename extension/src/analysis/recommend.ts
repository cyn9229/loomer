// Builds the HomeModel from stored evidence with inspectable rules. AI output
// only supplies effort labels and first-step wording; the order is computed here.
import type { Analysis, Assignment, CollectionRun, Course, StudentContext } from '../core/db';
import { checkAiDispatch } from '../core/gate';
import type { AiSettings } from '../core/settings';
import type { CheckInfo, EffortLabel, Evidence, HomeModel, NextAction, WorkItem } from '../model/home';
import { assignmentPolicy, courseKey, effectiveDue, HORIZON_DAYS, inDecisionSet, isOpen, policyAnswer, type EffectiveDue } from './facts';
import type { PolicyResult } from './policy';

const DAY_MS = 86_400_000;
/** Days of lead time per effort label. A starting rule, not a duration estimate. */
const LEAD_DAYS: Record<EffortLabel, number> = { Short: 0.5, Moderate: 2, Substantial: 4, Unknown: 2 };
/** How long Home waits for running AI analysis before ranking without it. */
const ANALYSIS_WAIT_MS = 60_000;

export type RecommendInput = {
  connected: boolean;
  assignments: Assignment[];
  courses: Course[];
  analyses: Analysis[];
  context: StudentContext[];
  ai: AiSettings;
  lastRun: CollectionRun | undefined;
  now: Date;
};

type Candidate = { a: Assignment; item: WorkItem; due: EffectiveDue; policy: PolicyResult; analysis: Extract<Analysis, { status: 'ok' }> | null };

export function buildHomeModel(input: RecommendInput): HomeModel {
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

  // Hiding an item takes it out of ranking too; the student decides what they work on.
  const decision = open.filter((c) => !c.item.hidden && inDecisionSet(c.a, c.due, now));
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

  if (decision.length === 0) return { status: 'empty', rest: rest(), lastCheck };

  const ranked = [...decision].sort((x, y) => latestStart(x) - latestStart(y) || Date.parse(x.due.at!) - Date.parse(y.due.at!));
  const top = ranked[0]!;

  // Anything that could come first but was not checked blocks a confident pick.
  const topDue = Date.parse(top.due.at!);
  const limitations: Evidence[] = decision
    .filter((c) => c !== top && Date.parse(c.due.at!) <= topDue + LEAD_DAYS.Substantial * DAY_MS)
    .flatMap((c) => limitationFor(c));
  if (top.item.requirements !== 'checked') limitations.unshift(...limitationFor(top));
  if (limitations.length > 0) return { status: 'cannot-compare', limitations, rest: rest(), lastCheck };

  return { status: 'ready', next: nextAction(top, ranked[1]), rest: rest(top), lastCheck };
}

type CandidateInputs = { course: Course | undefined; analysis: Analysis | undefined; context: Map<string, StudentContext> };

function candidateFor(a: Assignment, { course, analysis: stored, context }: CandidateInputs, now: Date): Candidate {
  const due = effectiveDue(a, now);
  const policy = assignmentPolicy(a, course);
  const blocked = policy.state === 'blocked' || policyAnswer(a, context) === 'teacher-forbids-ai';
  // Only a current, successful analysis counts; never AI content for a blocked assignment.
  const analysis = stored?.status === 'ok' && stored.detailHash === a.detail?.hash && !blocked ? stored : null;
  const hidden = context.get(a.id)?.hidden === true;
  return { a, due, policy, analysis, item: toWorkItem(a, due, policy, analysis, blocked, hidden, now) };
}

/** The WorkItem for one assignment, built with the same rules Home uses. */
export function workItemFor(a: Assignment, inputs: CandidateInputs, now: Date): WorkItem {
  return candidateFor(a, inputs, now).item;
}

function latestStart(c: Candidate): number {
  return Date.parse(c.due.at!) - LEAD_DAYS[c.analysis?.effort ?? 'Unknown'] * DAY_MS;
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

function nextAction(top: Candidate, runnerUp: Candidate | undefined): NextAction {
  const { a, item, analysis, due } = top;
  const dueText = formatDue(due.at!);
  const effort = analysis?.effort ?? 'Unknown';
  const reason =
    runnerUp && Date.parse(runnerUp.due.at!) < Date.parse(due.at!)
      ? `${runnerUp.a.title} is due sooner, but this needs more lead time (${effort.toLowerCase()} effort, ${dueText}).`
      : `Due ${dueText}, the soonest of your checked work.`;

  const evidence: Evidence[] = [
    due.source === 'instructions'
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
  if (runnerUp) {
    evidence.push({ kind: 'school-fact', text: `Next: ${runnerUp.a.title}, due ${formatDue(runnerUp.due.at!)}.`, sourceLabel: 'Canvas assignment', sourceUrl: runnerUp.a.url ?? undefined });
  }

  return analysis
    ? { item, action: analysis.firstStep, reason, evidence, aiGenerated: true }
    : { item, action: `Open the instructions for ${a.title}`, reason, evidence, aiGenerated: false };
}

function toWorkItem(
  a: Assignment,
  due: EffectiveDue,
  policy: PolicyResult,
  analysis: Candidate['analysis'],
  blocked: boolean,
  hidden: boolean,
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
    hidden,
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
