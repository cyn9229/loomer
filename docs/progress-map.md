# Progress map (design, not built)

Status: planned for the Congressional App Challenge build, Oct 24 to 26, 2026. Nothing here is implemented yet.

## Problem

Students with executive-function challenges rarely fail because they don't know what's due. They fail at starting, and at starting again. Coming back to a big assignment costs effort: where was I, what did I already do, what's next. Many students (the author included) skip rereading and just keep going from where they stopped. That gets them moving, but they lose the shape of the piece: they drift from the prompt, repeat themselves, or find a missing part the night before.

Loomer today records activity (edits, words added, sources saved) and makes judgments inside one session (hints, the session focus, the requirements check). The activity carries over to the next session. The judgments mostly don't. The next session knows the student worked, not what they got done.

## Goal

When the student comes back, Loomer gives the fuller picture in about ten seconds, without asking them to reread:

> Your essay so far: the intro is done and reason 1 has evidence. Reason 2 is started but has no evidence yet, and the counterargument is missing. You stopped in reason 2.

Hard rule: **no upkeep.** The map updates itself from Canvas and the linked Doc. The student's only input is optional taps. Any feature that needs the student to maintain it fails this rule.

## Parts and rules

The requirements list today mixes two different things. The map separates them.

- **Parts** are the pieces of the work, in order: intro, reason 1 with evidence, reason 2 with evidence, counterargument, conclusion. Progress lives here.
- **Rules** are constraints on the whole: MLA format, 1,000 words, three sources. They become a short checklist for the end, not progress.

The requirements analysis already reads the instructions and rubric with quotes. It gains a `parts` list (text, an exact quote from the instructions, order) and tags each existing requirement as a part or a rule.

## Status per part

Each part has one status and an optional short note:

| Status | Meaning |
|---|---|
| Not started | Nothing in the draft matches this part. |
| Started | Some text matches, but it isn't a full piece yet. |
| Drafted | A full piece exists. |

The note says what's missing in plain words ("no evidence yet"). Every status that isn't "Not started" points to a quote from the draft, so the student can see why. This is status, not quality: Loomer says what exists, never how good it is.

**Where you stopped** is computed, not guessed. The resume packet already stores a hash per paragraph. At session end, the paragraphs whose hashes changed are the ones the student worked on, and the part whose quote sits in the last of them is where they stopped.

## When it updates

- **Session end:** one check of the draft against the parts. This reuses the requirements-check broker task with a parts-aware prompt.
- **Home open:** only when the draft changed since the last check (the doc hash differs) and no check ran in the last few hours.
- **Never continuously.** A full check sends the whole draft to the model, so it runs at most once per session.

## Where the student sees it

1. **Home's Continue line.** A new insight kind, `progress`, ranked after `change` and before `hidden-deadline`: "Your second reason in this essay still needs evidence, so that's a good place to continue."
2. **Session start.** The picture card above the session focus, with each part's status in one short row.
3. **Session end.** One line about what changed: "The counterargument went from missing to drafted."
4. **Assignment detail.** The parts with statuses, then the rules checklist.

## Correcting it

Each part row has "Not right". Tapping it lets the student set the status themselves. Their status stands until the text of that part changes. The AI never overrides a student's correction on unchanged text.

## What the AI may and may not do

- May: say whether a part exists in the draft, quote it, name what's missing.
- May not: grade, score, judge quality, suggest a thesis, or write any part.
- Every claim needs a quote that appears in the text sent (the existing grounding rule).

## Privacy

Loomer already keeps the latest draft snapshot of the linked Doc in the browser profile, plus hint and check quotes. The map adds statuses and short quotes per part, also local only. The first time a session ends with a map, Loomer asks once: "Loomer can remember where you left off, so it keeps a few short lines from your draft on this computer. Keep this on?" The same switch lives in settings. With it off, the map keeps statuses but no quotes, and Delete and Clear all remove it like everything else. SECURITY.md gets a row for the session-end check.

## Small things put off too long

A different failure from big work, so a different fix. How long an item has sat on the list (Canvas first-seen date) decides **when** Loomer raises it: on Home, at the end of a session on bigger work, or in the existing nudge. The sentence never states that number, because it reads as blame. It gives the deadline and one first step: "This vocabulary check is due tomorrow, and you can start by opening the word list, so it's a good one to clear before your essay."

## Limits

- Docs are read as plain text: no cursor, revision history, or comments, and no link that jumps to a spot. "Where to continue" is a quoted passage, not a jump.
- Vague instructions give a thin map. Rubrics help.
- Writing only. Practice and study work already have topic standings from quick checks, which play the same role.
- Paper work is invisible to Loomer.

## First cut (Oct 24 to 26)

In: parts from the analysis, the session-end check, statuses with quotes, where you stopped, the Home Continue line, the session-start picture, "Not right", the quote setting.

Later: the session-end change line, the rules checklist on detail, the small-things trigger.

## Demo beat

Day 1: a session on the real Frankenstein essay ends, and the map shows what changed. Day 2: Home says "Continue: your second reason needs evidence". One tap opens the Doc with the focus ready. Every claim on screen shows its quote.

## Open questions

- Should the map ask the AI for parts when the instructions name none ("write an essay about Frankenstein")? A generic essay shape could fill in, clearly labeled as Loomer's guess, not the teacher's.
- Is three statuses enough, or does "Drafted" need a "has evidence" step for argument essays?
