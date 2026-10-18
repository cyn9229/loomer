// The real loomer artwork (cut from the user's logo image, served from
// public/brand). Logo is the horizontal lockup, mark plus wordmark; LogoMark is
// the mark alone where space is tight. `onDark` picks the variant whose
// near-black parts are white, for dark or colored backgrounds. Sources are
// about 4x the largest size used here, so the browser only ever scales down.

const LOCKUP_RATIO = 954 / 224;
const MARK_RATIO = 332 / 315;

export function Logo({ height = 22, onDark = false }: { height?: number; onDark?: boolean }) {
  return (
    <img
      className="logo"
      src={onDark ? '/brand/loomer-lockup-on-dark.png' : '/brand/loomer-lockup.png'}
      alt="loomer"
      height={height}
      width={Math.round(height * LOCKUP_RATIO)}
    />
  );
}

/** The mark alone. Decorative by default (next to text that already names Loomer). */
export function LogoMark({ size = 18, onDark = false, label }: { size?: number; onDark?: boolean; label?: string }) {
  return (
    <img
      className="logo"
      src={onDark ? '/brand/loomer-mark-on-dark.png' : '/brand/loomer-mark.png'}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      height={size}
      width={Math.round(size * MARK_RATIO)}
    />
  );
}
