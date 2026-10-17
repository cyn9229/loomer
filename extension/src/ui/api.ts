// What the panel may do to the outside world. The live panel wires these to the
// service worker and Chrome; fixture previews wire them to a visible no-op, so
// UI code never calls `browser` directly and renders the same in both modes.
import { useState } from 'react';
import type { Message, Reply } from '../core/messages';

export type PanelApi = {
  send: (message: Message) => Promise<Reply>;
  /**
   * Asks Chrome for site access. Must be called first in a click handler, before
   * any await, so Chrome still sees the user gesture.
   */
  requestOrigins: (origins: string[]) => Promise<boolean>;
  openSettings: () => void;
};

/** Runs one action at a time and keeps its error for display next to the control. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<Reply>) => {
    setBusy(true);
    setError(null);
    work()
      .then((reply) => {
        if (!reply.ok) setError(reply.error);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return { busy, error, run, setError };
}
