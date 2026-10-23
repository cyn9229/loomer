import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { HEIGHT, WIDTH } from '../timeline.ts';
import { clamp, during, lerp, ramp, settle } from '../lib/motion.ts';
import { PLACED, mapBox, screenTransform, zoomOf, type Placed } from '../lib/zoom.ts';
import { blurFilter } from '../lib/filters.ts';
import { glass, ink } from './style.ts';

const ORANGE = '#fc4811';
const CARD_W = 520;

/**
 * The graphics for each demo callout: the frame dims except a rounded cutout
 * on the target, an orange ring draws around it, a short line reaches out, and
 * a glass card grows out of the target side with one headline and one line of
 * detail. Everything leaves along the way it came.
 */
export function Callouts() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const c = PLACED.find((p) => t >= p.start - 0.1 && t <= p.end + 0.8);
  return c ? <One c={c} t={t} /> : null;
}

function One({ c, t }: { c: Placed; t: number }) {
  const z = zoomOf(c, t);
  const [bx0, by0, bx1, by1] = mapBox(c.box, screenTransform(t));
  const x0 = bx0 - 14;
  const y0 = by0 - 12;
  const x1 = bx1 + 14;
  const y1 = by1 + 12;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  const leave = c.end - 0.75;
  const ring = ramp(t, c.start + 0.55, 0.6) * (1 - settle(t - leave, 0.4));
  const wire = ramp(t, c.start + 0.85, 0.45) * (1 - settle(t - leave, 0.4));
  const card = during(t, c.start + 1.0, leave, 0.6, 0.45);

  // Card placement and the line from the ring to it.
  const GAP = 64;
  let card_x: number;
  let card_y: number;
  let anchor: string;
  let wireFrom: [number, number];
  let wireTo: [number, number];
  let drift: [number, number];
  if (c.side === 'left') {
    card_x = clamp(x0 - GAP - CARD_W, 60, WIDTH - 60 - CARD_W);
    card_y = clamp(cy, 130, HEIGHT - 230);
    anchor = 'translateY(-50%)';
    wireFrom = [x0, cy];
    wireTo = [card_x + CARD_W, cy];
    drift = [1, 0];
  } else {
    card_x = clamp(cx - CARD_W / 2, 60, WIDTH - 60 - CARD_W);
    const above = c.side === 'above';
    card_y = above ? y0 - GAP : y1 + GAP;
    anchor = above ? 'translateY(-100%)' : 'none';
    wireFrom = [cx, above ? y0 : y1];
    wireTo = [cx, card_y];
    drift = [0, above ? 1 : -1];
  }
  const ex = lerp(wireFrom[0], wireTo[0], wire);
  const ey = lerp(wireFrom[1], wireTo[1], wire);

  // Spotlight: one path, the whole frame minus a rounded rectangle.
  const r = 16;
  const hole =
    `M-20 -20H${WIDTH + 20}V${HEIGHT + 20}H-20Z ` +
    `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}` +
    `H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;

  return (
    <AbsoluteFill>
      <svg width={WIDTH} height={HEIGHT} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <filter id="soft" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <path d={hole} fill="rgb(6,6,10)" fillRule="evenodd" filter="url(#soft)" opacity={0.62 * z} />
        <rect
          x={x0}
          y={y0}
          width={x1 - x0}
          height={y1 - y0}
          rx={r}
          fill="none"
          stroke={ORANGE}
          strokeWidth={3.5}
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - ring}
          style={{ filter: 'drop-shadow(0 0 7px rgba(252,72,17,0.7))' }}
        />
        <line x1={wireFrom[0]} y1={wireFrom[1]} x2={ex} y2={ey} stroke={ORANGE} strokeWidth={2.5} strokeLinecap="round" opacity={wire > 0.01 ? 1 : 0} />
        <circle cx={wireFrom[0]} cy={wireFrom[1]} r={5.5} fill={ORANGE} opacity={ring} />
      </svg>
      <div
        style={{
          ...glass,
          position: 'absolute',
          left: card_x,
          top: card_y,
          width: CARD_W,
          padding: '26px 30px 28px',
          borderRadius: 22,
          opacity: card,
          transform: `${anchor} translate(${(1 - card) * 26 * drift[0]}px, ${(1 - card) * 26 * drift[1]}px) scale(${0.955 + 0.045 * card})`,
          filter: blurFilter((1 - card) * 9),
        }}
      >
        <Rise t={t} at={c.start + 1.12} leave={leave}>
          <div style={{ ...ink, font: '600 38px/1.12 Inter', whiteSpace: 'nowrap', letterSpacing: '-0.024em' }}>{c.headline}</div>
        </Rise>
        <Rise t={t} at={c.start + 1.24} leave={leave}>
          <div style={{ font: '400 21px/1.42 Inter', color: 'rgba(255,255,255,0.76)', marginTop: 10 }}>{c.detail}</div>
        </Rise>
      </div>
    </AbsoluteFill>
  );
}

/** Text that rises a little as it fades in, after its card. */
function Rise({ t, at, leave, children }: { t: number; at: number; leave: number; children: ReactNode }) {
  const p = during(t, at, leave, 0.5, 0.4);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 10}px)` }}>{children}</div>;
}
