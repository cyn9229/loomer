// Live value of a chrome.storage item as React state. Live queries must read
// only Dexie (a non-Dexie await inside a querier stops change tracking), so
// settings come in through this hook instead.
import { useEffect, useState } from 'react';
import type { WxtStorageItem } from 'wxt/utils/storage';

export function useStorageItem<T>(item: WxtStorageItem<T, Record<string, unknown>>): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    void item.getValue().then((v) => live && setValue(v));
    const unwatch = item.watch((v) => setValue(v));
    return () => {
      live = false;
      unwatch();
    };
  }, [item]);
  return value;
}
