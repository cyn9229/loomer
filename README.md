# loomer

**Know what you're getting into, and pick up where you left off.**

Loomer is a Chrome extension (Manifest V3, side panel) for students who use Canvas and Google Docs. It collects assignments in the background, reads their requirements before suggesting anything, plans when to start each one, recommends one concrete next step with the evidence behind it, explains concepts (with diagrams, charts, small interactive demos, and quick checks) without doing the work, offers a quiet hint after you pause writing, and helps you resume where you left off. It is local-first and open source (MIT).

Hackathon prototype for Neighborhood Hacks 2026. Read [SECURITY.md](SECURITY.md) for exactly what leaves the device and the known limits.

## What it does

| Step | What happens |
| --- | --- |
| Discover | Approve your school's Canvas address once. Loomer reads your planner and course assignment lists every 15 minutes while Chrome is open, including unopened assignments. |
| Understand | Reads instructions, rubrics, quiz descriptions, discussion prompts, and syllabi. Finds due dates written in instructions. Checks each assignment's AI policy locally before any AI is used. |
| Prioritize | A plan by start date: each item gets "start today / tomorrow / by Wed" from its next checkpoint (or due date) minus a lead time for its requirement-based workload. Checkpoints such as "draft due for peer review" come from the instructions. Every rank has a plain reason; a busy-days note flags when two heavier items need a start close together; the top stays steady unless the evidence changes, and one line says what moved. A short daily brief on the first open. No top pick until requirements are checked. |
| Understand, simply | "Plain words" rewrites the instructions in two or three simple sentences. Requirements show Observed / Needs review / Unknown against your draft when you ask Loomer to check. |
| Work | Start a session, link your Google Doc, save research pages with a right-click (or Alt+Shift+L), or capture a screenshot with preview and crop. Ask for a hint or a review. Help never writes your work. |
| Ask Loomer | Chat anywhere, about a concept or one assignment. Replies stream in with Markdown and math. Loomer can look at your assignments (read-only), draw a diagram or chart, build a small interactive demo, or give a quick multiple-choice check on a concept. |
| Proactively guide | After you pause writing (default 90 s) and have written something new, Loomer may show one quiet hint that quotes your draft. Usually it shows nothing. Opt-in research suggestions notice a related tab and offer "Add this page." |
| Resume | When you come back, Home shows what you did last time and one tap to continue. |

## Quick start

Requirements: Node 22.18+, Chrome 120+, an OpenRouter API key (only for AI features).

```bash
npm install
cp server/.env.example server/.env   # then add OPENROUTER_API_KEY (and optionally DEMO_DOC_URL)
npm run dev:server                   # local AI service and Canvas replay on http://127.0.0.1:8787
npm run build                        # extension in extension/.output/chrome-mv3
```

Load it: `chrome://extensions` → Developer mode → Load unpacked → `extension/.output/chrome-mv3` (it is a hidden folder; press Cmd+Shift+. in the file picker). Pin loomer, open its options, connect Canvas, and turn on AI help if you want it. Optional switches, all off by default: research suggestions, desktop notifications (deadline changes only).

## Repeatable demo (labeled replay)

Students cannot create Canvas assignments, and Canvas Free-for-Teacher was discontinued in 2026, so the demo uses a **labeled local replay**: a small server that answers the same Canvas API routes with fixed demonstration assignments. It runs through the real Canvas adapter; every item is marked "Replay". Live Canvas behavior is proven separately (see the support matrix).

1. `npm run dev:server`, then `npm run demo:reset` to re-anchor the replay's dates to now.
2. In loomer's options: Clear all Loomer data (for a clean start), then connect `http://127.0.0.1:8787` and turn on AI help.
3. Home checks requirements, then recommends a next step. "Urban heat islands: comparative essay" links your demo Doc if `DEMO_DOC_URL` is set.
4. Start the essay session and link the Doc. Write; the activity list records factual edits.
5. Open the demo sources `http://localhost:8787/sources/heat-islands` and `/sources/tree-cover` (labeled demonstration material). Right-click → Add page to Loomer, or turn on Research suggestions and wait 30 s for "Add this page".
6. Ask a question (hint first), request a review, then stop typing for 90 s to allow a proactive hint.
7. Ask Loomer: "What should I work on this week?", "Explain the urban heat island effect with a diagram", "Quiz me on that".
8. End the session; Home shows the resume briefing.
9. "Personal narrative" contains a no-AI rule: AI help is blocked with the quoted rule, while organizing still works.
10. Gmail and sign-in pages are never captured, even with a right-click.

Rehearse it automatically: `npm run e2e:replay` (first time: `npx playwright install chromium`). It resets the replay, builds the extension, runs the flow in Chromium, and writes screenshots and a pass/fail report to `e2e-out/`. It passed 17 of 17 checks twice in a row from a reset. AI steps use `server/.env` and cost a few cents.

## Support matrix

Evidence classes: **unit** = focused automated tests (`npm test`, 96 tests); **replay** = the built extension driven in Chromium against the local replay (`npm run e2e:replay`); **live** = a real signed-in account, read-only.

| Capability | Evidence | Notes |
| --- | --- | --- |
| Canvas collection from the background worker, panel closed | live | school.instructure.com student account: `users/self`, courses, planner, unopened assignment detail, course assignment lists, syllabus; logged-out returns 401 JSON. A full Loomer run collected 53 assignments in 10 courses and read their requirements. |
| Canvas quiz and discussion prompts, linked Canvas files and teacher Docs | unit, replay | Implemented; not yet seen in live data. Files are linked, not downloaded. |
| Expired Canvas session | unit | Reported as auth-expired; known data kept. |
| Google Docs reading (owned Doc) | live | Plain-text export from the worker. Edits detected 1-3 s after typing at 5 s polling; Google returned 429 after ~10 rapid reads, so reads are paced (15 s minimum, backoff). |
| Typing signal in Docs | unit | Content script registered after Docs access. Not yet confirmed live; a 60 s fallback read keeps hints working without it. |
| Right-click capture without broad permissions | live | Context-menu click grants access to that tab once. |
| AI requirement analysis, help, review | live | Via OpenRouter `gpt-6-luna` at low reasoning effort: requirement analysis 3.5-4.3 s. |
| Proactive hints | unit | Rules, grounding, dismissal, withdrawal, and stale-result handling tested; live timing depends on the typing signal. |
| AI policy detection | unit | Bans, permissions, mixed rules, quotations, ambiguous mentions, unreadable sources. |
| Research discovery | unit, replay | Suggestion after the dwell and one-shot capture verified in Chromium; Chrome's permission prompts not yet tested in a real profile. |
| Pause, exclusions, delete, clear all | unit, replay | |
| Planner (start-by, checkpoints, reasons, busy days, calm re-ranking, daily brief) | unit, replay | Live check on the 53-item account pending. |
| Plain words, requirement check (Observed / Needs review / Unknown) | unit | Statements must quote the draft or become Unknown. |
| Ask Loomer chat with tools, visuals, quizzes | unit, replay | Live through the broker: planning answer from list_work, an SVG diagram, a 3-question quiz, and an instant refusal on the no-AI assignment. |
| Interactive widget sandbox | replay | A hostile widget ran its script but could not reach extension APIs, cookies, storage, the parent page, or the network. |
| Desktop notifications (deadline changes), screenshot capture | unit | Chrome prompts and the OS notification not yet tested in a real profile. |
| AI service status | replay | Health check of the local service, shown before asking. |
| Google Classroom | not supported | Feasibility probe in `probes/classroom/`; no account with assignments to prove it. |
| Cross-device sync | not supported | Local-only by choice for the MVP. |

`probes/g0/` and `probes/classroom/` hold the read-only probes used for live validation. They are never shipped.

## Architecture

```
extension/
  entrypoints/background.ts       service worker: scheduling, messages, session loop, capture, discovery
  entrypoints/docs-activity.content.ts  typing signal (registered at runtime, no content)
  entrypoints/sidepanel, options  React UI
  src/core/        gate (single privacy authority), Dexie store, settings, messages, URL rules
  src/adapters/    canvas (gated API client, collector), docs (paced export reader)
  src/analysis/    deadlines, AI policy rules, requirement analysis, recommendation rules
  src/session/     sessions, help and review, proactive hints, resume packets
  entrypoints/widget.sandbox/     sandboxed page for AI-made interactive demos (no extension APIs, no network)
  src/analysis/plan.ts           the planner: checkpoints, start-by buckets, reasons, busy days, daily brief
  src/chat/        Ask Loomer engine (streaming, tool loop), read-only tools, SVG cleaning, widget frame helper
  src/capture/, src/discovery/, src/privacy/, src/notify/
  src/model/       typed contracts the UI renders (HomeModel, SessionModel, AssignmentDetailModel, ChatModel)
server/            local Hono service: AI broker and streaming chat (OpenRouter), the labeled Canvas replay, demo sources
shared/            AI and chat contracts used by both sides
scripts/           e2e-replay.mjs rehearsal
```

Data flow: approved source → gate → local extraction → local policy check → normalized evidence in IndexedDB → AI check → minimal request through the local broker → validated, quote-grounded result → local store → side panel.

## Development

```bash
npm run typecheck
npm test
npm run dev        # WXT dev mode with reload
npm run e2e:replay # full rehearsal in Chromium against the replay
```

Rules worth knowing before changing things:
- Every network read goes through `checkCollect` in `src/core/gate.ts`; every AI call goes through `checkAiDispatch`.
- Model output is untrusted: Markdown renders without raw HTML or images, SVG is cleaned in the worker and again in the panel, and interactive HTML runs only in the sandboxed widget page.
- Inside a Dexie live query, read only Dexie. A non-Dexie await stops change tracking and the panel lags; read settings with `useStorageItem`.
- The service worker can stop at any time: keep state in storage, schedule with alarms.

## License

[MIT](LICENSE)
