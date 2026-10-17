# Security and privacy limits

Loomer is a hackathon prototype. This file states what it does to protect student data and, just as plainly, what it does not do. Report problems by opening an issue.

## What stays on the device

- Assignment metadata, requirement text, analyses, saved research excerpts, draft snapshots of the linked Doc, chat, hints, and session history live in the browser profile (IndexedDB and `chrome.storage`).
- There is no Loomer account, no Loomer database, and no sync.
- **Browser profile storage is not encrypted by Loomer.** Anyone who can use the same Chrome profile, or read its files on disk, can read this data. On a shared computer, use Settings > Clear all Loomer data before you leave.

## What leaves the device

Only when the student turns AI help on, and only through the local AI service (`server/`) on the same computer:

| Purpose | What is sent | When |
| --- | --- | --- |
| Requirement analysis | Assignment title, course name, due date, instruction text, rubric | For open work due within 14 days, unless the assignment's AI policy is blocked or unresolved |
| Help and review | The above plus the student's own text from the linked Doc (instruction lines removed) and recent chat | Only when the student asks, and only if the policy allows help |
| Proactive hint | The above plus newly added lines | Only after the pause rules allow it, and only if the policy allows help |

The local service forwards these to OpenRouter (default model `openai/gpt-6-luna`) with `provider.data_collection: "deny"` and `provider.zdr: true`, which ask OpenRouter to route only to providers that do not collect data and that have zero-data-retention endpoints. OpenRouter states it does not store prompts or responses unless the account opts in to logging. **Loomer cannot verify a provider's actual retention.** Do not read "never leaves your device" into any Loomer copy: with AI on, the excerpts above do leave.

Turning AI off, pausing, blocking a site, or deleting data stops future sending. **None of these can undo processing that already happened at the provider.**

## Boundaries Loomer enforces

- **One gate** (`extension/src/core/gate.ts`) decides every read: supported URL, global pause, built-in exclusions (Gmail, Outlook, Google sign-in, and sign-in, account, inbox, grade, and payment routes for research), student exclusions, a grant for the exact purpose, and an allow-list of Canvas API routes (no inbox, grades, or rosters).
- **AI dispatch check** (`checkAiDispatch`) runs before sending and again before storing a result. An explicit "no AI" rule in the syllabus or assignment blocks all AI for that assignment; a student answer cannot override it. Unreadable instructions prevent clearance.
- **Untrusted text.** Assignment, page, and draft text are passed to the model as data inside delimiters. AI output is schema-validated, every quoted claim must appear in the text that was sent, and model output is rendered as plain text.
- **Stale results are discarded** if the source text, grant, policy, or AI setting changed while a request was in flight.
- **Research capture** needs a separate student action (right-click, shortcut, or Add on a suggestion), refuses pages with a password field, and saves one bounded excerpt. Discovery looks only at the foreground tab's title and address during an active session, matches locally, and keeps no history.
- **Messages** to the service worker are schema-validated and accepted only from Loomer's own pages; the typing signal from the Docs content script carries no content and is trusted only for the linked Doc of the active session.

## Known limits

- **AI policy detection is a set of local rules, not a guarantee.** It can miss unusual teacher wording. When no policy is found, Loomer asks the student once before helping with their draft.
- **The local AI service has no real client authentication.** It binds to `127.0.0.1`, accepts only requests with a `chrome-extension://` origin and a custom header (which web pages cannot send without a CORS preflight that is never approved), and can be pinned to one extension id with `LOOMER_EXTENSION_ID`. Another program on the same computer could still call it. It is meant for a single student's computer and a recorded demo, not for hosting.
- **The provider key** lives in `server/.env` on the student's computer and never in the extension bundle.
- **Canvas reads use the student's browser session** through the Canvas REST API. Canvas may record these reads in its access logs. Loomer never writes to Canvas.
- **Google Docs reads use the plain-text export** of the linked Doc with the student's Google session. Google throttles rapid exports; Loomer paces reads (at least 15 s apart, backing off on HTTP 429). Google may record exports.
- **Teacher-text detection in a shared Doc is a heuristic:** lines that match the Canvas instructions are treated as teacher text. Reviews state when only part of a draft was readable.
- **Sensitive-page exclusion is not exhaustive.** Built-in rules and student exclusions reduce risk; they cannot identify every private page.
