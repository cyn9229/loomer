// Live side panel: renders the Home and Session models from the local store and
// sends actions to the service worker.
import { sendMessage } from '../../src/core/messages';
import { useHomeModel } from '../../src/model/useHomeModel';
import { useSessionModel } from '../../src/model/useSessionModel';
import type { PanelApi } from '../../src/ui/api';
import { Panel } from '../../src/ui/Panel';
import { useNow } from '../../src/ui/useNow';

const api: PanelApi = {
  send: sendMessage,
  requestOrigins: (origins) => browser.permissions.request({ origins }),
  openSettings: () => void browser.runtime.openOptionsPage(),
};

export function LivePanel() {
  return (
    <Panel
      home={useHomeModel()}
      session={useSessionModel()}
      now={useNow()}
      api={api}
      onRefresh={async () => {
        await sendMessage({ type: 'canvas:refresh' });
      }}
    />
  );
}
