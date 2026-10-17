// URL rules shared by the gate and adapters. Hosts are always compared after
// parsing, never by substring, so "canvas.evil.com" cannot pass as a Canvas host.

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Parses a URL Loomer may reason about: https anywhere, or http on loopback
 * (the labeled local replay). Rejects URLs that carry credentials.
 */
export function parseSourceUrl(input: string | URL): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLoopback(url)) return url;
  return null;
}

export function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

/** Exact host match, or a true subdomain when the rule explicitly includes subdomains. */
export function hostMatches(host: string, ruleHost: string, includeSubdomains = false): boolean {
  const h = host.toLowerCase();
  const r = ruleHost.toLowerCase();
  return h === r || (includeSubdomains && h.endsWith(`.${r}`));
}

const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i;

/** Link form for storage: no fragment, no tracking parameters. */
export function canonicalLink(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}
