import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sendMessage } from '../../src/core/messages';
import { settingsItem, type Settings } from '../../src/core/settings';
import { parseSourceUrl } from '../../src/core/url';

// Dev form for M1 verification. Replaced by onboarding and Privacy & controls once a mock is picked.
function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [origin, setOrigin] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    void settingsItem.getValue().then(setSettings);
    return settingsItem.watch(setSettings);
  }, []);

  const connect = () => {
    const url = parseSourceUrl(origin.trim());
    if (!url) return setStatus('Use an https Canvas address, or the local replay at http://127.0.0.1:8787.');
    // permissions.request must run first in the click handler to keep the user gesture.
    browser.permissions
      .request({ origins: [`${url.origin}/*`] })
      .then(async (granted) => {
        if (!granted) return setStatus('Chrome access was not granted. Loomer stays in limited mode.');
        const reply = await sendMessage({ type: 'canvas:connect', origin: url.origin });
        setStatus(reply.ok ? 'Connected. Checking Canvas.' : reply.error);
      })
      .catch((error: unknown) => setStatus(String(error)));
  };

  return (
    <main>
      <h1>loomer settings (dev)</h1>
      <p>Connected Canvas: {settings?.canvasOrigin ?? 'none'}</p>
      <label>
        Canvas address
        <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="https://yourschool.instructure.com" />
      </label>
      <button onClick={connect}>Connect</button>
      <p role="status">{status}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
