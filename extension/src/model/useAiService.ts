// Whether the local AI service is reachable, from the worker's health checks.
// Show "AI service isn't running" before the student asks, not only after.
// Send { type: 'ai:check' } when the panel opens to refresh it.
import { aiServiceItem } from '../core/settings';
import { useStorageItem } from './useStorageItem';

export function useAiService(): { up: boolean; checkedAt: string } | null | undefined {
  return useStorageItem(aiServiceItem);
}
