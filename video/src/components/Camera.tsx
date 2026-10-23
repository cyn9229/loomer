import { OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CAMERA, CAMERA_KEYS, FULL, BR, type CameraClip } from '../timeline.ts';
import { clamp, ramp, track } from '../lib/motion.ts';

/**
 * The camera as one object: a frame that springs between full screen and the
 * corners (see CAMERA_KEYS), showing whichever take is placed at that moment.
 */
export function Camera() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const [x, y, w, h, radius, opacity, scale] = track(t, CAMERA_KEYS);
  // 1 at full screen, 0 as a picture-in-picture: shadows and the hairline only show on the small frame.
  const full = clamp((w - BR[2]) / (FULL[2] - BR[2]), 0, 1);
  const edge = 1 - full;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: radius,
        overflow: 'hidden',
        opacity,
        transform: `scale(${scale})`,
        background: '#111015',
        boxShadow: `0 24px 60px rgba(0,0,0,${0.5 * edge}), 0 0 0 1px rgba(255,255,255,${0.16 * edge})`,
      }}
    >
      {CAMERA.map((clip, i) => (
        <Sequence key={`${clip.file}-${clip.start}`} from={Math.round(clip.start * fps)} durationInFrames={Math.round((clip.end - clip.start) * fps)}>
          <Take clip={clip} fadeIn={i > 0} />
        </Sequence>
      ))}
    </div>
  );
}

/** One take, framed a little tighter (the ceiling was in shot) and lifted a touch (backlit by windows). */
function Take({ clip, fadeIn }: { clip: CameraClip; fadeIn: boolean }) {
  const { fps } = useVideoConfig();
  const local = useCurrentFrame() / fps;
  return (
    <OffthreadVideo
      src={staticFile(clip.file)}
      startFrom={Math.round(clip.from * fps)}
      muted
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity: fadeIn ? ramp(local, 0, 0.25) : 1,
        transform: 'scale(1.14)',
        transformOrigin: '50% 85%',
        filter: 'brightness(1.07) contrast(1.05) saturate(1.04)',
      }}
    />
  );
}
