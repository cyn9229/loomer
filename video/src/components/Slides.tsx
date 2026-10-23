import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SLIDES } from '../timeline.ts';
import { blurFilter } from '../lib/filters.ts';
import { settle } from '../lib/motion.ts';

/**
 * Deck slides. Each one materializes (scale and blur settle together). A slide
 * either hides behind what comes next, or, when `reveal` is set, dissolves to
 * uncover it.
 */
export function Slides() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  return (
    <>
      {SLIDES.filter((s) => t >= s.start - 0.05 && t <= s.end + 1.2).map((s) => {
        const enter = settle(t - s.start, 0.75);
        const leave = s.reveal ? settle(t - s.end, 0.6) : settle(t - (s.end + 0.8), 0.3);
        const blur = (1 - enter) * 16 + (s.reveal ? leave * 10 : 0);
        return (
          <AbsoluteFill
            key={s.file}
            style={{
              opacity: Math.max(0, enter - leave),
              transform: `scale(${1.045 - 0.045 * enter - (s.reveal ? 0.03 * leave : 0)})`,
              filter: blurFilter(blur),
            }}
          >
            <Img src={staticFile(s.file)} style={{ width: '100%', height: '100%' }} />
          </AbsoluteFill>
        );
      })}
    </>
  );
}
