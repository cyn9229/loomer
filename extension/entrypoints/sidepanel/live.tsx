// Live side panel: renders the Home and Session models from the local store and
// sends actions to the service worker.
import { sendMessage } from '../../src/core/messages';
import { settingsItem } from '../../src/core/settings';
import { useStorageItem } from '../../src/model/useStorageItem';
import { useAssignmentDetail } from '../../src/model/useAssignmentDetail';
import { useHomeModel } from '../../src/model/useHomeModel';
import { useScreenshotDraft } from '../../src/model/useScreenshotDraft';
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
      useDetail={useAssignmentDetail}
      screenshot={useScreenshotDraft()}
      now={useNow()}
      api={api}
      paused={useStorageItem(settingsItem)?.paused ?? false}
      onRefresh={async () => {
        await sendMessage({ type: 'canvas:refresh' });
      }}
    />
  );
}
