// Screenshot crop: the student right-clicked a page Loomer can't read as text.
// The capture lives only in memory (ScreenshotDraft) until Save sends
// screenshot:save with the crop in image pixels; Cancel discards it. The
// screen takes over the panel while a draft exists.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ScreenshotDraft } from '../capture/screenshot';
import { useAction, type PanelApi } from './api';
import { observedAt } from './format';
import { Icon } from './Icon';
import { hostOf } from './session';

type Draft = NonNullable<ScreenshotDraft>;
/** Crop rectangle as fractions (0..1) of the image, so it survives resizing. */
type Rect = { x: number; y: number; w: number; h: number };
type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; start: Rect };

const MIN = 0.06;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function ScreenshotView({ draft, now, api }: { draft: Draft; now: Date; api: PanelApi }) {
  const [rect, setRect] = useState<Rect>({ x: 0.08, y: 0.12, w: 0.84, h: 0.5 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const save = useAction();
  const cancel = useAction();

  const begin = (mode: Drag['mode']) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: rect };
  };

  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    const box = stage.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.startX) / box.width;
    const dy = (e.clientY - d.startY) / box.height;
    const s = d.start;
    if (d.mode === 'move') {
      setRect({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) });
      return;
    }
    // Resize from one corner; the opposite corner stays put.
    const left = d.mode === 'nw' || d.mode === 'sw' ? clamp(s.x + dx, 0, s.x + s.w - MIN) : s.x;
    const right = d.mode === 'ne' || d.mode === 'se' ? clamp(s.x + s.w + dx, s.x + MIN, 1) : s.x + s.w;
    const top = d.mode === 'nw' || d.mode === 'ne' ? clamp(s.y + dy, 0, s.y + s.h - MIN) : s.y;
    const bottom = d.mode === 'sw' || d.mode === 'se' ? clamp(s.y + s.h + dy, s.y + MIN, 1) : s.y + s.h;
    setRect({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const end = () => {
    drag.current = null;
  };

  const onSave = () =>
    save.run(() =>
      api.send({
        type: 'screenshot:save',
        crop: {
          x: Math.round(rect.x * draft.width),
          y: Math.round(rect.y * draft.height),
          width: Math.max(1, Math.round(rect.w * draft.width)),
          height: Math.max(1, Math.round(rect.h * draft.height)),
        },
      }),
    );

  const pct = (v: number) => `${v * 100}%`;
  return (
    <>
      <h1 className="w-title">Save a screenshot</h1>
      <p className="w-meta">Drag the box around the part you need.</p>
      <div className="crop-stage" ref={stage} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <img src={draft.dataUrl} alt={`Screenshot of ${draft.title}`} width={draft.width} height={draft.height} />
        <div
          className="crop-box"
          style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
          onPointerDown={begin('move')}
          role="group"
          aria-label="Crop area. Drag to move, drag a corner to resize."
        >
          {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
            <span key={c} className={`crop-handle ${c}`} onPointerDown={begin(c)} />
          ))}
        </div>
      </div>
      <div className="row-line">
        <Icon name="globe" />
        <span className="grow">
          <span className="row-title ellipsis">
            {draft.title}
          </span>
          <span className="row-sub">
            {hostOf(draft.url)} · {observedAt(draft.at, now)}
          </span>
        </span>
      </div>
      <p className="note" style={{ paddingTop: 4 }}>
        <Icon name="lock" />
        Screenshots stay on this computer. Loomer won’t send them to AI.
      </p>
      {(save.error ?? cancel.error) && <p className="status-line error pad">{save.error ?? cancel.error}</p>}
      <div className="dock">
        <div className="two">
          <button type="button" className="btn" disabled={save.busy || cancel.busy} aria-busy={cancel.busy} onClick={() => cancel.run(() => api.send({ type: 'screenshot:cancel' }))}>
            {cancel.busy ? 'Discarding…' : 'Cancel'}
          </button>
          <button type="button" className="btn-primary" disabled={save.busy || cancel.busy} aria-busy={save.busy} onClick={onSave}>
            {save.busy ? 'Saving…' : 'Save to sources'}
          </button>
        </div>
      </div>
    </>
  );
}
