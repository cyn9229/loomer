import { useCurrentFrame, useVideoConfig } from 'remotion';
import { CHAPTERS } from '../timeline.ts';
import { blurFilter } from '../lib/filters.ts';
import { during } from '../lib/motion.ts';
import { glass } from './style.ts';

const SHOW = 2.6;

/**
 * Chapter titles over the demo: a short title in a glass card, top left over
 * the web page, as each part's narration starts. It materializes (blur, scale
 * and rise settle together), its words follow in a quick stagger, and it
 * leaves the way it came.
 */
export function Chapters() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const c = CHAPTERS.find((x) => t >= x.at - 0.1 && t < x.at + SHOW + 0.8);
  if (!c) return null;
  const p = during(t, c.at, c.at + SHOW, 0.6, 0.45);
  const words = c.title.split(' ');
  return (
    <div
      style={{
        ...glass,
        position: 'absolute',
        left: 56,
        top: 138,
        padding: '18px 28px 20px',
        borderRadius: 20,
        opacity: p,
        transform: `translateY(${(1 - p) * 16}px) scale(${0.965 + 0.035 * p})`,
        transformOrigin: '0 50%',
        filter: blurFilter((1 - p) * 8),
      }}
    >
      <div style={{ font: '600 46px/1.1 Inter', letterSpacing: '-0.028em', color: '#fff', whiteSpace: 'nowrap' }}>
        {words.map((w, i) => {
          const q = during(t, c.at + 0.08 + i * 0.07, c.at + SHOW, 0.5, 0.4);
          return (
            <span key={i} style={{ display: 'inline-block', opacity: q, transform: `translateY(${(1 - q) * 0.35}em)` }}>
              {i ? ' ' : ''}
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
}
