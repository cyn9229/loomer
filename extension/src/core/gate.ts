// The single authority on whether Loomer may read a URL for a purpose.
// Adapters and UI call checkCollect before every request and never re-implement
// these rules. Checks run in a fixed order and the first denial wins.
import type { PolicyState } from '../model/home';
import { hostMatches, parseSourceUrl } from './url';

export type Purpose = 'school-metadata' | 'linked-instructions' | 'work-doc' | 'research-capture';

/**
 * A student exclusion. `page` matches one exact path, or everything under a path
 * that ends in "/" (used for one Google Doc: `/document/d/<id>/`), so blocking a
 * page on a shared host never blocks the whole host.
 */
export type Exclusion =
  | { kind: 'host'; host: string; includeSubdomains: boolean }
  | { kind: 'page'; origin: string; path: string };

export function exclusionMatches(rule: Exclusion, url: URL): boolean {
  if (rule.kind === 'host') return hostMatches(url.hostname, rule.host, rule.includeSubdomains);
  return url.origin === rule.origin && (url.pathname === rule.path || (rule.path.endsWith('/') && url.pathname.startsWith(rule.path)));
}

/** pathPrefix narrows a grant to one document, e.g. `/document/d/<id>/`. */
export type Grant = { purpose: Purpose; origin: string; version: number; pathPrefix?: string };

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
  /^\/api\/v1\/courses\/\d+\/quizzes\/\d+$/,
  /^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+$/,
];

const ROUTES_BY_PURPOSE: Partial<Record<Purpose, readonly RegExp[]>> = {
  'school-metadata': CANVAS_METADATA_ROUTES,
  // Only the plain-text export of a granted Doc, never the editor or Drive.
  'work-doc': [/^\/document\/d\/[\w-]+\/export$/],
};

/** Page routes never captured as research on any host: sign-in, account, inbox, grades, payment. */
const RESEARCH_EXCLUDED_PATHS = /(^|\/)(login|log-in|signin|sign-in|logout|oauth|account|accounts|settings|password|checkout|cart|payment|billing|inbox|messages|conversations|grades|gradebook)(\/|$)/i;

export function checkCollect(state: GateState, purpose: Purpose, input: string | URL): GateDecision {
  const url = parseSourceUrl(input);
  if (!url) return { allowed: false, reason: 'unsupported-url' };
  if (state.paused) return { allowed: false, reason: 'paused' };

  if (BUILT_IN_EXCLUDED_HOSTS.some((rule) => hostMatches(url.hostname, rule.host, rule.includeSubdomains))) {
    return { allowed: false, reason: 'built-in-exclusion' };
  }
  if (state.exclusions.some((rule) => exclusionMatches(rule, url))) return { allowed: false, reason: 'user-exclusion' };

  if (purpose === 'research-capture' && RESEARCH_EXCLUDED_PATHS.test(url.pathname)) {
    return { allowed: false, reason: 'built-in-exclusion' };
  }

  const grant = state.grants.find(
    (g) => g.purpose === purpose && g.origin === url.origin && (!g.pathPrefix || url.pathname.startsWith(g.pathPrefix)),
  );
  if (!grant) return { allowed: false, reason: 'no-grant' };

  const routes = ROUTES_BY_PURPOSE[purpose];
  if (routes && !routes.some((route) => route.test(url.pathname))) {
    return { allowed: false, reason: 'route-not-supported' };
  }
  return { allowed: true, url, grantVersion: grant.version };
}

/** What the AI call is for. Instructions-only analysis is organizing; work help touches the student's work. */
export type AiPurpose = 'requirements-analysis' | 'work-help';

export type PolicyAnswer = 'teacher-allows-help' | 'teacher-forbids-ai' | 'not-sure';

export type AiDenyReason = 'ai-off' | 'policy-blocked' | 'policy-limited' | 'policy-unresolved' | 'needs-policy-answer';

/**
 * Whether content may go to cloud AI for a purpose. Runs before every dispatch and
 * again before a result is stored. A student answer can resolve ambiguity or
 * absence, but never overrides a detected restriction or unreadable instructions.
 */
export function checkAiDispatch(input: {
  aiEnabled: boolean;
  policy: { state: PolicyState; unresolvedBecause: 'unreadable' | 'ambiguous' | null };
  answer: PolicyAnswer | undefined;
  purpose: AiPurpose;
}): { allowed: true } | { allowed: false; reason: AiDenyReason } {
  const { aiEnabled, policy, answer, purpose } = input;
  if (!aiEnabled) return { allowed: false, reason: 'ai-off' };
  if (policy.state === 'blocked' || answer === 'teacher-forbids-ai') return { allowed: false, reason: 'policy-blocked' };
  switch (policy.state) {
    case 'permitted':
      return { allowed: true };
    case 'limited':
      return purpose === 'requirements-analysis' ? { allowed: true } : { allowed: false, reason: 'policy-limited' };
    case 'unresolved':
      return policy.unresolvedBecause === 'ambiguous' && answer === 'teacher-allows-help'
        ? { allowed: true }
        : { allowed: false, reason: 'policy-unresolved' };
    case 'none-found':
      return purpose === 'requirements-analysis' || answer === 'teacher-allows-help'
        ? { allowed: true }
        : { allowed: false, reason: 'needs-policy-answer' };
  }
}
