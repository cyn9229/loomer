import { describe, expect, it } from 'vitest';
import { checkCollect, type GateState } from './gate';
import { canonicalLink, hostMatches, parseSourceUrl } from './url';

const school = 'https://school.instructure.com';
const state = (over: Partial<GateState> = {}): GateState => ({
  paused: false,
  exclusions: [],
  grants: [{ purpose: 'school-metadata', origin: school, version: 3 }],
  ...over,
});

describe('url rules', () => {
  it('matches hosts exactly, never by substring', () => {
    expect(hostMatches('school.instructure.com', 'school.instructure.com')).toBe(true);
    expect(hostMatches('school.instructure.com.evil.com', 'school.instructure.com')).toBe(false);
    expect(hostMatches('evilschool.instructure.com', 'school.instructure.com', true)).toBe(false);
    expect(hostMatches('a.docs.example.com', 'docs.example.com', false)).toBe(false);
    expect(hostMatches('a.docs.example.com', 'docs.example.com', true)).toBe(true);
  });

  it('accepts https and loopback http only, and rejects embedded credentials', () => {
    expect(parseSourceUrl('http://example.com')).toBeNull();
    expect(parseSourceUrl('http://127.0.0.1:8787/api')).not.toBeNull();
    expect(parseSourceUrl('https://user:pw@example.com')).toBeNull();
  });

  it('strips fragments and tracking parameters from stored links', () => {
    expect(canonicalLink('/files/9?utm_source=x&wrap=1#top', school)).toBe(`${school}/files/9?wrap=1`);
  });
});

describe('checkCollect', () => {
  it('allows supported Canvas routes on the granted origin and returns the grant version', () => {
    const d = checkCollect(state(), 'school-metadata', `${school}/api/v1/planner/items?per_page=50`);
    expect(d).toMatchObject({ allowed: true, grantVersion: 3 });
  });

  it('denies unsupported routes such as the inbox or rosters on a granted origin', () => {
    expect(checkCollect(state(), 'school-metadata', `${school}/api/v1/conversations`)).toEqual({ allowed: false, reason: 'route-not-supported' });
    expect(checkCollect(state(), 'school-metadata', `${school}/api/v1/courses/1/users`)).toEqual({ allowed: false, reason: 'route-not-supported' });
  });

  it('denies lookalike origins and other purposes', () => {
    expect(checkCollect(state(), 'school-metadata', 'https://school.instructure.com.evil.com/api/v1/courses')).toEqual({ allowed: false, reason: 'no-grant' });
    expect(checkCollect(state(), 'research-capture', `${school}/api/v1/courses`)).toEqual({ allowed: false, reason: 'no-grant' });
  });

  it('applies pause and exclusions before grants', () => {
    expect(checkCollect(state({ paused: true }), 'school-metadata', `${school}/api/v1/courses`)).toEqual({ allowed: false, reason: 'paused' });
    const excluded = state({ exclusions: [{ kind: 'host', host: 'school.instructure.com', includeSubdomains: false }] });
    expect(checkCollect(excluded, 'school-metadata', `${school}/api/v1/courses`)).toEqual({ allowed: false, reason: 'user-exclusion' });
    const mail = state({ grants: [{ purpose: 'research-capture', origin: 'https://mail.google.com', version: 1 }] });
    expect(checkCollect(mail, 'research-capture', 'https://mail.google.com/mail/u/0')).toEqual({ allowed: false, reason: 'built-in-exclusion' });
  });
});
