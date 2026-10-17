// The pending screenshot (memory only) for the preview and crop screen.
// Send screenshot:save { crop } or screenshot:cancel; nothing is stored before that.
import { screenshotDraftItem, type ScreenshotDraft } from '../capture/screenshot';
import { useStorageItem } from './useStorageItem';

export function useScreenshotDraft(): ScreenshotDraft | undefined {
  return useStorageItem(screenshotDraftItem);
}
