import type { CSSProperties } from 'react';

/** Frosted dark glass: blurs whatever is behind it, with a hairline edge and a soft top highlight. */
export const glass: CSSProperties = {
  background: 'rgba(20, 19, 26, 0.58)',
  backdropFilter: 'blur(22px) saturate(150%)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
};

export const ink: CSSProperties = { color: '#fff' };
