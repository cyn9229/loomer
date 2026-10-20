// Student settings and grants, kept in chrome.storage.local so every extension
// context (worker, panel, options) reads the same values and can watch changes.
import { storage } from 'wxt/utils/storage';
import { db } from './db';
import { DEFAULT_LEVEL_MINUTES, type LevelMinutes } from '../analysis/plan';
import type { PlanSnapshot } from '../analysis/recommend';
import type { Exclusion, GateState, Grant } from './gate';

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

/**
 * Current grants: the school origin, one grant per linked Doc, and one per Doc
 * the school embedded in instructions (part of the school's own content, read
 * only while the school is connected).
 */
export async function loadGateState(): Promise<GateState> {
  const s = await settingsItem.getValue();
  const doc = (purpose: Grant['purpose'], docId: string): Grant => ({ purpose, origin: 'https://docs.google.com', pathPrefix: `/document/d/${docId}/`, version: s.grantVersion });
  const grants: Grant[] = (await db.docLinks.toArray()).map((l) => doc('work-doc', l.docId));
  if (s.canvasOrigin) {
    grants.push({ purpose: 'school-metadata', origin: s.canvasOrigin, version: s.grantVersion });
    const embedded = new Set((await db.assignments.toArray()).flatMap((a) => a.detail?.embeddedDocs ?? []));
    for (const id of embedded) grants.push(doc('linked-instructions', id));
  }
  return { paused: s.paused, exclusions: s.exclusions, grants };
}

export type AiSettings = {
  /** Explicit opt-in. Off by default; turning it off stops all cloud AI. */
  enabled: boolean;
  /** The local broker that holds the provider key. */
  brokerOrigin: string;
};

export const aiSettingsItem = storage.defineItem<AiSettings>('local:ai', {
  fallback: { enabled: false, brokerOrigin: 'http://127.0.0.1:8787' },
});

export type ProactiveSettings = {
  /** Unprompted writing hints after a pause. A requested review always runs immediately. */
  enabled: boolean;
  /** Seconds without edits before a hint may be considered. Agreed default 90. */
  delaySec: number;
};

export const proactiveItem = storage.defineItem<ProactiveSettings>('local:proactive', {
  fallback: { enabled: true, delaySec: 90 },
});

/** Research discovery: off by default; needs Chrome's optional tabs permission. */
export const discoveryItem = storage.defineItem<{ enabled: boolean }>('local:discovery', { fallback: { enabled: false } });

/** Desktop notifications: off by default; only verified deadline changes and one research reminder per session. */
export const notifyItem = storage.defineItem<{ enabled: boolean }>('local:notify', { fallback: { enabled: false } });

/**
 * What the student chose to work on, with the evidence it was chosen against.
 * Home honors it until that assignment's due date or requirement text changes.
 */
export type Choice = { assignmentId: string; dueAt: string | null; detailHash: string | null; at: string } | null;
export const choiceItem = storage.defineItem<Choice>('local:choice', { fallback: null });

/** The worker's last plan (top item and dates); keeps Home's top steady and explains moves. */
export const planSnapshotItem = storage.defineItem<PlanSnapshot>('local:planSnapshot', { fallback: null });

/** Local date (YYYY-MM-DD) the student last dismissed the daily brief. */
export const briefDismissedItem = storage.defineItem<string | null>('local:briefDismissed', { fallback: null });

/** Whether the local AI service answered its last health check. Null until AI is turned on and checked. */
export const aiServiceItem = storage.defineItem<{ up: boolean; checkedAt: string } | null>('local:aiService', { fallback: null });

/** Minutes a "some" or "little" day gives work the student put a time guess on. */
/**
 * The Ask Loomer thread to open: the last one the student used (chat:open), or
 * one Loomer switched to for topic help (reason 'topic', so the panel can say so).
 */
export const askThreadItem = storage.defineItem<{ threadKey: string; at: string; reason: 'student' | 'topic' } | null>('local:askThread', { fallback: null });

export const levelMinutesItem = storage.defineItem<LevelMinutes>('local:levelMinutes', { fallback: DEFAULT_LEVEL_MINUTES });
