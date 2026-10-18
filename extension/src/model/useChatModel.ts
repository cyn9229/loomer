// React hook for an Ask Loomer thread. The live query reads only Dexie, so the
// reply appears as the worker streams it in.
import { useLiveQuery } from 'dexie-react-hooks';
import { loadChatModel } from '../chat/model';
import { db } from '../core/db';
import { aiSettingsItem } from '../core/settings';
import type { ChatModel, ThreadKey } from './chat';
import { useStorageItem } from './useStorageItem';

export function useChatModel(threadKey: ThreadKey): ChatModel | undefined {
  const ai = useStorageItem(aiSettingsItem);
  return useLiveQuery(() => (ai ? loadChatModel(db, ai, threadKey, new Date()) : undefined), [ai, threadKey]);
}
