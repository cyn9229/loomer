# Loomer demo video: script and shot list

Target length: about 3 minutes, with a 2-minute cut marked below. Check the official Neighborhood Hacks video limit before recording and trim to fit.

**Before recording:** the side panel is being rebuilt to your round-17 picks. Check every bold button and label below against the built panel and fix this script where wording changed. `npm run e2e:replay` screenshots each step for comparison.

Truth rules for the video (from the handoff):
- Use the real extension, never the mockup images.
- The Canvas part is the **labeled replay**. Say so once on screen. The live Canvas proof is a separate short clip.
- Show real waits. When you trim a wait, put a caption with the real duration ("90 seconds later, trimmed").
- If the AI gives a different answer than this script expects, keep the real answer. Do not re-record until it says what you want.
- Never show classmates' names, grades, messages, real coursework, or your school session.

---

## Before you record

### One-time setup (about 15 minutes)

1. **Make a separate Chrome profile** named "Loomer demo". No bookmarks, no other extensions, no personal tabs. Sign in to your **personal** Google account only (the one that owns the demo Doc).
2. **Make the demo Doc** in that account, named "Heat island essay draft". Paste the text in [Demo Doc text](#demo-doc-text) below. Paste the instruction lines as plain paragraphs, not a bulleted list, so Loomer can tell teacher text from student text.
3. **Set `server/.env`:** `OPENROUTER_API_KEY`, and `DEMO_DOC_URL` set to that Doc's link.
4. **Build and load:** `npm run build`, then in the demo profile load `extension/.output/chrome-mv3` unpacked. Pin loomer.
5. **Turn off macOS notifications** (Focus mode) and close other apps that might pop up.
6. **Window layout:** Chrome at about 1440 × 900, side panel open on the right. Zoom the page to 110% so text is readable in the video.

### Reset before every take (about 2 minutes)

1. `npm run dev:server` (leave it running), then `npm run demo:reset`.
2. loomer options → **Clear all Loomer data** → confirm.
3. Options → connect `http://127.0.0.1:8787` → Allow.
4. Options → turn on **AI help** → Allow. Turn on **Research suggestions** → Allow. Keep Proactive hints at 90 seconds.
5. In the Doc, undo any text you added during the last take (or restore it from [Demo Doc text](#demo-doc-text)).
6. Open tabs in this order: the Doc, `http://localhost:8787/sources/heat-islands`, `http://localhost:8787/sources/tree-cover`, and `https://mail.google.com` (for shot 10; it can be the sign-in page).
7. Wait about 10 seconds after connecting so the first Canvas check and requirement analysis finish, then reload the panel. Do one practice pass of shots 2 to 3 without recording if the analysis is still running.

Rehearse the full run **twice from a reset** before the real take.

---

## Shot list

Times are targets. **[2-min cut]** marks shots to drop for a 2-minute version.

| # | Time | On screen | Voiceover |
|---|------|-----------|-----------|
| 1 | 0:00-0:12 | A Canvas-style assignment list (the replay's Home in the side panel, or a slide with assignment titles only). | "Assignment titles don't tell you how much work something is. The big essay gets pushed until you're tired, and every break means rebuilding where you were." |
| 2 | 0:12-0:28 | Options page: Canvas connected to the **Replay** source, AI help on. Point at the "Replay" label. | "Loomer is a Chrome extension. It reads the assignments my school already posts. For this demo it reads a labeled replay of a Canvas course, through the same code that reads real Canvas. Everything is stored on this computer." |
| 3 | 0:28-0:50 | Side panel Home, planned by start date. If you catch it, the "Reading requirements N of M" progress. Then the next step appears with its start-by ("Start today") and the week below, each item with "Start by … · due …" and its workload. | "Before it recommends anything, Loomer reads the requirements. Then it plans when to start each one, not just when it's due. The short Biology response comes first: it's due tomorrow, so it starts today." |
| 4 | 0:50-1:05 | Open **Why this?** on the next step, then open the essay: show its reason line ("The next step for this essay, draft for peer review, is due …, so start by …"), the checkpoint quoted from the instructions, and **Plain words**. | "Every reason points to a source. The essay looks far away, but its draft is due earlier for peer review, so Loomer counts back from that. Plain words tells me what it's really asking." |
| 5 | 1:05-1:20 | In Other work, press **Start** on "Urban heat islands: comparative essay". Show the session view, then link the Doc from the instructions (one click). The Doc comes to the front. | "I'll choose the essay anyway, because I have time now. My choice wins. Loomer opens the Doc the assignment links to, and only that Doc." |
| 6 | 1:20-1:45 | Go to the heat-islands tab. Right-click → **Add page to Loomer**; the toolbar shows ✓. Switch to the tree-cover tab and wait. Caption "30 seconds later, trimmed". The panel shows "Researching for this assignment? Add this page." → **Add**. | "Research pages are saved with one action. If I stay on a related tab, Loomer quietly offers to add it. It only looked at the tab's title, never the page, until I said yes." |
| 7 | 1:45-2:10 | The bottom **Ask** bar (general thread): "Explain the urban heat island effect simply, with a diagram." The reply streams in with a diagram. Then "Quiz me on that" and answer one question. Then in the essay thread, "Just write my thesis for me." Show the redirect. **[2-min cut: keep the diagram and the refusal]** | "When I don't understand something, I can ask. It explains with a picture, and checks my understanding. But if I ask it to do the work, it won't. It teaches instead." |
| 8 | 2:05-2:30 | In the Doc, type the sentence from [Typed during the demo](#typed-during-the-demo). Stop typing. Caption "90 seconds later, trimmed". The quiet hint card appears, quoting a line from the draft. Press **Hide**. | "When I pause after writing something new, Loomer may offer one quiet hint about what I actually wrote. Most of the time it stays silent. It never interrupts while I'm typing." |
| 9 | 2:30-2:45 | Press **End session**. Home shows **Welcome back** with facts (edits, saved sources) and **Continue**. | "When I come back, Loomer shows what I did last time and gets me back to the right place in one tap." |
| 10 | 2:45-2:58 | Click "Personal narrative": the AI-off notice quotes "Do not use AI tools such as ChatGPT for any part of this assignment." Then the Gmail tab: right-click → Add page to Loomer; the badge shows "!". **[2-min cut: keep only the narrative]** | "If a teacher says no AI, Loomer turns its AI off for that assignment and shows the rule. And some pages, like email, Loomer never reads." |
| 11 | 2:58-3:05 | Options: **Pause Loomer**, then the README support matrix or the line "Also tested read-only on a real Canvas account." End on the loomer logo and "Less managing. More learning." | "Pause or clear everything any time. Less managing. More learning." |

### Separate clip: live Canvas proof (about 20 seconds, optional)

Record in your normal profile **only after hiding personal data**:
- Connect your real Canvas, open the panel, and **crop or blur every assignment and course title**. Show only "Last check", the course count, and the assignment count.
- Caption: "Read-only test on a real student Canvas account. Titles hidden."
- Do not show grades, the Canvas inbox, classmates, or your school's address bar.

---

## Demo Doc text

Paste this into the Doc. The first block repeats the assignment instructions (teacher text); the rest is the student's partial draft. The draft summarizes both sources but never compares them, which is the gap a hint or review can point to.

```
Write a 900 to 1200 word essay comparing how two sources explain urban heat islands and the role of tree cover.
Summarize the main claim of each source.
Compare the evidence each source uses. Explain where they agree and where they differ.
Develop your own argument about what a city should prioritize.
Cite both sources in MLA format.

Cities Need Shade

Cities are getting hotter, and some neighborhoods feel it more than others. This essay looks at two sources about urban heat.

The first source, "Heat Islands and Urban Temperatures," explains that cities are warmer than nearby rural areas because roads and roofs absorb sunlight during the day and release heat at night. In its example city, downtown nights were about 5 degrees Fahrenheit warmer than the countryside. The brief lists reflective roofs, green space, and street trees as responses.

The second source, "Street Trees and Neighborhood Cooling," measured afternoon street temperatures on different blocks. Blocks with more than 40 percent tree canopy were about 4 degrees cooler than blocks with less than 10 percent canopy. The study also says new trees take years to grow.

Both sources talk about heat in cities.
```

### Typed during the demo

Type this at the end of the draft in shot 8 (about 30 words, enough new writing to allow a hint):

```
I think trees are the best answer because they make the biggest difference, and the city should plant them on every street as soon as possible.
```

This sentence makes a claim without connecting it to the numbers in either source, so a useful hint is likely. A hint is still not guaranteed. If none appears after about two minutes, press **Review my draft** instead and narrate: "I can also ask for a review any time."

---

## If something goes wrong during a take

| Problem | What to do |
|---|---|
| The panel says the AI service is off | Start `npm run dev:server` (with `server/.env`) and reopen the panel. |
| Ask Loomer answers without a diagram or quiz | Models vary. Ask once more ("show it as a diagram"). Keep the real answer if it is useful; do not fake one. |
| Home still says "Checking" | Wait. With AI on it should finish within about 20 seconds. If not, check the `npm run dev:server` terminal for errors. |
| AI answers take long or fail | Check the server log. Errors now name the cause (timeout, provider error). Re-record that shot. |
| No research suggestion | Research suggestions must be on, a session must be active, and the tab must be in front for 30 seconds. Saved pages are never suggested again; use the other demo source. |
| No proactive hint | Make sure you typed after starting the session and then stopped for a full 90 seconds. Use Review my draft as the fallback (see above). |
| Wrong next action | That is the honest result for the current data. Narrate what it shows. Run `npm run demo:reset` before the next take so the dates match this script. |
