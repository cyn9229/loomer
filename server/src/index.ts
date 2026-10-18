// Local-only dev server for the recorded demo. It holds the OpenRouter key
// (AI broker) and serve the labeled Canvas-shaped replay. It binds to loopback
// only and is never deployed as part of the extension.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { z } from 'zod';
import { brokerRoutes, type ReasoningEffort } from './broker.ts';
import { chatRoutes } from './chat.ts';
import { replayRoutes } from './replay/routes.ts';
import { sourceRoutes } from './replay/sources.ts';

const port = Number(process.env.PORT ?? 8787);

const demoDocUrl = process.env.DEMO_DOC_URL ?? 'https://docs.google.com/document/d/REPLACE_WITH_DEMO_DOC/edit';

const aiEnv = {
  apiKey: process.env.OPENROUTER_API_KEY || undefined,
  model: process.env.OPENROUTER_MODEL || 'openai/gpt-6-luna',
  effort: z.enum(['none', 'low', 'medium', 'high']).catch('low').parse(process.env.OPENROUTER_REASONING_EFFORT) satisfies ReasoningEffort,
  extensionId: process.env.LOOMER_EXTENSION_ID || undefined,
};

const app = new Hono()
  .get('/health', (c) => c.json({ ok: true }))
  .route('/', replayRoutes(demoDocUrl))
  .route('/', sourceRoutes)
  .route('/', brokerRoutes(aiEnv))
  .route('/', chatRoutes(aiEnv));

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`loomer server on http://127.0.0.1:${info.port}`);
});
