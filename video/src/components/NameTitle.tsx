import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { NAME_TITLE } from '../timeline.ts';
import { during } from '../lib/motion.ts';

/** Name and role over the opening camera shot; each line rises out of a mask and leaves the same way. */
export function NameTitle() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const [start, end] = NAME_TITLE;
  if (t > end + 1) return null;
  const name = during(t, start, end, 0.6, 0.45);
  const role = during(t, start + 0.12, end - 0.07, 0.6, 0.45);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent 45%)', opacity: name }} />
      <div style={{ position: 'absolute', left: 96, bottom: 104 }}>
        <div style={{ overflow: 'hidden', paddingBottom: 4 }}>
          <div style={{ font: '600 76px/1.05 Inter', letterSpacing: '-0.03em', color: '#fff', transform: `translateY(${(1 - name) * 110}%)` }}>Chris Nie</div>
        </div>
        <div style={{ overflow: 'hidden', marginTop: 6 }}>
          <div style={{ font: '400 30px/1.3 Inter', letterSpacing: '-0.005em', color: 'rgba(255,255,255,0.78)', transform: `translateY(${(1 - role) * 130}%)` }}>
            Creator of Loomer
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
