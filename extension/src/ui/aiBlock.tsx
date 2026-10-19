// What Loomer's AI wrote gets one look everywhere: orange sparkles, an orange
// label, and a thin light-orange outline. New AI text flashes the outline once
// (about 1.5 s), then sits still. Only one block flashes at a time: when two are
// new together, the first one rendered wins and the rest just appear.
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';

const SEEN_KEY = 'loomer.aiSeen';
const SEEN_MAX = 60;
/** A block that is new within this long after another one flashed stays still. */
const ONE_AT_A_TIME_MS = 2500;
let lastFlash = 0;

/** Remembers `key` as shown. True only the first time this viewer sees it. */
function firstSight(key: string): boolean {
  try {
    const seen: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    const list = Array.isArray(seen) ? seen.filter((k): k is string => typeof k === 'string') : [];
    if (list.includes(key)) return false;
    localStorage.setItem(SEEN_KEY, JSON.stringify([key, ...list].slice(0, SEEN_MAX)));
    return true;
  } catch {
    // No storage (private window, blocked): never flash rather than flash every time.
    return false;
  }
}

/** True while this block should play its one-time flash. `key` names the text (null: never flash). */
function useAiFlash(key: string | null): boolean {
  const [flashing, setFlashing] = useState<string | null>(null);
  useEffect(() => {
    if (!key || !firstSight(key)) return;
    const now = Date.now();
    if (now - lastFlash < ONE_AT_A_TIME_MS) return;
    lastFlash = now;
    setFlashing(key);
  }, [key]);
  return flashing !== null && flashing === key;
}

/** The sparkles, filled with Loomer's orange-to-amber gradient. */
export function AiMark() {
  // useId can hold characters a CSS url() won't match, so keep only safe ones.
  const id = `ai-g${useId().replace(/[^\w-]/g, '')}`;
  return (
    <span className="ai-mark" style={{ '--ai-fill': `url(#${id})` } as CSSProperties}>
      <svg width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--acc)' }} />
            <stop offset="1" style={{ stopColor: 'var(--ai-amber)' }} />
          </linearGradient>
        </defs>
      </svg>
      <Icon name="sparkle" size="sm" />
    </span>
  );
}

type AiBlockProps = {
  label: string;
  /** Names this text, so it flashes once when new. Null: never flashes. */
  flashKey: string | null;
  /** Links or buttons at the right end of the label row. */
  right?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** A block of AI text with its label row. */
export function AiBlock({ label, flashKey, right, className, children }: AiBlockProps) {
  const flash = useAiFlash(flashKey);
  return (
    <section className={['ai-block', className, flash && 'flash'].filter(Boolean).join(' ')} aria-label={label}>
      <div className="ai-k">
        <AiMark />
        {label}
        <span className="grow" />
        {right}
      </div>
      {children}
    </section>
  );
}
