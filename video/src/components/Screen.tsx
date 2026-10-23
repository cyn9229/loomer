import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { DEMO_END, DEMO_START, GMAIL_TAB, GMAIL_TAB_SRC, SCREEN, SCREEN_EDIT, toSrc } from '../timeline.ts';
import { settle } from '../lib/motion.ts';
import { screenTransform } from '../lib/zoom.ts';

/**
 * The edited screen recording: each segment plays at its speed or holds one
 * frame, with the punch-in zooms on top and a blur over the Gmail tab whenever
 * it is on screen. It materializes in (scale and blur settle together) as the
 * demo starts.
 */
export function Screen() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  if (t < DEMO_START - 0.1 || t > DEMO_END + 1.2) return null;

  const enter = settle(t - DEMO_START, 0.7);
  const { s, tx, ty } = screenTransform(t);
  const src = toSrc(t);
  const tabVisible = GMAIL_TAB_SRC.some(([a, b]) => src >= a && src <= b);
  const [x0, y0, x1, y1] = GMAIL_TAB;
  // Filters cost time on every frame; only set them while they do something.
  const blur = (1 - enter) * 12;

  return (
    <AbsoluteFill style={{ opacity: enter, filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined, transform: enter < 0.999 ? `scale(${1.04 - 0.04 * enter})` : undefined }}>
      <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: '0 0' }}>
        {SCREEN_EDIT.map(({ t0, t1, seg }) => {
          const from = Math.round(t0 * fps);
          const frames = Math.round(t1 * fps) - from;
          if ('hold' in seg) {
            return (
              <Sequence key={from} from={from} durationInFrames={frames}>
                <Freeze frame={0}>
                  <OffthreadVideo src={staticFile(SCREEN)} trimBefore={Math.round(seg.hold * fps)} muted />
                </Freeze>
              </Sequence>
            );
          }
          return (
            <Sequence key={from} from={from} durationInFrames={frames}>
              <OffthreadVideo src={staticFile(SCREEN)} trimBefore={Math.round(seg.src[0] * fps)} playbackRate={seg.speed ?? 1} muted />
            </Sequence>
          );
        })}
        {tabVisible && (
          <div
            style={{
              position: 'absolute',
              left: x0,
              top: y0,
              width: x1 - x0,
              height: y1 - y0,
              borderRadius: 8,
              backdropFilter: 'blur(9px)',
              background: 'rgba(40, 40, 46, 0.35)',
            }}
          />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
