// The loomer mark (three overlapping circles: ink, persimmon, light persimmon)
// and the wordmark.
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="9.6" r="7.4" fill="#23211e" />
      <circle cx="8.9" cy="21.8" r="7.4" fill="#f2551d" />
      <circle cx="23.1" cy="21.8" r="7.4" fill="#f7a07c" />
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
