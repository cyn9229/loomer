// Builds the SessionModel for the work-session screen from stored state.
import { loadWaitTimes, overdue, pendingOf, waitKey, waitView, type WaitTimes } from '../core/waits';
import { parseDocId, studentText, wordCount } from '../adapters/docs/reader';
import { instructionText, type AssignmentDetail, type DocLink, type DocRead, type LoomerDb, type SessionEvent, type Source, type WorkSession } from '../core/db';
import type { AiSettings } from '../core/settings';
import { courseKey } from '../analysis/facts';
import { workItemFor } from '../analysis/recommend';
import { loadReadInputs } from '../analysis/read';
import type { ActivityItem, DocState, HelpAvailability, SessionModel, SessionNextStep, SourceItem } from '../model/session';
import { recapFor } from './close';
import { currentSession } from './session';
import { sourceView } from './sources';
import { loadSheetTopics, loadTeacherSheets } from './topics';
import { workHelpDecision, type HelpDecision } from './help';

/** A review still marked pending after this long was cut off (the worker stopped). */
const REVIEW_STALE_MS = 3 * 60_000;
const ACTIVITY_LIMIT = 10;

export async function loadSessionModel(db: LoomerDb, ai: AiSettings, now: Date): Promise<SessionModel> {
  const session = await currentSession(db, now);
  if (!session) return { status: 'none' };
  const a = await db.assignments.get(session.assignmentId);
  if (!a) return { status: 'none' };

  const [course, analysis, context, link, events, sources, thread, decision, checks] = await Promise.all([
    db.courses.get(courseKey(a)),
    db.analyses.get(a.id),
    db.studentContext.bulkGet([a.id, courseKey(a)]),
    db.docLinks.get(a.id),
    db.sessionEvents.where('sessionId').equals(session.id).toArray(),
    db.sources.where('assignmentId').equals(a.id).toArray(),
    db.chatThreads.get(a.id),
    workHelpDecision(db, ai, a.id),
    db.topicChecks.where('assignmentId').equals(a.id).toArray(),
  ]);
  const read = link ? await db.docReads.get(link.docId) : undefined;
  const sessionHints = await db.hints.where('sessionId').equals(session.id).sortBy('id');
  const hint = sessionHints.filter((h) => h.state === 'shown').at(-1);
  const handled = sessionHints.filter((h) => h.state === 'handled');
  const contextMap = new Map(context.filter((c) => c !== undefined).map((c) => [c.key, c]));

  const saved = await sourceView(db, a, sources);
  const item = workItemFor(a, { course, analysis, context: contextMap, read: await loadReadInputs(db, ai.enabled, a.id) }, now);
  const step = session.nextStep;
  const [times, focusWait, hintWait] = await Promise.all([loadWaitTimes(db), db.waits.get(waitKey('focus', session.id)), db.waits.get(waitKey('hint', session.id))]);
  const focusView = waitView(focusWait, times, { title: 'Picking a focus', about: item.title }, "Loomer stopped before it picked a focus, so hints work without one.", now);
  const hintView = waitView(hintWait, times, { title: 'Reading your latest change' }, '', now);
  return {
    status: session.state === 'paused' ? 'paused' : 'active',
    sessionId: session.id,
    assignment: item,
    startedAt: session.startedAt,
    plannedUntil: session.plannedUntil ?? null,
    topics: await loadSheetTopics(db, a.id, now),
    teacherSheets: await loadTeacherSheets(db, a),
    doc: docState(link, read, a.detail, instructionText(a.detail)),
    sources: saved.items,
    sourceNeed: saved.need,
    activity: activity(events),
    help: {
      ...availability(decision),
      // From the thread summary, which changes only when the review starts or ends, not on each streamed save.
      reviewPending: thread?.pending === 'review' && now.getTime() - Date.parse(thread.lastAt) < REVIEW_STALE_MS,
    },
    // Never show AI guidance once help is no longer allowed (AI off, new restriction).
    suggestion: null,
    hint:
      hint && decision.allowed
        ? { id: hint.id, text: hint.text, reference: { quote: hint.quote, from: 'your draft' }, createdAt: hint.createdAt, requirement: hint.requirement ?? null }
        : null,
    focus: session.focus ? { text: session.focus.text, why: session.focus.why, requirement: session.focus.requirement } : null,
    handledHints: handled.slice(-3).reverse().map((h) => ({ id: h.id, text: h.text, at: h.settledAt ?? h.createdAt })),
    recap: recapFor({ ...a, quiz: item.quiz }, session, events, sources.filter((src) => src.sessionId === session.id).length, checks, now),
    nextStep: nextStepView(step, item.title, times, now),
    focusPending: session.focus ? null : focusView.pending,
    focusFailed: session.focus ? null : focusView.failed,
    // A hint read that stopped is just over; it never shows as a failure.
    hintPending: hintView.pending,
  };
}

function docState(link: DocLink | undefined, read: DocRead | undefined, detail: AssignmentDetail | null, instructions: string): DocState {
  if (!link) {
    // Embedded teacher sheets are read on their own (teacherSheets); only linked Docs are offered here.
    const ids = new Set<string>(detail?.embeddedDocs ?? []);
    const candidates = (detail?.links ?? []).flatMap((url) => {
      const docId = parseDocId(url);
      if (!docId || ids.has(docId)) return [];
      ids.add(docId);
      return [{ docId, url, label: detail?.linkLabels?.[url] ?? null }];
    });
    return { status: 'not-linked', candidates };
  }
  return {
    status: 'linked',
    docId: link.docId,
    url: link.url,
    readState: read?.readState ?? 'waiting',
    lastReadAt: read?.current?.observedAt ?? null,
    studentWords: read?.current ? wordCount(studentText(read.current.text, instructions)) : null,
  };
}

function activity(events: SessionEvent[]): ActivityItem[] {
  const line = (e: SessionEvent): string => {
    switch (e.kind) {
      case 'started':
        return 'Started this session';
      case 'paused':
        return 'Paused';
      case 'resumed':
        return 'Resumed';
      case 'ended':
        return 'Ended';
      case 'source-added':
        return `Saved ${e.title ?? 'a page'} as a source`;
      case 'doc-changed': {
        const d = e.wordsDelta ?? 0;
        return d === 0 ? 'Edited your draft' : `${d > 0 ? 'Added' : 'Cut'} ${Math.abs(d)} ${Math.abs(d) === 1 ? 'word' : 'words'} ${d > 0 ? 'to' : 'from'} your draft`;
      }
    }
  };
  return events
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, ACTIVITY_LIMIT)
    .map((e) => ({ at: e.at, text: line(e) }));
}

export function availability(decision: HelpDecision): { availability: HelpAvailability; policyQuote?: string; policySource?: string } {
  const quote = { policyQuote: decision.policy?.finding?.quote, policySource: decision.policy?.finding?.sourceLabel };
  if (decision.allowed) return { availability: 'available' };
  switch (decision.reason) {
    case 'ai-off':
      return { availability: 'ai-off' };
    case 'needs-policy-answer':
      return { availability: 'needs-policy-answer' };
    case 'policy-blocked':
      return { availability: 'blocked', ...quote };
    case 'policy-limited':
      return { availability: 'limited', ...quote };
    case 'policy-unresolved':
      return { availability: 'unresolved', ...quote };
    case 'quiz':
      return { availability: 'quiz' };
  }
}

/** The next step as the end card shows it. A step past its time counts as failed, so the card offers to write one. */
function nextStepView(step: WorkSession['nextStep'], title: string, times: WaitTimes, now: Date): SessionNextStep {
  if (!step) return null;
  if (step.status === 'ready') return step;
  if (overdue('next-step', times, step.at, now)) return { status: 'failed', failed: { text: 'Loomer stopped before it picked a next step, so write your own or try again.', retry: true } };
  return { status: 'pending', pending: pendingOf('next-step', times, { title: 'Picking a next step', about: title, startedAt: step.at }) };
}
