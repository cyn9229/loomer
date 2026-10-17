// Live side panel: renders the HomeModel from the local store.
import { sendMessage } from '../../src/core/messages';
import { useHomeModel } from '../../src/model/useHomeModel';
import { Panel } from '../../src/ui/Panel';
import { useNow } from '../../src/ui/useNow';

export function LivePanel() {
  const model = useHomeModel();
  const now = useNow();
  return (
    <Panel
      model={model}
      now={now}
      openSettings={() => void browser.runtime.openOptionsPage()}
      onRefresh={async () => {
        await sendMessage({ type: 'canvas:refresh' });
      }}
    />
  );
}
