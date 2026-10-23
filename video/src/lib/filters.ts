/** A CSS blur filter, or nothing once it is too small to see (filters cost time on every frame). */
export const blurFilter = (px: number) => (px > 0.05 ? `blur(${px.toFixed(2)}px)` : undefined);
