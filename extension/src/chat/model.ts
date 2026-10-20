// Builds the ChatModel for one thread from the store, with the switcher's
// thread list and set-aside conversations. Dexie reads only.
import { courseKey, isOpen, offPlan } from '../analysis/facts';
import { planChangeView, workItemFor } from '../analysis/recommend';
import type { Assignment, ChatTurnRecord, LoomerDb, StudentContext } from '../core/db';
import type { AiSettings } from '../core/settings';
import { GENERAL_THREAD, type ChatBlock, type ChatModel, type SetAsideChat, type ThreadKey, type ThreadSummary } from '../model/chat';
import { workHelpDecision } from '../session/help';
import { availability } from '../session/model';

/** A reply still marked streaming after this long was cut off (the worker stopped). */
const STREAM_STALE_MS = 3 * 60 * 1000;
const LINE_CHARS = 120;

export async function loadChatModel(db: LoomerDb, ai: AiSettings, threadKey: ThreadKey, now: Date): Promise<ChatModel> {
  const [all, assignments, context] = await Promise.all([db.chatTurns.toArray(), db.assignments.toArray(), db.studentContext.toArray()]);
  const records = all.filter((t) => t.threadKey === threadKey && !t.setAsideId).sort((x, y) => x.id - y.id);
  const turns = records.map((t) => ({
    id: t.id,
    role: t.role,
    blocks: t.blocks,
    status: t.status === 'streaming' && now.getTime() - Date.parse(t.createdAt) > STREAM_STALE_MS ? ('error' as const) : t.status,
    error: t.error,
    createdAt: t.createdAt,
  }));
  const streaming = turns.some((t) => t.status === 'streaming');
  const planChanges = Object.fromEntries((await db.planChanges.toArray()).filter((c) => c.threadKey === threadKey).map((c) => [c.id, planChangeView(c)]));
  const draftIds = turns.flatMap((t) => t.blocks.flatMap((b) => (b.kind === 'add-assignment' ? [b.draftId] : [])));
  const added = Object.fromEntries(assignments.flatMap((a) => (a.draftId && draftIds.includes(a.draftId) ? [[a.draftId, a.id]] : [])));
  const base = { threadKey, turns, streaming, planChanges, added, threads: threadList(all, assignments, context, now), setAside: setAsideList(all, assignments) };

  if (threadKey === GENERAL_THREAD) return { ...base, assignment: null, availability: ai.enabled ? 'available' : 'ai-off' };
  const a = assignments.find((x) => x.id === threadKey);
  if (!a) return { ...base, assignment: null, availability: 'unresolved' };
  const [course, analysis, decision] = await Promise.all([db.courses.get(courseKey(a)), db.analyses.get(a.id), workHelpDecision(db, ai, a.id)]);
  const contextMap = new Map(context.filter((c) => c.key === a.id || c.key === courseKey(a)).map((c) => [c.key, c]));
  return { ...base, assignment: workItemFor(a, { course, analysis, context: contextMap }, now), availability: availability(decision).availability };
}

/** One line for a turn: its first text, or what kind of thing it showed. */
function lineOf(blocks: ChatBlock[]): string {
  const text = blocks
    .map((b) => (b.kind === 'markdown' ? b.text : b.kind === 'draft-check' ? b.summary : b.kind === 'quiz' ? `Quick check: ${b.quiz.concept}` : b.kind === 'visual' ? b.visual.title : ''))
    .find((t) => t.trim());
  const line = (text ?? '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
  return line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS - 1)}…` : line;
}

/**
 * The switcher's list. Current work is open, not hidden, not done, and not past
 * due; it is listed even with no messages, so a new chat can start there. Other
 * work is listed under "earlier" only when it has messages, so nothing said
 * ever drops out of reach.
 */
function threadList(all: ChatTurnRecord[], assignments: Assignment[], context: StudentContext[], now: Date): ThreadSummary[] {
  const last = new Map<string, ChatTurnRecord>();
  for (const t of all) if (!t.setAsideId && (last.get(t.threadKey)?.id ?? -1) < t.id) last.set(t.threadKey, t);
  const ctx = new Map(context.map((c) => [c.key, c]));
  const summary = (threadKey: string, title: string, courseName: string | null, group: ThreadSummary['group']): ThreadSummary => {
    const t = last.get(threadKey);
    return { threadKey, title, courseName, lastText: t ? lineOf(t.blocks) || null : null, lastAt: t?.createdAt ?? null, group };
  };
  const rows = assignments.flatMap((a) => {
    const c = ctx.get(a.id);
    const current = isOpen(a) && !c?.hidden && !offPlan(c?.correction ?? null) && (!a.dueAt || Date.parse(a.dueAt) >= now.getTime());
    if (!current && !last.has(a.id)) return [];
    return [{ row: summary(a.id, a.title, a.courseName, current ? 'current' : 'earlier'), due: a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY }];
  });
  // Newest conversation first; threads with no messages yet by due date.
  rows.sort((x, y) => (y.row.lastAt ?? '').localeCompare(x.row.lastAt ?? '') || x.due - y.due);
  return [
    summary(GENERAL_THREAD, 'General', null, 'general'),
    ...rows.filter((r) => r.row.group === 'current').map((r) => r.row),
    ...rows.filter((r) => r.row.group === 'earlier').map((r) => r.row),
  ];
}

/** Conversations set aside by "Start fresh", newest first. */
function setAsideList(all: ChatTurnRecord[], assignments: Assignment[]): SetAsideChat[] {
  const groups = new Map<string, ChatTurnRecord[]>();
  for (const t of all) if (t.setAsideId) groups.set(t.setAsideId, [...(groups.get(t.setAsideId) ?? []), t]);
  return [...groups.entries()]
    .map(([id, turns]) => {
      const sorted = turns.sort((x, y) => x.id - y.id);
      const threadKey = sorted[0]!.threadKey;
      const title = threadKey === GENERAL_THREAD ? 'General' : (assignments.find((a) => a.id === threadKey)?.title ?? 'An assignment');
      return { id, threadKey, title, startedAt: sorted[0]!.createdAt, endedAt: sorted.at(-1)!.createdAt, count: sorted.length, preview: lineOf(sorted.at(-1)!.blocks) };
    })
    .sort((x, y) => y.endedAt.localeCompare(x.endedAt));
}
