// Local-only dev server for the recorded demo. It will hold the OpenRouter key
// (AI broker) and serve the labeled Canvas-shaped replay. It binds to loopback
// only and is never deployed as part of the extension.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { replayRoutes } from './replay/routes.ts';

const port = Number(process.env.PORT ?? 8787);

const demoDocUrl = process.env.DEMO_DOC_URL ?? 'https://docs.google.com/document/d/REPLACE_WITH_DEMO_DOC/edit';

const app = new Hono()
  .get('/health', (c) => c.json({ ok: true }))
  .route('/', replayRoutes(demoDocUrl));

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`loomer server on http://127.0.0.1:${info.port}`);
});
