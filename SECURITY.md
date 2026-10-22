# Security and privacy limits

Loomer is a hackathon prototype. This file states what it does to protect student data and, just as plainly, what it does not do. Report problems by opening an issue.

## What stays on the device

- Assignment metadata (including work the student added by hand, which Canvas checks never change), requirement text, analyses, saved research excerpts and screenshots (research screenshots are never sent to AI), files and screenshots attached to chats (the newest 200 MB; older files are removed first, their thumbnails stay), draft snapshots of the linked Doc, help chat and Ask Loomer conversations, hints, the next step the student kept at the end of a session, the plan snapshot, sheet topics and quick-check results (right or wrong per question, never the text), test prep topics, key terms, practice questions and the student's answers, and session history live in the browser profile (IndexedDB and `chrome.storage`).
- There is no Loomer account, no Loomer database, and no sync.
- **Browser profile storage is not encrypted by Loomer.** Anyone who can use the same Chrome profile, or read its files on disk, can read this data. On a shared computer, use Settings > Clear all Loomer data before you leave.

## What leaves the device

Only when the student turns AI help on, and only through the local AI service (`server/`) on the same computer:

| Purpose | What is sent | When |
| --- | --- | --- |
| Requirement analysis | Assignment title, course name, due date, instruction text (including the text of a Google Doc the teacher embedded in the instructions, or instructions the student pasted into work they added by hand), rubric | For open work due within 14 days, unless the assignment's AI policy is blocked or unresolved |
| Review my draft, and Ask Loomer reading the draft | The above plus the student's own text from the linked Doc (instruction lines removed); Ask Loomer gets the draft only when it calls read_my_draft in that assignment's chat | Only when the student asks, and only if the policy allows help |
| Proactive hint | The above plus newly added lines, the session focus, and the last few hints (their text and whether each was handled) | Only after the pause rules allow it, only for writing work, and only if the policy allows help |
| Session focus | Instructions, the requirement list, the student's own text from the linked draft, and last session's focus | Once near the start of a writing session, and again when the student taps "Done for today" on the end card (for the next step), only if the policy allows help |
| Sheet topics | The assignment title and the sheet's text: the teacher's sheet embedded in the instructions, or else the student's linked Doc (which may include their answers) | Embedded sheet: after a Canvas check, under the requirement-analysis rule. Linked Doc: once per sheet during a practice or study session, only if the policy allows help. Never for a quiz |
| Requirement check | Instructions, the requirement list, and the student's own text | Only when the student asks, and only if the policy allows help |
| Ask Loomer | The conversation, and what the read-only tools return: titles, classes, dates, workload, and plan notes for open work; the room and time numbers the student gave (day levels, their own guesses, minutes left in a session, never the reason for a busy day); instructions and rubric of one assignment when its policy allows analysis; saved page titles and links | Only when the student sends a message. For an assignment thread, only if the policy allows help. A blocked assignment's content is never returned to the model, only that AI help is off |
| Ask Loomer attachments | Files the student attaches to a message (images shrunk to 1600 px, PDFs as they are, text from .txt, .md, .docx and similar up to 100,000 characters) and screenshots they take on purpose (Chrome's share picker from the panel, or the right-click "Send screenshot to Ask Loomer", which refuses sign-in pages and blocked sites) | Only with the message they are attached to; later messages carry only their file names. PDFs are read by the model natively, never by a paid OCR step |
| Test prep | A test's title and instruction text (with any study guide Loomer read), its topic names and key terms, photos of notes the student adds (sent once, not kept), and the student's written practice answers for checking | For tests and quizzes due within 14 days, only if the teacher's AI rule allows it and no quiz session is open. Practice questions are new ones; multiple choice, flashcards, and math are checked on this computer |

The local service forwards these to OpenRouter (default model `openai/gpt-6-luna`) with `provider.data_collection: "deny"` and `provider.zdr: true`, which ask OpenRouter to route only to providers that do not collect data and that have zero-data-retention endpoints. OpenRouter states it does not store prompts or responses unless the account opts in to logging. **Loomer cannot verify a provider's actual retention.** Do not read "never leaves your device" into any Loomer copy: with AI on, the excerpts above do leave.

Turning AI off, pausing, blocking a site, or deleting data stops future sending. **None of these can undo processing that already happened at the provider.**

## Boundaries Loomer enforces

- **One gate** (`extension/src/core/gate.ts`) decides every read: supported URL, global pause, built-in exclusions (Gmail, Outlook, Google sign-in, and sign-in, account, inbox, grade, and payment routes for research), student exclusions, a grant for the exact purpose, and an allow-list of Canvas API routes (no inbox, grades, or rosters).
- **Quizzes and tests.** A Canvas quiz, an online-quiz submission, or a test run in an outside tool never gets AI help on its content, hints, or a draft check. While a session on one is open, Ask Loomer pauses everywhere, so it cannot be used during the quiz.
- **AI dispatch check** (`checkAiDispatch`) runs before sending and again before storing a result. An explicit "no AI" rule in the syllabus or assignment blocks all AI for that assignment; a student answer cannot override it. Unreadable instructions prevent clearance.
- **Untrusted text.** Assignment, page, and draft text are passed to the model as data inside delimiters. AI output is schema-validated, every quoted claim must appear in the text that was sent, and model output is rendered as plain text.
- **Stale results are discarded** if the source text, grant, policy, or AI setting changed while a request was in flight.
- **Ask Loomer tools are read-only.** They read the student's local data and never write, submit, or navigate. Tool arguments are schema-checked; display tools return only validated blocks.
- **Plan changes need the student's tap.** The AI can only propose a change (day room, workload, start day, the student's own time guess, session time, hide or done offline). The extension checks it (real ids, real dates, not in the past), previews it with the local planner, and writes nothing until the student taps Apply; apply checks again, and Undo puts back the old values. Due dates and the teacher's AI rule are not editable.
- **AI-made visuals.** SVG is cleaned in the worker (no scripts, event handlers, foreign objects, outside links, CSS imports, or link-rewriting animations) and sanitized again in the panel with DOMPurify. Interactive demos never run in the panel: they run in an extension sandbox page with a unique origin and a CSP of scripts only, with no network, forms, popups, or same-origin access. Verified in Chromium: a hostile demo could not reach extension APIs, cookies, storage, the parent page, or the network.
- **Markdown** from the model renders without raw HTML or images; links open in a new tab.
- **Screenshots** are deliberate (right-click), refused on sign-in pages and excluded hosts, held in memory until the student crops and saves, discarded on Cancel, and never sent to AI.
- **Work nudges** suggest starting, resuming, or switching a session after a stretch of typing in a Doc the student linked, or after the panel stays open on one assignment for 3 minutes. They use only the content-free typing signal and the panel's own state, live in memory, never start or resume anything, never read the Doc, and show only a small toolbar badge when the panel is closed. "Not now" mutes an assignment for 2 hours; a setting turns nudges off.
- **Desktop notifications** are off by default, cover only verified deadline changes and at most one research reminder per session, and never include writing hints.
- **Research capture** needs a separate student action (right-click, shortcut, or Add on a suggestion), refuses pages with a password field, and saves one bounded excerpt. Discovery looks only at the foreground tab's title and address during an active session, matches locally, and keeps no history.
- **Messages** to the service worker are schema-validated and accepted only from Loomer's own pages; the typing signal from the Docs content script carries no content and is trusted only for the linked Doc of the active session.

## Known limits

- **AI policy detection is a set of local rules, not a guarantee.** It can miss unusual teacher wording. When no policy is found, Loomer asks the student once before helping with their draft.
- **The local AI service has no real client authentication.** It also caps AI request bodies at 512 KB. It binds to `127.0.0.1`, accepts only requests with a `chrome-extension://` origin and a custom header (which web pages cannot send without a CORS preflight that is never approved), and can be pinned to one extension id with `LOOMER_EXTENSION_ID`. Another program on the same computer could still call it. It is meant for a single student's computer and a recorded demo, not for hosting.
- **The provider key** lives in `server/.env` on the student's computer and never in the extension bundle.
- **Canvas reads use the student's browser session** through the Canvas REST API. Canvas may record these reads in its access logs. Loomer never writes to Canvas.
- **Embedded teacher sheets.** A Google Doc embedded in Canvas instructions is read with the same plain-text export, only for open work in the connected school account, only after the student granted Docs access, and at most every 6 hours. Its text is treated as instructions, never as the student's work.
- **Google Docs reads use the plain-text export** of the linked Doc with the student's Google session. Google throttles rapid exports; Loomer paces reads (at least 15 s apart, backing off on HTTP 429). Google may record exports.
- **Teacher-text detection in a shared Doc is a heuristic:** lines that match the Canvas instructions are treated as teacher text. Reviews state when only part of a draft was readable.
- **Ask Loomer can be wrong.** The model's explanations, diagrams, and quiz answers can contain mistakes. Prompts and checks keep it from doing assigned work, but they are not a guarantee.
- **Prompt injection.** Teacher text and page content can contain instructions aimed at the model. They are passed as delimited data and the model is told to ignore them; the strongest protections are structural (read-only tools, policy checks before every send, sandboxed widgets), not the prompt.
- **Sensitive-page exclusion is not exhaustive.** Built-in rules and student exclusions reduce risk; they cannot identify every private page.
