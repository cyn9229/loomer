// Fixture preview: renders typed Home, Session and Ask Loomer fixtures with a
// visible "Fixture preview" banner. Opened with
// sidepanel.html?fixture=<home>&session=<session>&chat=<chat> (add &screenshot
// to open the crop screen). The "streaming" chat replays a reply word by word.
// Sending a chat message (with any attachments) adds it to the thread and
// streams the sample reply after it, so scrolling and attachments can be tried. Other actions are not sent anywhere;
// each one reports that it is a preview.
import { useEffect, useState } from 'react';
import type { PanelApi } from '../../src/ui/api';
import type { Attachment, AttachmentView, ChatBlock, ChatModel } from '../../src/model/chat';
import type { HomeModel } from '../../src/model/home';
import type { WorkNudge } from '../../src/model/session';
import { buildChatFixtures, revealTurn, STREAM_STEPS, type ChatFixtureName } from '../../src/ui/chatFixtures';
import { buildDetail, buildFixtures, buildScreenshotDraft, type FixtureName } from '../../src/ui/fixtures';
import { Panel } from '../../src/ui/Panel';
import { buildSessionFixtures, type SessionFixtureName } from '../../src/ui/sessionFixtures';
import { useNow } from '../../src/ui/useNow';

const previewApi: PanelApi = {
  send: async () => ({ ok: false, error: 'Preview only. Nothing was sent.' }),
  requestOrigins: async () => true,
  openSettings: () => undefined,
  widgetUrl: '/widget.html',
};

/** Counts up to STREAM_STEPS while `on`, restarting whenever `run` changes. */
function useStreamStep(on: boolean, run: number): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!on) return;
    setStep(0);
    const timer = setInterval(() => setStep((s) => (s >= STREAM_STEPS ? s : s + 1)), 70);
    return () => clearInterval(timer);
  }, [on, run]);
  return step;
}

export function PreviewPanel({ initial, initialSession }: { initial: string; initialSession: string | null }) {
  const now = useNow();
  const homes = buildFixtures(now);
  const sessions = buildSessionFixtures(now);
  const homeNames = Object.keys(homes) as FixtureName[];
  const sessionNames = Object.keys(sessions) as SessionFixtureName[];
  const [home, setHome] = useState<FixtureName>(pick(initial, homeNames, 'ready'));
  const [session, setSession] = useState<SessionFixtureName>(pick(initialSession, sessionNames, 'none'));
  const [paused, setPaused] = useState(false);
  const [aiDown, setAiDown] = useState(new URLSearchParams(location.search).has('aidown'));
  const [nudgeName, setNudgeName] = useState<NudgeName>(pick(new URLSearchParams(location.search).get('nudge'), NUDGE_NAMES, 'none'));
  const [shot, setShot] = useState(new URLSearchParams(location.search).has('screenshot'));
  const model = homes[home];
  const chats = buildChatFixtures(now, itemsOf(model));
  const chatNames = [...(Object.keys(chats) as ChatFixtureName[]), 'streaming' as const];
  const [chat, setChat] = useState<ChatFixtureName>(pick(new URLSearchParams(location.search).get('chat'), chatNames, 'empty'));
  const [run, setRun] = useState(0);
  // Messages sent in this preview, each answered with the sample reply.
  const [sent, setSent] = useState<Sent[]>([]);
  const step = useStreamStep(chat === 'streaming' || sent.length > 0, run);
  const [api] = useState<PanelApi>(() => ({
    ...previewApi,
    send: async (message) => {
      if (message.type !== 'chat:send') return previewApi.send(message);
      setSent((all) => [...all, { text: message.text, attachments: message.attachments ?? [] }]);
      setRun((r) => r + 1);
      return { ok: true };
    },
  }));
  return (
    <>
      <div className="preview-picker">
        <label>
          Home{' '}
          <select value={home} onChange={(e) => setHome(pick(e.target.value, homeNames, home))}>
            {homeNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Session{' '}
          <select value={session} onChange={(e) => setSession(pick(e.target.value, sessionNames, session))}>
            {sessionNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Chat{' '}
          <select value={chat} onChange={(e) => setChat(pick(e.target.value, chatNames, chat))}>
            {chatNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        {chat === 'streaming' && (
          <button type="button" onClick={() => setRun((r) => r + 1)}>
            Replay
          </button>
        )}
        <label>
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Paused
        </label>
        <label>
          <input type="checkbox" checked={aiDown} onChange={(e) => setAiDown(e.target.checked)} /> AI service down
        </label>
        <label>
          Nudge{' '}
          <select value={nudgeName} onChange={(e) => setNudgeName(pick(e.target.value, NUDGE_NAMES, nudgeName))}>
            {NUDGE_NAMES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={shot} onChange={(e) => setShot(e.target.checked)} /> Screenshot
        </label>
      </div>
      <Panel
        key={`${home}:${session}`}
        home={homes[home]}
        session={sessions[session]}
        useDetail={(id) => {
          const item = id ? itemsOf(model).find((i) => i.assignmentId === id) : undefined;
          return item ? buildDetail(item, now) : undefined;
        }}
        useChat={() => (sent.length > 0 ? revealTurn(withSent(chats[chat === 'streaming' ? 'answer' : chat], sent, chats.answer), step) : chat === 'streaming' ? revealTurn(chats.answer, step) : chats[chat])}
        screenshot={shot ? buildScreenshotDraft(now) : null}
        now={now}
        api={api}
        paused={paused}
        aiService={{ up: !aiDown, checkedAt: now.toISOString() }}
        nudge={previewNudge(nudgeName, now)}
        nudgesEnabled
        previewLabel={`Fixture preview: ${home} / ${session}. Not live data.`}
      />
    </>
  );
}

const NUDGE_NAMES = ['none', 'start', 'viewing', 'resume', 'switch'] as const;
type NudgeName = (typeof NUDGE_NAMES)[number];

/** A nudge as the worker would raise it, on the practice sheet fixture. */
function previewNudge(name: NudgeName, now: Date): WorkNudge {
  if (name === 'none') return null;
  return {
    assignmentId: 'a-sheet',
    title: 'Unit 6 Review Sheet: Quadratics',
    action: name === 'viewing' ? 'start' : name,
    reason: name === 'viewing' ? 'viewing' : 'typing',
    at: now.toISOString(),
  };
}

/** A message sent in the preview: its text and what was attached. */
type Sent = { text: string; attachments: Attachment[] };

/** How a sent attachment shows, as the worker would store it. */
function viewOf(a: Attachment): AttachmentView {
  if (a.kind === 'image') return { kind: 'image', name: a.name, thumb: a.thumb, detail: `${a.width} × ${a.height}` };
  if (a.kind === 'pdf') return { kind: 'pdf', name: a.name, thumb: null, detail: `${(a.bytes / 1_048_576).toFixed(1)} MB` };
  return { kind: 'text', name: a.name, thumb: null, detail: a.truncated ? 'Read the first 100,000 characters' : 'Text' };
}

/** The thread with each preview message after it, every one answered with the sample reply. */
function withSent(model: ChatModel, sent: Sent[], sample: ChatModel): ChatModel {
  const reply = sample.turns.at(-1)!;
  const at = new Date().toISOString();
  const added = sent.flatMap((m, i) => {
    const blocks: ChatBlock[] = [
      ...m.attachments.map((a, j): ChatBlock => ({ kind: 'attachment', fileId: i * 10 + j, file: viewOf(a) })),
      ...(m.text ? [{ kind: 'markdown' as const, text: m.text }] : []),
    ];
    return [
      { id: 900_000 + i * 2, role: 'student' as const, blocks, status: 'done' as const, createdAt: at },
      { ...reply, id: 900_001 + i * 2 },
    ];
  });
  return { ...model, turns: [...model.turns, ...added] };
}

function itemsOf(model: HomeModel) {
  if (model.status === 'not-connected') return [];
  return [...(model.status === 'ready' ? [model.next.item] : []), ...model.rest, ...(model.olderReview?.items.map((i) => i.item) ?? [])];
}

function pick<T extends string>(value: string | null, names: readonly T[], fallback: T): T {
  return names.find((n) => n === value) ?? fallback;
}
