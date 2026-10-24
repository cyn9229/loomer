import { AbsoluteFill, Freeze, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { INTRO_TAKE, TITLE } from './timeline.ts';
import { blurFilter } from './lib/filters.ts';
import { settle } from './lib/motion.ts';

/**
 * The opening title card. Slide 1 materializes from black (scale and blur
 * settle together), holds, then dissolves into the intro's first frame, so the
 * join into the main video is seamless.
 */
export function Title() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const enter = settle(t - 0.1, 0.9);
  const leave = settle(t - (TITLE.duration - 0.7), 0.45);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {leave > 0 && (
        <Freeze frame={0}>
          <OffthreadVideo
            src={staticFile(INTRO_TAKE.file)}
            trimBefore={Math.round(INTRO_TAKE.in * fps)}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.14)', transformOrigin: '50% 85%' }}
          />
        </Freeze>
      )}
      <AbsoluteFill
        style={{
          opacity: enter * (1 - leave),
          transform: `scale(${1.03 - 0.03 * enter + 0.02 * leave})`,
          filter: blurFilter((1 - enter) * 14 + leave * 12),
        }}
      >
        <Img src={staticFile(TITLE.file)} style={{ width: '100%', height: '100%' }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
