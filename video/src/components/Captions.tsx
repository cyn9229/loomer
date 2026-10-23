import type { CSSProperties } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import pages from '../data/captions.json';
import { DEMO_START, PRIVACY_START, SLIDES } from '../timeline.ts';
import { clamp, ramp } from '../lib/motion.ts';
import { glass } from './style.ts';

type Page = { start: number; end: number; words: { t: number; text: string }[] };

const END_SLIDE = SLIDES[SLIDES.length - 1].start;

/**
 * Where the caption bar sits: beside the camera during the demo; centered low
 * elsewhere, below the slides' footer lines; a little higher on the end slide,
 * clear of its "Thank you" line.
 */
function place(t: number): CSSProperties {
  if (t >= DEMO_START && t < PRIVACY_START) return { left: 400, bottom: 58 };
  return { left: '50%', bottom: t >= END_SLIDE ? 120 : 30, translate: '-50% 0' };
}

/**
 * Captions for everything spoken, one short line at a time, in a small glass
 * bar. Words brighten as they are spoken.
 */
export function Captions() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const page = (pages as Page[]).find((p) => t >= p.start - 0.08 && t < p.end);
  if (!page) return null;
  const show = clamp((t - page.start + 0.08) / 0.15, 0, 1) * clamp((page.end - t) / 0.12, 0, 1);
  return (
    <div
      style={{
        ...glass,
        ...place(page.start),
        position: 'absolute',
        maxWidth: 760,
        width: 'max-content',
        padding: '12px 20px 13px',
        borderRadius: 16,
        font: '500 28px/1.3 Inter',
        letterSpacing: '-0.01em',
        color: '#fff',
        opacity: show,
        transform: `translateY(${(1 - show) * 6}px)`,
      }}
    >
      {page.words.map((w, i) => (
        <span key={i} style={{ opacity: 0.38 + 0.62 * ramp(t, w.t - 0.04, 0.14) }}>
          {i ? ' ' : ''}
          {w.text}
        </span>
      ))}
    </div>
  );
}
