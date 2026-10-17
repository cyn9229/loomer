// Fixture preview of the options page: ?fixture=new or ?fixture=connected.
import type { AiSettings, ProactiveSettings, Settings } from '../../src/core/settings';
import { OptionsPage } from '../../src/ui/options';
import { useNow } from '../../src/ui/useNow';

const fresh: Settings = { canvasOrigin: null, grantVersion: 0, paused: false, exclusions: [] };
const connected: Settings = {
  canvasOrigin: 'https://lincolnhs.instructure.com',
  grantVersion: 1,
  paused: false,
  exclusions: [
    { kind: 'host', host: 'mail.google.com', includeSubdomains: false },
    { kind: 'page', origin: 'https://docs.google.com', path: '/document/d/journal' },
  ],
};

const aiOff: AiSettings = { enabled: false, brokerOrigin: 'http://127.0.0.1:8787' };
const proactiveOn: ProactiveSettings = { enabled: true, delaySec: 90 };

export function PreviewOptions({ initial }: { initial: string }) {
  const now = useNow();
  const isNew = initial === 'new';
  return (
    <>
      <p className="preview-banner" style={{ margin: 0, borderRadius: 0 }} role="note">
        Fixture preview: {isNew ? 'new' : 'connected'}. Not live data. Connect will not work here.
      </p>
      <OptionsPage
        settings={isNew ? fresh : connected}
        ai={aiOff}
        proactive={proactiveOn}
        discovery={{ enabled: false }}
        lastCheck={isNew ? null : { at: new Date(now.getTime() - 720_000).toISOString(), outcome: 'ok', courses: 4, partial: false, replay: false }}
        now={now}
      />
    </>
  );
}
