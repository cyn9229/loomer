// Canvas transport: same-origin API reads with the student's own browser session.
// Every request (including each pagination hop) passes the central gate first.
import type { z } from 'zod';
import { checkCollect, type DenyReason, type GateState } from '../../core/gate';

export type CanvasFailureKind = 'auth-expired' | 'denied' | 'not-found' | 'network' | 'unexpected';

export type CanvasFailure = { kind: CanvasFailureKind; status?: number; reason?: DenyReason; detail?: string };

export type CanvasResult<T> = { ok: true; data: T; next: string | null } | { ok: false; failure: CanvasFailure };

export type CanvasContext = { origin: string; gate: GateState; fetch?: typeof fetch };

const JSON_PREFIX = 'while(1);';

/** One gated GET, parsed with `schema`. A login page or 401 is auth-expired, never an empty result. */
export async function canvasGet<S extends z.ZodType>(ctx: CanvasContext, pathOrUrl: string, schema: S): Promise<CanvasResult<z.output<S>>> {
  const decision = checkCollect(ctx.gate, 'school-metadata', new URL(pathOrUrl, ctx.origin));
  if (!decision.allowed) return { ok: false, failure: { kind: 'denied', reason: decision.reason } };

  let res: Response;
  try {
    res = await (ctx.fetch ?? fetch)(decision.url, { credentials: 'include', headers: { Accept: 'application/json' } });
  } catch (error) {
    return { ok: false, failure: { kind: 'network', detail: String(error) } };
  }

  if (res.status === 401) return { ok: false, failure: { kind: 'auth-expired', status: 401 } };
  if (res.status === 404) return { ok: false, failure: { kind: 'not-found', status: 404 } };
  if (!res.ok) return { ok: false, failure: { kind: 'unexpected', status: res.status } };

  const contentType = res.headers.get('content-type') ?? '';
  // A redirect to SSO or the Canvas login page arrives as 200 HTML.
  if (!contentType.includes('json')) return { ok: false, failure: { kind: 'auth-expired', status: res.status, detail: contentType } };

  const raw = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(raw.startsWith(JSON_PREFIX) ? raw.slice(JSON_PREFIX.length) : raw);
  } catch {
    return { ok: false, failure: { kind: 'unexpected', status: res.status, detail: 'invalid JSON' } };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, failure: { kind: 'unexpected', status: res.status, detail: parsed.error.issues[0]?.path.join('.') ?? 'schema' } };
  }
  return { ok: true, data: parsed.data, next: nextLink(res.headers.get('link')) };
}

export type PagedResult<T> = { ok: true; items: T[]; truncated: boolean } | { ok: false; failure: CanvasFailure };

/** Follows Link rel="next" up to maxPages. `truncated` reports that coverage is incomplete. */
export async function canvasGetAll<S extends z.ZodType>(
  ctx: CanvasContext,
  path: string,
  itemSchema: S,
  maxPages = 10,
): Promise<PagedResult<z.output<S>>> {
  const pageSchema = itemSchema.array();
  const items: z.output<S>[] = [];
  let url: string | null = path;
  for (let page = 0; url && page < maxPages; page += 1) {
    const result: CanvasResult<z.output<S>[]> = await canvasGet(ctx, url, pageSchema);
    if (!result.ok) return result;
    items.push(...result.data);
    url = result.next;
  }
  return { ok: true, items, truncated: url !== null };
}

function nextLink(header: string | null): string | null {
  const part = header?.split(',').find((p) => /rel="next"/.test(p));
  return part?.match(/<([^>]+)>/)?.[1] ?? null;
}
