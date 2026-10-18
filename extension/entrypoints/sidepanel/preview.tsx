// Fixture preview: renders typed Home, Session and Ask Loomer fixtures with a
// visible "Fixture preview" banner. Opened with
// sidepanel.html?fixture=<home>&session=<session>&chat=<chat> (add &screenshot
// to open the crop screen). The "streaming" chat replays a reply word by word.
// Actions are not sent anywhere; each one reports that it is a preview.
import { useEffect, useState } from 'react';
import type { PanelApi } from '../../src/ui/api';
import type { HomeModel } from '../../src/model/home';
import { buildChatFixtures, revealTurn, STREAM_STEPS, type ChatFixtureName } from '../../src/ui/chatFixtures';
import { buildDetail, buildFixtures, buildScreenshotDraft, type FixtureName } from '../../src/ui/fixtures';
import { Panel } from '../../src/ui/Panel';
import { buildSessionFixtures, type SessionFixtureName } from '../../src/ui/sessionFixtures';
import { useNow } from '../../src/ui/useNow';

const api: PanelApi = {
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
  const [shot, setShot] = useState(new URLSearchParams(location.search).has('screenshot'));
  const model = homes[home];
  const chats = buildChatFixtures(now, itemsOf(model));
  const chatNames = [...(Object.keys(chats) as ChatFixtureName[]), 'streaming' as const];
  const [chat, setChat] = useState<ChatFixtureName>(pick(new URLSearchParams(location.search).get('chat'), chatNames, 'empty'));
  const [run, setRun] = useState(0);
  const step = useStreamStep(chat === 'streaming', run);
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
        useChat={() => (chat === 'streaming' ? revealTurn(chats.answer, step) : chats[chat])}
        screenshot={shot ? buildScreenshotDraft(now) : null}
        now={now}
        api={api}
        paused={paused}
        previewLabel={`Fixture preview: ${home} / ${session}. Not live data.`}
      />
    </>
  );
}

function itemsOf(model: HomeModel) {
  if (model.status === 'not-connected') return [];
  return [...(model.status === 'ready' ? [model.next.item] : []), ...model.rest, ...(model.olderReview?.items.map((i) => i.item) ?? [])];
}

function pick<T extends string>(value: string | null, names: readonly T[], fallback: T): T {
  return names.find((n) => n === value) ?? fallback;
}
