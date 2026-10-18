// Fixture preview: renders typed Home and Session fixtures with a visible
// "Fixture preview" banner. Opened with sidepanel.html?fixture=<home>&session=<session>
// (add &screenshot to open the crop screen).
// Actions are not sent anywhere; each one reports that it is a preview.
import { useState } from 'react';
import type { PanelApi } from '../../src/ui/api';
import type { HomeModel } from '../../src/model/home';
import { buildDetail, buildFixtures, buildScreenshotDraft, type FixtureName } from '../../src/ui/fixtures';
import { Panel } from '../../src/ui/Panel';
import { buildSessionFixtures, type SessionFixtureName } from '../../src/ui/sessionFixtures';
import { useNow } from '../../src/ui/useNow';

const api: PanelApi = {
  send: async () => ({ ok: false, error: 'Preview only. Nothing was sent.' }),
  requestOrigins: async () => true,
  openSettings: () => undefined,
};

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
