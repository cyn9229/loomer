import { Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BR, CAMERA_KEYS, CAMERA_SHOTS, FULL, type Shot } from '../timeline.ts';
import { clamp, ramp, track } from '../lib/motion.ts';

/**
 * The camera as one object: a frame that springs between full screen and the
 * corners (see CAMERA_KEYS), showing the shots in CAMERA_SHOTS.
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
        transform: scale === 1 ? undefined : `scale(${scale})`,
        background: '#111015',
        boxShadow: `0 24px 60px rgba(0,0,0,${0.5 * edge}), 0 0 0 1px rgba(255,255,255,${0.16 * edge})`,
      }}
    >
      {CAMERA_SHOTS.map((shot) => {
        const from = Math.round(shot.start * fps);
        return (
          <Sequence key={`${shot.file}-${from}-${shot.freeze ? 'hold' : 'play'}`} from={from} durationInFrames={Math.max(1, Math.round(shot.end * fps) - from)}>
            <Take shot={shot} />
          </Sequence>
        );
      })}
    </div>
  );
}

/**
 * One shot, framed a little tighter (the ceiling was in shot). The brightness
 * lift for the backlit room is baked into the media files; picture-in-picture
 * shots use the 640x360 copies (media/pip/), since they show at 336 px wide.
 */
function Take({ shot }: { shot: Shot }) {
  const { fps } = useVideoConfig();
  const local = useCurrentFrame() / fps;
  const video = (
    <OffthreadVideo
      src={staticFile(shot.small ? shot.file.replace('media/', 'media/pip/') : shot.file)}
      trimBefore={Math.max(0, Math.round(shot.from * fps))}
      muted
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity: shot.fade ? ramp(local, 0, shot.fade) : 1,
        transform: 'scale(1.14)',
        transformOrigin: '50% 85%',
      }}
    />
  );
  return shot.freeze ? <Freeze frame={0}>{video}</Freeze> : video;
}
