// Punch-in zooms for the demo callouts. The screen layer and the callout
// graphics share this, so the ring always sits exactly on its target.
import { CALLOUTS, HEIGHT, WIDTH, fromSrc, type Box, type Callout } from '../timeline.ts';
import { clamp, settle } from './motion.ts';

/** A callout on the final timeline, with the translate that frames its target when fully zoomed. */
export type Placed = Callout & { start: number; end: number; tx: number; ty: number };

/** Moves the target 30% of the way toward the frame center, without ever showing past the recording's edges. */
export const PLACED: readonly Placed[] = CALLOUTS.map((c) => {
  const [x0, y0, x1, y1] = c.box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dx = cx + (WIDTH / 2 - cx) * 0.3;
  const dy = cy + (HEIGHT / 2 - cy) * 0.3;
  return {
    ...c,
    start: fromSrc(c.src[0]),
    end: fromSrc(c.src[1]),
    tx: clamp(dx - cx * c.zoom, WIDTH * (1 - c.zoom), 0),
    ty: clamp(dy - cy * c.zoom, HEIGHT * (1 - c.zoom), 0),
  };
});

/** How far a callout's punch-in is (0 to 1) at time t. It is fully out again as the still stretch ends. */
export const zoomOf = (c: Placed, t: number) => settle(t - c.start, 0.9) - settle(t - (c.end - 0.55), 0.75);

export type Transform = { s: number; tx: number; ty: number };

/** The screen transform at time t: a point p maps to p * s + (tx, ty). */
export function screenTransform(t: number): Transform {
  const out = { s: 1, tx: 0, ty: 0 };
  for (const c of PLACED) {
    const z = zoomOf(c, t);
    if (z <= 0.0005) continue;
    out.s += (c.zoom - 1) * z;
    out.tx += c.tx * z;
    out.ty += c.ty * z;
  }
  return out;
}

export const mapBox = ([x0, y0, x1, y1]: Box, { s, tx, ty }: Transform): Box => [x0 * s + tx, y0 * s + ty, x1 * s + tx, y1 * s + ty];
