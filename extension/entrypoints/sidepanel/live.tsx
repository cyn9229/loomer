// Live side panel: renders the Home, Session and chat models from the local
// store and sends actions to the service worker.
import { widgetPageUrl } from '../../src/chat/widgetFrame';
import { sendMessage } from '../../src/core/messages';
import { settingsItem } from '../../src/core/settings';
import { useStorageItem } from '../../src/model/useStorageItem';
import { useAssignmentDetail } from '../../src/model/useAssignmentDetail';
import { useChatModel } from '../../src/model/useChatModel';
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
  widgetUrl: widgetPageUrl(),
};

export function LivePanel() {
  return (
    <Panel
      home={useHomeModel()}
      session={useSessionModel()}
      useDetail={useAssignmentDetail}
      useChat={useChatModel}
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
