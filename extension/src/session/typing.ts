// Last keystroke in the linked Doc, from the docs-activity content script. Kept
// in chrome.storage.session: memory only, cleared when the browser closes, and
// not watched by the panel, so frequent updates cause no re-rendering.
import { storage } from 'wxt/utils/storage';

export const typingItem = storage.defineItem<{ docId: string; at: number } | null>('session:typing', { fallback: null });

export async function typingAtFor(docId: string | undefined): Promise<number | null> {
  const t = await typingItem.getValue();
  return t && docId && t.docId === docId ? t.at : null;
}
