// Live options page: settings from storage, last check from the Home model.
import { useEffect, useState } from 'react';
import { settingsItem, type Settings } from '../../src/core/settings';
import { useHomeModel } from '../../src/model/useHomeModel';
import { OptionsPage } from '../../src/ui/options';
import { useNow } from '../../src/ui/useNow';

export function LiveOptions() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void settingsItem.getValue().then(setSettings);
    return settingsItem.watch(setSettings);
  }, []);
  const model = useHomeModel();
  const lastCheck = model && model.status !== 'not-connected' ? model.lastCheck : null;
  return <OptionsPage settings={settings} lastCheck={lastCheck} now={useNow()} />;
}
