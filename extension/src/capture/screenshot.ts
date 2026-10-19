// Deliberate screenshot fallback for pages Loomer cannot read as text. A
// right-click captures the visible tab into a memory-only draft; nothing is
// saved until the student previews, crops, and confirms. Cancel discards the
// raw image. Screenshots are partial visual evidence and are not sent to AI.
import { storage } from 'wxt/utils/storage';
import type { LoomerDb } from '../core/db';
import { checkCollect, type GateState } from '../core/gate';
import { contentHash } from '../core/hash';
import { canonicalLink } from '../core/url';
import { currentSession, touch } from '../session/session';

export type ScreenshotDraft = {
  sessionId: number;
  assignmentId: string;
  url: string;
  title: string;
  /** Full visible-tab capture, JPEG data URL. Held in chrome.storage.session only. */
  dataUrl: string;
  width: number;
  height: number;
  at: string;
} | null;

export const screenshotDraftItem = storage.defineItem<ScreenshotDraft>('session:screenshot', { fallback: null });

export type ScreenshotRefusal = 'paused' | 'no-session' | 'excluded' | 'sign-in-page' | 'unreadable';

/** The same gate as page capture, applied to the tab before anything is captured. */
export function screenshotAllowed(gate: GateState, url: string | undefined): boolean {
  if (!url) return false;
  try {
    const origin = new URL(url).origin;
    const trial: GateState = { ...gate, grants: [...gate.grants, { purpose: 'research-capture', origin, version: 0 }] };
    return checkCollect(trial, 'research-capture', url).allowed;
  } catch {
    return false;
  }
}

export type CaptureTools = {
  /** True when the page has a password field (checked by script before capturing). */
  hasPasswordField: (tabId: number) => Promise<boolean>;
  captureVisible: (windowId: number) => Promise<string>;
  imageSize: (dataUrl: string) => Promise<{ width: number; height: number }>;
};

/** Captures the visible tab into the draft, or explains why not. */
export async function draftScreenshot(
  db: LoomerDb,
  gate: GateState,
  tab: { id?: number; windowId?: number; url?: string; title?: string },
  now: Date,
  tools: CaptureTools,
): Promise<{ ok: true } | { ok: false; reason: ScreenshotRefusal }> {
  if (gate.paused) return { ok: false, reason: 'paused' };
  const session = await currentSession(db, now);
  if (!session || session.state !== 'active') return { ok: false, reason: 'no-session' };
  if (!tab.id || tab.windowId === undefined || !screenshotAllowed(gate, tab.url)) return { ok: false, reason: 'excluded' };
  try {
    // Never capture sign-in or payment screens, even deliberately.
    if (await tools.hasPasswordField(tab.id)) return { ok: false, reason: 'sign-in-page' };
    const dataUrl = await tools.captureVisible(tab.windowId);
    const { width, height } = await tools.imageSize(dataUrl);
    await screenshotDraftItem.setValue({
      sessionId: session.id,
      assignmentId: session.assignmentId,
      url: canonicalLink(tab.url!) ?? tab.url!,
      title: (tab.title || new URL(tab.url!).hostname).slice(0, 300),
      dataUrl,
      width,
      height,
      at: now.toISOString(),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export type Crop = { x: number; y: number; width: number; height: number };

/**
 * Saves the cropped draft as a source, after re-checking the session and gate
 * (a block or pause added during preview wins). Clears the draft either way.
 */
export async function saveScreenshot(
  db: LoomerDb,
  gate: GateState,
  crop: Crop,
  now: Date,
  cropImage: (dataUrl: string, crop: Crop) => Promise<string>,
): Promise<{ ok: boolean; error?: string }> {
  const draft = await screenshotDraftItem.getValue();
  await screenshotDraftItem.setValue(null);
  if (!draft) return { ok: false, error: 'No screenshot is waiting.' };
  const session = await currentSession(db, now);
  if (gate.paused || session?.id !== draft.sessionId || session.state !== 'active') return { ok: false, error: 'The session is no longer active.' };
  if (!screenshotAllowed(gate, draft.url)) return { ok: false, error: 'This site is now blocked.' };

  const bounded: Crop = {
    x: Math.max(0, Math.min(crop.x, draft.width - 1)),
    y: Math.max(0, Math.min(crop.y, draft.height - 1)),
    width: Math.max(1, Math.min(crop.width, draft.width - crop.x)),
    height: Math.max(1, Math.min(crop.height, draft.height - crop.y)),
  };
  const image = await cropImage(draft.dataUrl, bounded);
  const at = now.toISOString();
  await db.sources.add({
    id: crypto.randomUUID(),
    assignmentId: draft.assignmentId,
    sessionId: draft.sessionId,
    url: draft.url,
    title: draft.title,
    capturedAt: at,
    excerpt: '',
    hash: await contentHash(image),
    kind: 'screenshot',
    image,
  });
  await db.sessionEvents.add({ sessionId: draft.sessionId, assignmentId: draft.assignmentId, at, kind: 'source-added', title: `Screenshot: ${draft.title}` });
  await touch(db, session, now);
  return { ok: true };
}
