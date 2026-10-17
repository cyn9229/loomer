// Builds the SessionModel for the work-session screen from stored state.
import { parseDocId, studentText, wordCount } from '../adapters/docs/reader';
import type { ChatRecord, DocLink, DocRead, LoomerDb, SessionEvent, Source } from '../core/db';
import type { AiSettings } from '../core/settings';
import { courseKey } from '../analysis/facts';
import { workItemFor } from '../analysis/recommend';
import type { ActivityItem, DocState, HelpAvailability, SessionModel } from '../model/session';
import { currentSession } from './session';
import { workHelpDecision, type HelpDecision } from './help';

/** A student message without a reply for this long is no longer shown as pending. */
const PENDING_MS = 90_000;
const ACTIVITY_LIMIT = 10;

export async function loadSessionModel(db: LoomerDb, ai: AiSettings, now: Date): Promise<SessionModel> {
  const session = await currentSession(db);
  if (!session) return { status: 'none' };
  const a = await db.assignments.get(session.assignmentId);
  if (!a) return { status: 'none' };

  const [course, analysis, context, link, events, sources, chat, decision] = await Promise.all([
    db.courses.get(courseKey(a)),
    db.analyses.get(a.id),
    db.studentContext.bulkGet([a.id, courseKey(a)]),
    db.docLinks.get(a.id),
    db.sessionEvents.where('sessionId').equals(session.id).toArray(),
    db.sources.where('assignmentId').equals(a.id).toArray(),
    db.chat.where('assignmentId').equals(a.id).toArray(),
    workHelpDecision(db, ai, a.id),
  ]);
  const read = link ? await db.docReads.get(link.docId) : undefined;
  const hint = (await db.hints.where('sessionId').equals(session.id).filter((h) => h.state === 'shown').toArray()).at(-1);
  const contextMap = new Map(context.filter((c) => c !== undefined).map((c) => [c.key, c]));

  return {
    status: session.state === 'paused' ? 'paused' : 'active',
    sessionId: session.id,
    assignment: workItemFor(a, { course, analysis, context: contextMap }, now),
    startedAt: session.startedAt,
    doc: docState(link, read, a.detail?.links ?? [], a.detail?.text ?? ''),
    sources: sources
      .sort((x, y) => y.capturedAt.localeCompare(x.capturedAt))
      .map((s: Source) => ({ id: s.id, title: s.title, url: s.url, capturedAt: s.capturedAt, excerptChars: s.excerpt.length })),
    activity: activity(events),
    help: {
      ...availability(decision),
      messages: chat.map((m: ChatRecord) => ({ id: m.id, role: m.role, text: m.text, kind: m.kind, references: m.references, createdAt: m.createdAt })),
      pending: chat.at(-1)?.role === 'student' && now.getTime() - Date.parse(chat.at(-1)!.createdAt) < PENDING_MS,
    },
    // Never show AI guidance once help is no longer allowed (AI off, new restriction).
    suggestion: null,
    hint: hint && decision.allowed ? { id: hint.id, text: hint.text, reference: { quote: hint.quote, from: 'your draft' }, createdAt: hint.createdAt } : null,
  };
}

function docState(link: DocLink | undefined, read: DocRead | undefined, instructionLinks: string[], instructions: string): DocState {
  if (!link) {
    const ids = new Set<string>();
    const candidates = instructionLinks.flatMap((url) => {
      const docId = parseDocId(url);
      if (!docId || ids.has(docId)) return [];
      ids.add(docId);
      return [{ docId, url }];
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
        return `Added source: ${e.title ?? 'page'}`;
      case 'doc-changed': {
        const d = e.wordsDelta ?? 0;
        return d === 0 ? 'Edited your draft' : `Edited your draft (${d > 0 ? '+' : '−'}${Math.abs(d)} words)`;
      }
    }
  };
  return events
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, ACTIVITY_LIMIT)
    .map((e) => ({ at: e.at, text: line(e) }));
}

function availability(decision: HelpDecision): { availability: HelpAvailability; policyQuote?: string; policySource?: string } {
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
  }
}
