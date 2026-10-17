# Loomer Classroom probe

Throwaway, read-only feasibility probe. It answers one question before anyone builds a Classroom adapter: can a Manifest V3 service worker read a student's Google Classroom work using only the student's signed-in browser session, with no OAuth app for a school admin to block?

It sends GET requests only. It never turns in, comments, edits, or opens anything in a tab. The copied report contains status codes, counts, lengths, timings, booleans, and marker names. It never contains titles, names, emails, instruction text, or IDs (IDs in paths show as `:id`). The local checks and the local preview stay in the panel and are dropped from the copied report.

Google may log these page loads the same way it logs the student loading the pages. Classroom does not show teachers a "viewed" state for assignments, but treat that as unverified.

## Run (student, about 5 minutes)

1. Sign in to your school Google account in Chrome. Open [classroom.google.com](https://classroom.google.com) once to confirm you see your classes. If several Google accounts are signed in, note the number after `/u/` in the address bar while you are on your school account (for example `/u/1/`).
2. `chrome://extensions` → turn on Developer mode → Load unpacked → pick this `probes/classroom` folder. Chrome grants the host access listed in `manifest.json` at install.
3. Pin "Loomer Classroom probe" and click its icon. The side panel opens.
4. Setup:
   - Account index: the `/u/N/` number from step 1. Leave empty for 0.
   - Class URL (optional): copy the address of any page of one class.
   - Assignment URL (optional, best signal for question 3): in Classroom's To-do list, right-click an assignment you have **not** opened, choose Copy link address, paste it here. Do not click it.
5. Local checks (optional, strongly recommended): type the exact title of one assignment from your To-do list, and a short phrase from its instructions (you can ask a classmate or use one you already opened). These never leave the panel and are never saved. The report only says whether each was found, and where.
6. Optional: tick "Show local preview" to see the strings the probe extracted, so you can judge accuracy by eye. The preview is never copied.
7. Click Run Classroom probe. It makes about 15 requests with a short pause between each and takes 5 to 20 seconds.
8. Click Copy report JSON and paste it back. Then remove the extension.

## What each step tests

| Row | Question | Request |
| --- | --- | --- |
| `q1.api.courses`, `q1.api.courseWork` | 1. Does the Classroom REST API accept cookies alone? | `GET classroom.googleapis.com/v1/courses` and `/courses/{id}/courseWork` with `credentials: 'include'`. Reports status, `error.status`, `details[].reason`, and the `WWW-Authenticate` scheme. Expected: 401 `UNAUTHENTICATED`, because every Classroom API method needs an OAuth scope. |
| `q2.home`, `q2.todo.assigned`, `q2.todo.missing`, `q2.calendar.week`, `q2.classwork` | 2. Is assignment overview data in the HTML the server sends, without the student opening each assignment? | `GET` the class list, To-do (Assigned, Missing), this week's calendar, and one class's Classwork page. Counts assignment links (`/c/:id/a/:id`), class links, dates near now (epoch seconds/nanos pairs and epoch milliseconds within -30..+90 days), `[y,m,d]` triples, "Due" words, `AF_initDataCallback` data blocks, human-looking embedded strings, and visible text length. `knownTitle` says whether your typed title is in the visible HTML, the embedded data, or the raw HTML. |
| `q3.detail` | 3. Does an unopened assignment's detail page contain instructions and attachments? | `GET /u/N/c/:id/a/:id/details` (pasted URL, else the first assignment found in step 2). Reports the longest embedded string length, strings over 80 chars, attachment links by kind (doc, sheet, slides, form, driveFile, youtube, otherExternal), and `knownPhrase`. |
| `q4.loggedOut.home`, `q4.loggedOut.detail` | 4. What does "session expired" look like? | Same pages with `credentials: 'omit'`. `landing` is `signIn`, `marketing`, `classroomOther`, or a `fetchError`. |
| `q5.accounts.path`, `q5.accounts.authuserParam` | 5. With several Google accounts, does `/u/N/` or `?authuser=N` pick the right one? | `GET /u/0/h` to `/u/4/h` until one redirects away, then `/h?authuser=N` for each valid N. Each page's account is reduced to a label (A, B, ...) and a kind (`workspace` or `consumer`). `matchesPath` says whether both forms reach the same account. |
| `summary` | | The booleans above in one row. |

## Reading the result

**Feasible** (build a cookie-session adapter):
- `q2.todo.assigned` is PASS: assignment links and dates near now are present, and `knownTitle.inRawHtml` is true.
- `q3.detail` is PASS with `knownPhrase.inRawHtml` true, or `longestHumanStringChars` near the real instruction length.
- `q4` lands on `signIn` (a clean expiry signal).
- If the student has several accounts, `q5` shows distinct labels per `/u/N/` and `authuserParam` matches.

**Fragile** (possible, but expect breakage; build only if Classroom is worth the upkeep):
- The title and phrase are found only in `inEmbeddedData`, not `inVisibleText`. The adapter would parse positional `AF_initDataCallback` arrays, which Google changes without notice.
- Dates appear only as unlabeled epoch numbers, so matching a date to its assignment needs array-position guesses.
- Overview works but `q3.detail` is INFO (instructions missing), so requirements would need the student to open each assignment.
- `q5` shows `/u/N/` works but indexes shift when accounts sign in or out.

**Infeasible** (by this route):
- Every `q2` and `q3` row has `landing` other than `classroomApp` while the student is signed in, or a `fetchError`.
- Pages load but `assignmentRefs` is 0, `humanStrings` is near 0, and `knownTitle.inRawHtml` is false everywhere. Classroom then loads its data after page load with `batchexecute` POST calls, which this probe does not try (GET only).
- `q1` returning 200 would be a surprise and would change the plan toward the REST API.

## Notes and limits

- Host permissions are broad (`*.google.com`) so redirects to `accounts.google.com` and marketing pages can be followed and recorded instead of failing as CORS errors. A real adapter would narrow this.
- Chrome sends `SameSite=Lax` cookies on extension-initiated requests only when the extension has host permission for the target. This probe verifies that in practice; the Chromium SameSite FAQ is the only written source found.
- URL patterns (`/a/not-turned-in/all`, `/w/:id/t/all`, `/calendar/this-week/course/all`) come from the current Classroom web app and are not documented. The pasted URLs exist as a fallback when discovery fails.
- Account identity uses the `oPEP7c` email field when present, then the most common email on the page, then the `S06Grb` account ID. `identitySource` says which one matched.
- Follow-ups this probe does not answer: whether a read-only `batchexecute` POST returns the data, whether `?authuser=<email>` is a stable selector, and whether Classroom's Google Calendar entries are a simpler due-date source.

Kept as validation evidence, like `probes/g0`. It is not product code and is never shipped.
