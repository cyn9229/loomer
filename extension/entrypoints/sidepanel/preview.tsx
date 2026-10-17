// Fixture preview: renders a typed HomeModel fixture with a visible
// "Fixture preview" banner. Opened with sidepanel.html?fixture=<name>.
import { useState } from 'react';
import { buildFixtures, type FixtureName } from '../../src/ui/fixtures';
import { Panel } from '../../src/ui/Panel';
import { useNow } from '../../src/ui/useNow';

export function PreviewPanel({ initial }: { initial: string }) {
  const now = useNow();
  const fixtures = buildFixtures(now);
  const names = Object.keys(fixtures) as FixtureName[];
  const [name, setName] = useState<FixtureName>(isFixtureName(initial, names) ? initial : 'ready');
  return (
    <>
      <label className="preview-picker">
        Fixture
        <select value={name} onChange={(e) => isFixtureName(e.target.value, names) && setName(e.target.value)}>
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <Panel
        key={name}
        model={fixtures[name]}
        now={now}
        openSettings={() => undefined}
        previewLabel={`Fixture preview: ${name}. Not live data.`}
      />
    </>
  );
}

function isFixtureName(value: string, names: readonly FixtureName[]): value is FixtureName {
  return (names as readonly string[]).includes(value);
}
