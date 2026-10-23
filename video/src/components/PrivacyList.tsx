import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { PRIVACY_LIST } from '../timeline.ts';
import { settle } from '../lib/motion.ts';

const ORANGE = '#fc4811';

/**
 * The privacy section's graphic: one headline, then each control appears as it
 * is said. Shown on the deck's dark background with the camera in the corner.
 */
export function PrivacyList() {
  const { fps } = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const [start, end] = PRIVACY_LIST.range;
  if (t < start - 0.3 || t > end + 1.2) return null;
  const bg = settle(t - (start - 0.15), 0.3) - settle(t - (end + 0.8), 0.3);
  const title = settle(t - (start + 0.15), 0.7);
  return (
    <AbsoluteFill style={{ background: '#15141a', opacity: bg, padding: '170px 160px' }}>
      <div
        style={{
          font: '600 76px/1.05 Inter',
          letterSpacing: '-0.032em',
          color: '#fff',
          opacity: title,
          transform: `translateY(${(1 - title) * 18}px)`,
          filter: `blur(${((1 - title) * 8).toFixed(2)}px)`,
        }}
      >
        {PRIVACY_LIST.title}
      </div>
      <div style={{ marginTop: 64, display: 'flex', flexDirection: 'column', gap: 34 }}>
        {PRIVACY_LIST.items.map((item) => {
          const p = settle(t - item.at, 0.65);
          return (
            <div
              key={item.text}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 26,
                opacity: p,
                transform: `translateY(${(1 - p) * 16}px)`,
                filter: `blur(${((1 - p) * 6).toFixed(2)}px)`,
              }}
            >
              <svg width={38} height={38} viewBox="0 0 38 38" style={{ flex: 'none' }}>
                <circle cx={19} cy={19} r={17.5} fill="none" stroke={ORANGE} strokeWidth={2.5} />
                <path d="M11.5 19.5l5 5 10-11" fill="none" stroke={ORANGE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ font: '500 42px/1.2 Inter', letterSpacing: '-0.018em', color: 'rgba(255,255,255,0.94)' }}>{item.text}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
