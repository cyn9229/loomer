# loomer

Chrome extension (Manifest V3, side panel) that helps students see what an assignment needs, pick a next step, and pick up where they left off. Local-first: all student data stays in the browser profile.

## Layout

- `extension/` WXT + React + TypeScript. Entry points: `background.ts` (service worker), `sidepanel/` (main UI), `options/` (onboarding and privacy).
- `server/` Local-only Hono server for the recorded demo: AI broker (holds the OpenRouter key) and the labeled Canvas-shaped replay. Binds to 127.0.0.1.
- `probes/g0/` Throwaway read-only feasibility probe. Delete after validation.

## Run

```bash
npm install
npm run dev            # builds the extension and opens Chrome with it loaded, rebuilds on change
npm run dev:server     # local server on http://127.0.0.1:8787
npm run build          # production build in extension/.output/chrome-mv3
npm run typecheck
npm test
```

To load a build into your own Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/.output/chrome-mv3`.

Copy `server/.env.example` to `server/.env` and add `OPENROUTER_API_KEY`. Never commit `.env`.
