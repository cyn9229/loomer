// Live options page: settings from chrome.storage (via useStorageItem, never a
// live query) and the last check from the Home model.
import { aiSettingsItem, discoveryItem, proactiveItem, settingsItem } from '../../src/core/settings';
import { useHomeModel } from '../../src/model/useHomeModel';
import { useStorageItem } from '../../src/model/useStorageItem';
import { OptionsPage } from '../../src/ui/options';
import { useNow } from '../../src/ui/useNow';

export function LiveOptions() {
  const settings = useStorageItem(settingsItem);
  const ai = useStorageItem(aiSettingsItem);
  const proactive = useStorageItem(proactiveItem);
  const discovery = useStorageItem(discoveryItem);
  const model = useHomeModel();
  const lastCheck = model && model.status !== 'not-connected' ? model.lastCheck : null;
  return (
    <OptionsPage
      settings={settings ?? null}
      ai={ai ?? null}
      proactive={proactive ?? null}
      discovery={discovery ?? null}
      lastCheck={lastCheck}
      now={useNow()}
    />
  );
}
