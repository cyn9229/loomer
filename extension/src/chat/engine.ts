// Ask Loomer engine. Streams a reply from the local broker into the store (the
// panel's live query shows it as it grows), runs read-only tools between
// rounds, and enforces consent and the assignment's AI policy before every send.
import { brokerEnvelopeSchema } from '../../../shared/ai-contract';
import { CHAT_ROUTE, type ChatMessage, type ChatRequest, type ChatStreamEvent } from '../../../shared/chat-contract';
import type { ChatTurnRecord, LoomerDb } from '../core/db';
import type { AiSettings } from '../core/settings';
import { GENERAL_THREAD, type ChatBlock, type ThreadKey } from '../model/chat';
import { isQuiz, storedWorkType } from '../analysis/workType';
import { workHelpDecision } from '../session/help';
import { runTool, type ToolSettings } from './tools';

const MAX_ROUNDS = 4;
const HISTORY_TURNS = 12;
const FLUSH_MS = 120;
const SERVICE_DOWN = "Loomer's AI service isn't running on this computer. Start it with npm run dev:server, then try again.";
const CUT_OFF = 'The reply was cut off before it finished. Try again.';
const QUIZ_PAUSE = 'Ask Loomer is paused while you work on a quiz or test. It comes back when you end the session.';

/** The broker could not be reached at all (as opposed to a reply that broke midway). */
class ServiceDownError extends Error {}

export type ChatDeps = {
  db: LoomerDb;
  ai: () => Promise<AiSettings>;
  settings: () => Promise<ToolSettings>;
  fetch?: typeof fetch;
  now?: () => Date;
};

const running = new Map<ThreadKey, AbortController>();

export function stopChat(threadKey: ThreadKey) {
  running.get(threadKey)?.abort();
}

export function isStreaming(threadKey: ThreadKey) {
  return running.has(threadKey);
}

/** Whether Ask Loomer may answer in this thread right now, and why not. */
export async function chatAllowed(db: LoomerDb, ai: AiSettings, threadKey: ThreadKey): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ai.enabled) return { ok: false, reason: 'AI help is off. You can turn it on in settings.' };
  // The quiz rule: while a session on a quiz or test is open, Ask Loomer pauses everywhere.
  const session = await db.sessions.where('state').anyOf('active', 'paused').last();
  const sessionItem = session ? await db.assignments.get(session.assignmentId) : undefined;
  if (sessionItem && isQuiz(sessionItem)) return { ok: false, reason: QUIZ_PAUSE };
  if (threadKey === GENERAL_THREAD) return { ok: true };
  const decision = await workHelpDecision(db, ai, threadKey);
  if (decision.allowed) return { ok: true };
  return {
    ok: false,
    reason:
      decision.reason === 'quiz'
        ? 'Loomer does not help with a quiz or test itself. Study for it in a general chat before you start.'
        : decision.reason === 'policy-blocked'
        ? "Your teacher's rule turns AI help off for this assignment. Loomer can still help you organize it."
        : decision.reason === 'needs-policy-answer'
          ? 'Answer the question about your teacher’s AI rule first.'
          : 'Loomer is not sure AI help is allowed on this assignment, so it is paused.',
  };
}

/** Earlier turns as plain messages. Visuals and quizzes become one-line notes. */
function historyFrom(turns: ChatTurnRecord[]): ChatMessage[] {
  return turns.slice(-HISTORY_TURNS).flatMap((t): ChatMessage[] => {
    const text = t.blocks
      .map((b) =>
        b.kind === 'markdown'
          ? b.text
          : b.kind === 'visual'
            ? `[Showed ${b.visual.type}: ${b.visual.title}]`
            : b.kind === 'quiz'
              ? `[Gave a quiz on ${b.quiz.concept}]`
              : b.kind === 'plan-change'
                ? '[Proposed a plan change card]'
                : '',
      )
      .filter(Boolean)
      .join('\n')
      .slice(0, t.role === 'student' ? 4_000 : 12_000);
    if (!text) return [];
    return [t.role === 'student' ? { role: 'user', content: text } : { role: 'assistant', content: text }];
  });
}

async function contextFor(db: LoomerDb, threadKey: ThreadKey): Promise<ChatRequest['context']> {
  if (threadKey === GENERAL_THREAD) return { kind: 'general' };
  const a = await db.assignments.get(threadKey);
  return {
    kind: 'assignment',
    title: (a?.title ?? 'Assignment').slice(0, 300),
    work_type: a ? await storedWorkType(db, a) : 'writing',
    instructions: (a?.detail?.text ?? '').slice(0, 12_000),
    rubric: (a?.detail?.rubric ?? []).slice(0, 30).map((r) => r.description.slice(0, 1_000)),
  };
}

/** Sends one student message and streams Loomer's reply into the store. */
export async function sendChat(deps: ChatDeps, threadKey: ThreadKey, text: string): Promise<void> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  if (running.has(threadKey)) return;
  const prior = await db.chatTurns.where('threadKey').equals(threadKey).sortBy('id');
  await db.chatTurns.add({ threadKey, role: 'student', blocks: [{ kind: 'markdown', text }], status: 'done', createdAt: now().toISOString() });

  const settings = await deps.ai();
  const allowed = await chatAllowed(db, settings, threadKey);
  if (!allowed.ok) {
    await db.chatTurns.add({ threadKey, role: 'loomer', blocks: [{ kind: 'markdown', text: allowed.reason }], status: 'error', error: 'not-allowed', createdAt: now().toISOString() });
    return;
  }

  const turnId = await db.chatTurns.add({ threadKey, role: 'loomer', blocks: [], status: 'streaming', createdAt: now().toISOString() });
  const controller = new AbortController();
  running.set(threadKey, controller);
  const blocks: ChatBlock[] = [];
  let lastFlush = 0;
  const flush = async (force = false) => {
    if (!force && Date.now() - lastFlush < FLUSH_MS) return;
    lastFlush = Date.now();
    await db.chatTurns.update(turnId, { blocks: structuredClone(blocks) });
  };
  const appendText = (delta: string) => {
    const last = blocks.at(-1);
    if (last?.kind === 'markdown') last.text += delta;
    else blocks.push({ kind: 'markdown', text: delta });
  };

  const messages: ChatMessage[] = [...historyFrom(prior), { role: 'user', content: text }];
  const context = await contextFor(db, threadKey);
  const today = now().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const session = await db.sessions.where('state').equals('active').last();
  const session_minutes_left =
    session?.plannedUntil && (threadKey === GENERAL_THREAD || threadKey === session.assignmentId)
      ? Math.max(0, Math.round((Date.parse(session.plannedUntil) - now().getTime()) / 60_000))
      : null;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // Re-check before every round: AI may have been turned off or a rule found.
      if (!(await chatAllowed(db, await deps.ai(), threadKey)).ok) throw new Error('not-allowed');
      const calls = await streamRound(deps, settings, { context, today, session_minutes_left, messages }, controller.signal, appendText, flush);
      if (calls.length === 0) break;

      messages.push({ role: 'assistant', content: null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) });
      for (const call of calls) {
        const status: ChatBlock = { kind: 'tool', label: 'Working…', status: 'running' };
        blocks.push(status);
        await flush(true);
        const result = await runTool(db, await deps.settings(), call.name, call.arguments, now(), threadKey);
        Object.assign(status, { label: result.label, status: 'done' });
        if (result.block) blocks.push(result.block);
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.forModel.slice(0, 20_000) });
        await flush(true);
      }
    }
    await db.chatTurns.update(turnId, { blocks, status: 'done' });
  } catch (error) {
    const stopped = controller.signal.aborted;
    const message =
      error instanceof Error && error.message === 'not-allowed'
        ? 'AI help was turned off or paused for this, so Loomer stopped.'
        : error instanceof ServiceDownError
          ? SERVICE_DOWN
          : error instanceof TypeError
            ? CUT_OFF
            : error instanceof Error
            ? error.message
            : 'Something went wrong.';
    await db.chatTurns.update(turnId, { blocks, status: stopped ? 'stopped' : 'error', error: stopped ? undefined : message });
  } finally {
    running.delete(threadKey);
  }
}

type ToolCall = { id: string; name: string; arguments: string };

/** One broker round: streams text into the reply and returns the tool calls requested. */
async function streamRound(
  deps: ChatDeps,
  settings: AiSettings,
  request: ChatRequest,
  signal: AbortSignal,
  appendText: (delta: string) => void,
  flush: (force?: boolean) => Promise<void>,
): Promise<ToolCall[]> {
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${settings.brokerOrigin}${CHAT_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-loomer-client': 'extension' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ServiceDownError(error instanceof Error ? error.message : 'unreachable');
  }
  if (!res.ok || !res.body) {
    const body = brokerEnvelopeSchema.safeParse(await res.json().catch(() => null));
    throw new Error(body.success && !body.data.ok ? `AI service: ${body.data.error}` : `AI service status ${res.status}`);
  }
  const calls: ToolCall[] = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = parseEvent(line);
      if (!event) continue;
      if (event.type === 'text') {
        appendText(event.delta);
        await flush();
      } else if (event.type === 'tool_call') calls.push(event);
      else if (event.type === 'error') throw new Error(`AI service: ${event.error}`);
    }
  }
  await flush(true);
  return calls;
}

function parseEvent(line: string): ChatStreamEvent | null {
  try {
    const e: unknown = JSON.parse(line);
    if (typeof e !== 'object' || e === null || !('type' in e)) return null;
    switch (e.type) {
      case 'text':
        return 'delta' in e && typeof e.delta === 'string' ? { type: 'text', delta: e.delta } : null;
      case 'tool_call':
        return 'id' in e && 'name' in e && 'arguments' in e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.arguments === 'string'
          ? { type: 'tool_call', id: e.id, name: e.name, arguments: e.arguments }
          : null;
      case 'done':
        return { type: 'done' };
      case 'error':
        return { type: 'error', error: 'error' in e && typeof e.error === 'string' ? e.error : 'unknown' };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
