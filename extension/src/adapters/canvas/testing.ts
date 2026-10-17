// Test helper: a fake fetch that answers Canvas paths from a route table.
type Route = (url: URL) => Response | undefined;

export const json = (body: unknown, init: ResponseInit & { link?: string; prefix?: boolean } = {}) =>
  new Response(`${init.prefix ? 'while(1);' : ''}${JSON.stringify(body)}`, {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.link ? { link: init.link } : {}) },
  });

export function fakeFetch(route: Route): typeof fetch {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return route(url) ?? new Response('not found', { status: 404 });
  };
}
