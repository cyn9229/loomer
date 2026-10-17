// Fixture preview: renders typed Home and Session fixtures with a visible
// "Fixture preview" banner. Opened with sidepanel.html?fixture=<home>&session=<session>.
// Actions are not sent anywhere; each one reports that it is a preview.
import { useState } from 'react';
import type { PanelApi } from '../../src/ui/api';
import { buildFixtures, type FixtureName } from '../../src/ui/fixtures';
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
      </div>
      <Panel
        key={`${home}:${session}`}
        home={homes[home]}
        session={sessions[session]}
        now={now}
        api={api}
        previewLabel={`Fixture preview: ${home} / ${session}. Not live data.`}
      />
    </>
  );
}

function pick<T extends string>(value: string | null, names: readonly T[], fallback: T): T {
  return names.find((n) => n === value) ?? fallback;
}
