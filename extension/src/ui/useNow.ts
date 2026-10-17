import { useEffect, useState } from 'react';

/** Current time, refreshed once a minute so relative dates stay right. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Whole seconds since `active` became true, ticking once per second; 0 when
 * inactive. A discrete counter, not an animation, so it costs one render a second.
 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!active) return;
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}
