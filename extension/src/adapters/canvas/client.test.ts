import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { GateState } from '../../core/gate';
import { canvasGet, canvasGetAll } from './client';
import { fakeFetch, json } from './testing';

const origin = 'https://school.instructure.com';
const gate: GateState = { paused: false, exclusions: [], grants: [{ purpose: 'school-metadata', origin, version: 1 }] };
const schema = z.object({ id: z.number() });

describe('canvasGet', () => {
  it('strips the while(1) prefix and drops unknown fields', async () => {
    const fetch = fakeFetch(() => json({ id: 7, name: 'Private Name' }, { prefix: true }));
    const r = await canvasGet({ origin, gate, fetch }, '/api/v1/users/self', schema);
    expect(r).toEqual({ ok: true, data: { id: 7 }, next: null });
  });

  it('reports a 401 or a login page as auth-expired, never as empty data', async () => {
    const r401 = await canvasGet({ origin, gate, fetch: fakeFetch(() => json({ errors: [] }, { status: 401 })) }, '/api/v1/users/self', schema);
    expect(r401).toMatchObject({ ok: false, failure: { kind: 'auth-expired' } });
    const login = fakeFetch(() => new Response('<html>Log in</html>', { headers: { 'content-type': 'text/html' } }));
    expect(await canvasGet({ origin, gate, fetch: login }, '/api/v1/users/self', schema)).toMatchObject({ ok: false, failure: { kind: 'auth-expired' } });
  });

  it('does not send a request the gate denies', async () => {
    let called = false;
    const fetch = fakeFetch(() => {
      called = true;
      return json([]);
    });
    const r = await canvasGet({ origin, gate, fetch }, '/api/v1/conversations', schema.array());
    expect(r).toMatchObject({ ok: false, failure: { kind: 'denied', reason: 'route-not-supported' } });
    expect(called).toBe(false);
  });
});

describe('canvasGetAll', () => {
  it('follows next links and reports truncation at the page limit', async () => {
    const fetch = fakeFetch((url) => {
      const page = Number(url.searchParams.get('page') ?? 1);
      return json([{ id: page }], { link: `<${origin}/api/v1/courses?page=${page + 1}>; rel="next"` });
    });
    const r = await canvasGetAll({ origin, gate, fetch }, '/api/v1/courses', schema, 3);
    expect(r).toEqual({ ok: true, items: [{ id: 1 }, { id: 2 }, { id: 3 }], truncated: true });
  });

  it('stops when a next link points to another origin', async () => {
    const fetch = fakeFetch(() => json([{ id: 1 }], { link: '<https://evil.example/api/v1/courses?page=2>; rel="next"' }));
    const r = await canvasGetAll({ origin, gate, fetch }, '/api/v1/courses', schema);
    expect(r).toMatchObject({ ok: false, failure: { kind: 'denied', reason: 'no-grant' } });
  });
});
