// Student settings and grants, kept in chrome.storage.local so every extension
// context (worker, panel, options) reads the same values and can watch changes.
import { storage } from 'wxt/utils/storage';
import type { Exclusion, GateState } from './gate';

export type Settings = {
  /** Approved Canvas origin, e.g. https://school.instructure.com, or the loopback replay. */
  canvasOrigin: string | null;
  /** Bumped on every grant change so in-flight work can be rejected as stale. */
  grantVersion: number;
  paused: boolean;
  exclusions: Exclusion[];
};

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: { canvasOrigin: null, grantVersion: 0, paused: false, exclusions: [] },
});

export async function loadGateState(): Promise<GateState> {
  const s = await settingsItem.getValue();
  return {
    paused: s.paused,
    exclusions: s.exclusions,
    grants: s.canvasOrigin ? [{ purpose: 'school-metadata', origin: s.canvasOrigin, version: s.grantVersion }] : [],
  };
}
