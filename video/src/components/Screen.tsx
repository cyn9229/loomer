import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { DEMO_END, DEMO_START, GMAIL_TAB, GMAIL_TAB_SRC, SCREEN, SCREEN_KEEP, fromSrc, toSrc } from '../timeline.ts';
import { settle } from '../lib/motion.ts';
import { screenTransform } from '../lib/zoom.ts';

/**
 * The screen recording with its cuts, the punch-in zooms, and a blur over the
 * Gmail tab whenever it is on screen. It materializes in (scale and blur settle
 * together) as the demo starts.
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

  return (
    <AbsoluteFill style={{ opacity: enter, filter: `blur(${((1 - enter) * 12).toFixed(2)}px)`, transform: `scale(${1.04 - 0.04 * enter})` }}>
      <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: '0 0' }}>
        {SCREEN_KEEP.map(([a, b]) => (
          <Sequence key={a} from={Math.round(fromSrc(a) * fps)} durationInFrames={Math.round((b - a) * fps)}>
            <OffthreadVideo src={staticFile(SCREEN)} startFrom={Math.round(a * fps)} muted />
          </Sequence>
        ))}
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
