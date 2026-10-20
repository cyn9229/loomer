// A bottom sheet over the panel: a dimmed backdrop and a panel that slides up
// once. Escape and a tap on the backdrop call onClose (not while busy), so a
// sheet never traps the student. Rendered in a portal on <body>: the screen
// animates with a transform, which would pin a fixed layer to it instead of
// the panel. Used by the end card and the add/edit assignment form.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type SheetProps = {
  /** The id of the element that names the sheet (aria-labelledby). */
  labelledBy: string;
  onClose: () => void;
  /** While true, Escape and the backdrop do nothing. */
  busy?: boolean;
  /** What the backdrop says to screen readers, e.g. "Keep going" or "Close". */
  closeLabel?: string;
  children: ReactNode;
};

export function Sheet({ labelledBy, onClose, busy = false, closeLabel = 'Close', children }: SheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [busy, onClose]);

  return createPortal(
    <div className="bsheet-layer">
      <button type="button" className="bsheet-dim" aria-label={closeLabel} tabIndex={-1} onClick={() => !busy && onClose()} />
      <section className="bsheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <span className="bsheet-grab" aria-hidden="true" />
        {children}
      </section>
    </div>,
    document.body,
  );
}
