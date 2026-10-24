import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { DEMO_END, DEMO_START, SCREEN, SCREEN_CHUNKS } from '../timeline.ts';
import { settle } from '../lib/motion.ts';
import { screenTransform } from '../lib/zoom.ts';

/**
 * The edited screen recording (kept stretches, faster waits, freeze frames,
 * with speed changes eased; see screenSrc) under the punch-in zooms. It
 * materializes in (scale and blur settle together) as the demo starts, and
 * holds its last frame while fading out as the demo ends.
 */
export function Screen() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  if (t < DEMO_START - 0.1 || t > DEMO_END + 1.2) return null;

  const enter = settle(t - DEMO_START, 0.7);
  // After the demo the last frame holds and fades out while the camera grows to full screen.
  const leave = settle(t - DEMO_END, 0.45);
  const last = SCREEN_CHUNKS[SCREEN_CHUNKS.length - 1];
  const { s, tx, ty } = screenTransform(t);
  // Filters cost time on every frame; only set them while they do something.
  const blur = (1 - enter) * 12 + leave * 10;

  return (
    <AbsoluteFill style={{ opacity: enter * (1 - leave), filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined, transform: enter < 0.999 ? `scale(${1.04 - 0.04 * enter})` : undefined }}>
      <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: '0 0' }}>
        {SCREEN_CHUNKS.map((c) => {
          const video = <OffthreadVideo src={staticFile(SCREEN)} trimBefore={Math.round(c.src)} playbackRate={c.rate || 1} muted />;
          return (
            <Sequence key={c.from} from={c.from} durationInFrames={c.to - c.from}>
              {c.rate ? video : <Freeze frame={0}>{video}</Freeze>}
            </Sequence>
          );
        })}
        <Sequence from={last.to} durationInFrames={Math.round(1.2 * fps)}>
          <Freeze frame={0}>
            <OffthreadVideo src={staticFile(SCREEN)} trimBefore={Math.round(last.src + (last.to - 1 - last.from) * last.rate)} muted />
          </Freeze>
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
