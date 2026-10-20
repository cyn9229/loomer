// Calm scrolling for a chat. Opening a thread starts at its latest message.
// When the student sends, their new message scrolls once to just under the
// sticky top bar, and a spacer below it keeps room for the reply. The reply
// streams into that room and nothing follows it, so the student reads at their
// own pace. As the reply grows, the spacer shrinks by the same amount, so the
// page never jumps. Used by Ask Loomer and the Working screen's chat.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatTurn } from '../model/chat';

/** Space between the top bar and a message pinned under it. */
const GAP = 12;

/**
 * Put `root` on the chat's outer element, `spacer` on an empty div right after
 * the turns (before the dock), and `data-turn={turn.id}` on each turn. Call
 * `sent()` when the student sends: the first turn newer than the latest one
 * now is the one that gets pinned.
 */
export function useChatScroll(threadKey: string, turns: ChatTurn[]) {
  const root = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  // Set by sent(): pin the first turn with a larger id. Turn ids only grow.
  const after = useRef<number | null>(null);
  const pinned = useRef<number | null>(null);
  // The thread whose turns are already in place, so opening scrolls only once.
  const placed = useRef<string | null>(null);
  const lastId = turns.at(-1)?.id ?? null;

  // Sizes the spacer so the pinned turn can sit under the bar with the dock below it.
  const fit = () => {
    const gap = spacer.current;
    const el = pinned.current === null ? null : turnEl(root.current, pinned.current);
    if (!gap || !el) return;
    const dock = root.current?.querySelector<HTMLElement>(':scope > .dock')?.offsetHeight ?? 0;
    const below = gap.getBoundingClientRect().top - el.getBoundingClientRect().top;
    gap.style.height = `${Math.max(0, window.innerHeight - topOffset() - dock - below)}px`;
  };

  useLayoutEffect(() => {
    after.current = null;
    pinned.current = null;
    if (spacer.current) spacer.current.style.height = '0px';
  }, [threadKey]);

  useLayoutEffect(() => {
    const target = after.current === null ? undefined : turns.find((t) => t.id > after.current!);
    if (target) {
      after.current = null;
      pinned.current = target.id;
      placed.current = threadKey;
      fit();
      const el = turnEl(root.current, target.id);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (el) window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - topOffset(), behavior: reduce ? 'instant' : 'smooth' });
      return;
    }
    if (placed.current !== threadKey && turns.length > 0) {
      placed.current = threadKey;
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
    // Only a new last turn or a new thread moves the page; a growing reply never does.
  }, [threadKey, lastId]);

  // A growing reply (or a visual that loads) resizes the chat: give back the same height from the spacer.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      fit();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  return {
    root,
    spacer,
    sent: () => {
      after.current = lastId ?? -1;
    },
  };
}

function turnEl(root: HTMLElement | null, id: number) {
  return root?.querySelector<HTMLElement>(`[data-turn="${id}"]`) ?? null;
}

/** Where a pinned message's top goes: under the sticky top bar, with a little air. */
function topOffset() {
  return (document.querySelector('header.bar')?.getBoundingClientRect().height ?? 0) + GAP;
}
