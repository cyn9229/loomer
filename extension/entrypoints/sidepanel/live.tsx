// Live side panel: renders the Home, Session and chat models from the local
// store and sends actions to the service worker.
import { widgetPageUrl } from '../../src/chat/widgetFrame';
import { sendMessage } from '../../src/core/messages';
import { askThreadItem, chatInboxItem, settingsItem } from '../../src/core/settings';
import { nudgesItem } from '../../src/session/nudge';
import { useStorageItem } from '../../src/model/useStorageItem';
import { useEffect } from 'react';
import { useAiService } from '../../src/model/useAiService';
import { useAssignmentDetail } from '../../src/model/useAssignmentDetail';
import { useChatModel } from '../../src/model/useChatModel';
import { useHomeModel } from '../../src/model/useHomeModel';
import { useNudge } from '../../src/model/useNudge';
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
  // Ask the worker to ping the AI service when the panel opens, so a down service shows up front.
  useEffect(() => {
    void sendMessage({ type: 'ai:check' });
  }, []);
  const now = useNow();
  const nudge = useNudge(now);
  return (
    <Panel
      home={useHomeModel()}
      session={useSessionModel()}
      useDetail={useAssignmentDetail}
      useChat={useChatModel}
      screenshot={useScreenshotDraft()}
      now={now}
      api={api}
      paused={useStorageItem(settingsItem)?.paused ?? false}
      aiService={useAiService()}
      nudge={nudge}
      nudgesEnabled={useStorageItem(nudgesItem)?.enabled ?? true}
      lastThread={useStorageItem(askThreadItem)}
      chatInbox={useStorageItem(chatInboxItem)}
      onRefresh={async () => {
        await sendMessage({ type: 'canvas:refresh' });
      }}
    />
  );
}
