// The loomer mark (three overlapping circles) and wordmark, plus the filled
// document glyph used inside assignment tiles.
import { useId } from 'react';

export function LogoMark({ size = 32 }: { size?: number }) {
  // Gradient ids must be unique per instance: several marks can share a page.
  const id = useId();
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6f7dff" />
          <stop offset="1" stopColor="#4d3cf2" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5a62ff" />
          <stop offset="1" stopColor="#3b2bd9" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="9.6" r="7.4" fill={`url(#${id}a)`} />
      <circle cx="8.9" cy="21.8" r="7.4" fill={`url(#${id}b)`} />
      <circle cx="23.1" cy="21.8" r="7.4" fill={`url(#${id}a)`} />
    </svg>
  );
}

export function Wordmark({ size }: { size?: number }) {
  return (
    <span className="wordmark" style={size ? { fontSize: size } : undefined}>
      loomer<i>.</i>
    </span>
  );
}

export function DocGlyph({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 4h10l6 6v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff" fillOpacity=".93" />
      <path d="M19 4v6h6" fill="#c9c4ff" />
      <rect x="11" y="14" width="10" height="2" rx="1" fill="#6a5df5" />
      <rect x="11" y="18" width="10" height="2" rx="1" fill="#6a5df5" />
      <rect x="11" y="22" width="6" height="2" rx="1" fill="#6a5df5" />
    </svg>
  );
}
