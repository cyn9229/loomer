// Live options page: settings and AI consent from storage, last check from the Home model.
import { useEffect, useState } from 'react';
import { aiSettingsItem, settingsItem, type AiSettings, type Settings } from '../../src/core/settings';
import { useHomeModel } from '../../src/model/useHomeModel';
import { OptionsPage } from '../../src/ui/options';
import { useNow } from '../../src/ui/useNow';

export function LiveOptions() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  useEffect(() => {
    void settingsItem.getValue().then(setSettings);
    void aiSettingsItem.getValue().then(setAi);
    const unwatchSettings = settingsItem.watch(setSettings);
    const unwatchAi = aiSettingsItem.watch(setAi);
    return () => {
      unwatchSettings();
      unwatchAi();
    };
  }, []);
  const model = useHomeModel();
  const lastCheck = model && model.status !== 'not-connected' ? model.lastCheck : null;
  return <OptionsPage settings={settings} ai={ai} lastCheck={lastCheck} now={useNow()} />;
}
