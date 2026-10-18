// Model-made SVG cleanup in the worker (no DOM here). Defense in depth: the UI
// sanitizes again before inserting. Rejects anything that is not a plain SVG.

const MAX_SVG_CHARS = 40_000;

/** Returns a cleaned SVG string, or null when it is not safe or not an SVG. */
export function cleanSvg(input: string): string | null {
  const svg = input.trim();
  if (svg.length > MAX_SVG_CHARS || !/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return null;
  const cleaned = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Only in-document references (#id) and data: images survive.
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#|data:image\/)[^"]*"|'(?!#|data:image\/)[^']*')/gi, '')
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');
  return /<script|javascript:|<iframe|<object|<embed/i.test(cleaned) ? null : cleaned;
}
