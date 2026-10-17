// The single authority on whether Loomer may read a URL for a purpose.
// Adapters and UI call checkCollect before every request and never re-implement
// these rules. Checks run in a fixed order and the first denial wins.
import { hostMatches, parseSourceUrl } from './url';

export type Purpose = 'school-metadata' | 'linked-instructions' | 'work-doc' | 'research-capture';

export type Exclusion =
  | { kind: 'host'; host: string; includeSubdomains: boolean }
  | { kind: 'page'; origin: string; path: string };

export type Grant = { purpose: Purpose; origin: string; version: number };

export type GateState = {
  paused: boolean;
  exclusions: readonly Exclusion[];
  grants: readonly Grant[];
};

export type DenyReason =
  | 'unsupported-url'
  | 'paused'
  | 'built-in-exclusion'
  | 'user-exclusion'
  | 'no-grant'
  | 'route-not-supported';

export type GateDecision = { allowed: true; url: URL; grantVersion: number } | { allowed: false; reason: DenyReason };

/** Hosts Loomer never observes, whatever the student grants. Not a complete privacy list. */
const BUILT_IN_EXCLUDED_HOSTS: readonly { host: string; includeSubdomains: boolean }[] = [
  { host: 'mail.google.com', includeSubdomains: false },
  { host: 'accounts.google.com', includeSubdomains: false },
  { host: 'myaccount.google.com', includeSubdomains: false },
  { host: 'chat.google.com', includeSubdomains: false },
  { host: 'messages.google.com', includeSubdomains: false },
  { host: 'outlook.live.com', includeSubdomains: false },
  { host: 'outlook.office.com', includeSubdomains: false },
];

/**
 * Canvas API routes the school-metadata purpose may read. Positive list: any
 * other route (inbox, grades, rosters, profile) is denied even on a granted origin.
 */
const CANVAS_METADATA_ROUTES: readonly RegExp[] = [
  /^\/api\/v1\/users\/self$/,
  /^\/api\/v1\/courses$/,
  /^\/api\/v1\/planner\/items$/,
  /^\/api\/v1\/courses\/\d+$/,
  /^\/api\/v1\/courses\/\d+\/assignments$/,
  /^\/api\/v1\/courses\/\d+\/assignments\/\d+$/,
];

const ROUTES_BY_PURPOSE: Partial<Record<Purpose, readonly RegExp[]>> = {
  'school-metadata': CANVAS_METADATA_ROUTES,
};

export function checkCollect(state: GateState, purpose: Purpose, input: string | URL): GateDecision {
  const url = parseSourceUrl(input);
  if (!url) return { allowed: false, reason: 'unsupported-url' };
  if (state.paused) return { allowed: false, reason: 'paused' };

  if (BUILT_IN_EXCLUDED_HOSTS.some((rule) => hostMatches(url.hostname, rule.host, rule.includeSubdomains))) {
    return { allowed: false, reason: 'built-in-exclusion' };
  }
  const userExcluded = state.exclusions.some((rule) =>
    rule.kind === 'host'
      ? hostMatches(url.hostname, rule.host, rule.includeSubdomains)
      : url.origin === rule.origin && url.pathname === rule.path,
  );
  if (userExcluded) return { allowed: false, reason: 'user-exclusion' };

  const grant = state.grants.find((g) => g.purpose === purpose && g.origin === url.origin);
  if (!grant) return { allowed: false, reason: 'no-grant' };

  const routes = ROUTES_BY_PURPOSE[purpose];
  if (routes && !routes.some((route) => route.test(url.pathname))) {
    return { allowed: false, reason: 'route-not-supported' };
  }
  return { allowed: true, url, grantVersion: grant.version };
}
