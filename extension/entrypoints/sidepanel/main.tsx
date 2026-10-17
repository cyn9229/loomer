import { useLiveQuery } from 'dexie-react-hooks';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../src/core/db';
import { sendMessage } from '../../src/core/messages';

// Dev readout for M1 verification. Replaced by the real Home once a mock is picked.
function SidePanel() {
  const lastRun = useLiveQuery(() => db.runs.orderBy('startedAt').last());
  const assignments = useLiveQuery(
    () => (lastRun?.sourceKey ? db.assignments.where('sourceKey').equals(lastRun.sourceKey).sortBy('dueAt') : []),
    [lastRun?.sourceKey],
  );
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    await sendMessage({ type: 'canvas:refresh' }).finally(() => setBusy(false));
  };

  return (
    <main>
      <h1>loomer (dev readout)</h1>
      <button onClick={refresh} disabled={busy}>
        {busy ? 'Checking Canvas' : 'Refresh'}
      </button>
      {lastRun ? (
        <section>
          <h2>Last check</h2>
          <p>
            {lastRun.outcome} at {new Date(lastRun.finishedAt).toLocaleTimeString()}
            {lastRun.error ? `: ${lastRun.error}` : ''}
          </p>
          <pre>{JSON.stringify(lastRun.coverage, null, 1)}</pre>
        </section>
      ) : (
        <p>No check yet. Connect Canvas in settings.</p>
      )}
      <section>
        <h2>Assignments ({assignments?.length ?? 0})</h2>
        <ul>
          {assignments?.map((a) => (
            <li key={a.id}>
              {a.replay ? '[replay] ' : ''}
              <strong>{a.title}</strong> · {a.courseName ?? a.courseId} · {a.dueAt ? new Date(a.dueAt).toLocaleString() : 'no due date'}
              {a.presence === 'missing-from-last-check' ? ' · missing from last check' : ''}
              {a.submission?.submitted ? ' · submitted' : ''}
              <br />
              <small>
                {a.detail
                  ? `requirements: ${a.detail.text.length} chars, ${a.detail.rubric.length} rubric criteria, ${a.detail.links.length} links`
                  : a.detailError
                    ? `requirements unreadable: ${a.detailError}`
                    : 'requirements not checked'}
              </small>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
