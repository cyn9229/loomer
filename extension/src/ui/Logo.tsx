// The loomer mark (three overlapping circles) and the wordmark.
import { useId } from 'react';

/** `light` draws the mark in white for the violet band. */
export function LogoMark({ size = 32, light }: { size?: number; light?: boolean }) {
  // Gradient ids must be unique per instance: several marks can share a page.
  const id = useId();
  if (light) {
    return (
      <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="9.6" r="7.4" fill="#fff" fillOpacity=".95" />
        <circle cx="8.9" cy="21.8" r="7.4" fill="#fff" fillOpacity=".75" />
        <circle cx="23.1" cy="21.8" r="7.4" fill="#fff" fillOpacity=".55" />
      </svg>
    );
  }
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
      loomer
    </span>
  );
}
