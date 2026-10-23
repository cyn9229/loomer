// Motion helpers. Every value is a pure function of time in seconds, so any
// frame renders on its own (Remotion renders frames out of order, in parallel).

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/**
 * Progress (0 to 1) of a critically damped spring started `t` seconds ago:
 * it settles without overshoot. `response` is roughly the settle time.
 */
export function settle(t: number, response: number): number {
  if (t <= 0) return 0;
  const w = (2 * Math.PI) / response;
  return 1 - (1 + w * t) * Math.exp(-w * t);
}

/** Springs in at `start` and out at `end`. */
export const during = (t: number, start: number, end: number, rin = 0.6, rout = 0.45) =>
  settle(t - start, rin) - settle(t - end, rout);

/** Ease-out (quartic) from 0 to 1 over `duration` seconds. */
export function ramp(t: number, start: number, duration: number): number {
  const p = clamp((t - start) / duration, 0, 1);
  return 1 - (1 - p) ** 4;
}

/**
 * Keyframed numbers where each key springs from wherever the value is at that
 * moment, so moves never jump even when they overlap.
 */
export function track<T extends readonly number[]>(t: number, keys: readonly { t: number; frame: T; response: number }[]): number[] {
  const value = [...keys[0].frame];
  for (let i = 1; i < keys.length; i++) {
    const p = settle(t - keys[i].t, keys[i].response);
    if (p === 0) break;
    keys[i].frame.forEach((v, j) => {
      value[j] += (v - keys[i - 1].frame[j]) * p;
    });
  }
  return value;
}
