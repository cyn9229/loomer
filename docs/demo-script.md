# Loomer demo video: script and shot list

Target length: about 3 minutes, with a 2-minute cut marked below. Neighborhood Hacks allows 2 to 6 minutes.

Labels and waits below come from a full rehearsal walk on Oct 22, 2026 against the current build. AI text (step titles, focus, hints, next steps) changes from run to run; the bold button labels do not.

Truth rules for the video (from the handoff):
- Use the real extension, never the mockup images.
- The Canvas part is the **labeled replay**. Say so once on screen. The live Canvas proof is a separate short clip.
- Show real waits. When you trim a wait, put a caption with the real duration ("35 seconds later, trimmed").
- If the AI gives a different answer than this script expects, keep the real answer. Do not re-record until it says what you want.
- Never show classmates' names, grades, messages, real coursework, or your school session.

---

## Before you record

### One-time setup (about 15 minutes)

1. **Use a separate Chrome profile** for the demo. No bookmarks, no other extensions, no personal tabs, and not the profile you use for school. Sign in to your **personal** Google account only (the one that owns the demo Doc).
2. **Make the demo Doc** in that account and paste the text in [Demo Doc text](#demo-doc-text) below. Paste the instruction lines as plain paragraphs, not a bulleted list, so Loomer can tell teacher text from student text. Loomer shows the link as "Heat island essay draft" (the name in the instructions) whatever the Doc's own title is; naming the Doc the same keeps the video consistent.
3. **Set `server/.env`:** `OPENROUTER_API_KEY`, and `DEMO_DOC_URL` set to that Doc's link. Set it before your first `npm run demo:reset`: changing it later changes the essay's instructions, and Loomer drops the student's pick when the instructions change.
4. **Build and load:** `npm run build`, then in the demo profile load `extension/.output/chrome-mv3` unpacked (Developer mode, Load unpacked; press Cmd+Shift+G in the picker to reach the hidden `.output` folder). Pin loomer.
5. **Expect Chrome's permission prompts in every take.** **Clear all Loomer data** also gives back every site permission Loomer was granted, so Chrome asks again for Google Docs (shot 5) and for each research site you save from (shot 6). Click **Allow**. Keep them on camera: they show that Loomer cannot read a site until you say yes.
6. **Turn off macOS notifications** (Focus mode) and close other apps that might pop up.
7. **Window layout:** Chrome at about 1440 × 900, side panel open on the right. Zoom the Doc to 110% so text is readable in the video.

### Reset before every take (about 2 minutes)

1. `npm run dev:server` (leave it running), then `npm run demo:reset`.
2. loomer options → **Clear all Loomer data** → confirm.
3. Options → connect `http://127.0.0.1:8787` → Allow.
4. Options → turn on **Read assignment requirements with AI** → Allow. Turn on **Suggest pages to add during a session** → Allow. Keep **Show a hint when I pause** on.
5. In the Doc, delete the sentence you typed during the last take. The draft must end with "Both sources talk about heat in cities."
6. Open tabs in this order: the Doc, `https://www.epa.gov/heatislands/what-are-heat-islands`, `https://news.wisc.edu/study-suggests-trees-are-crucial-to-the-future-of-our-cities/`, and `https://mail.google.com` (for shot 11; it can be the sign-in page).
7. Wait about 10 seconds after connecting so the first Canvas check and requirement analysis finish, then reload the panel.

**Never restart the server or run `demo:reset` in the middle of a take.** Both move the replay's due dates, which drops your pick of the essay: after End, Home would lead with the Photosynthesis response instead of your kept step.

Rehearse the full run **twice from a reset** before the real take.

---

## Shot list

Times are targets. **[2-min cut]** marks shots to drop for a 2-minute version.

| # | Time | On screen | Voiceover |
|---|------|-----------|-----------|
| 1 | 0:00-0:10 | Home in the side panel: the **Replay data** label, **Your plan** with its assignment titles. | "Assignment titles don't tell you how much work something is. The big essay gets pushed until you're tired, and every break means rebuilding where you were." |
| 2 | 0:10-0:25 | Options page: **Canvas · 127.0.0.1:8787** with **Replay data**, and **Read assignment requirements with AI** set to **On**. | "Loomer is a Chrome extension. It reads the assignments my school already posts. For this demo it reads a labeled replay of a Canvas course, through the same code that reads real Canvas. Everything is stored on this computer." |
| 3 | 0:25-0:42 | Home: the next step for the Photosynthesis response (an AI-written title, e.g. "List autumn leaf color factors"), **Due tomorrow.**, **Start working**, and **Not today · Set a time**. Below, **Your plan** with **Start today · 2** and **Start by Wed**. | "Before it recommends anything, Loomer reads the requirements. Then it plans when to start each one, not just when it's due. The short Biology response comes first: it's due tomorrow, so it starts today." |
| 4 | 0:42-1:00 | Tap "Urban heat islands: comparative essay" in Your plan. Show **In plain words**, the date tiles (**Today** Start by, **Mon** Draft due, **Tue** Due 7:59 PM), and **What it asks for**. | "The essay looks far away, but its draft is due Monday for peer review, so Loomer counts back from that and says start today. In plain words tells me what it's really asking, and this is the list of what it asks for." |
| 5 | 1:00-1:20 | Press **Start working**. Under "Which Doc is your draft?", press **Use this** on "Heat island essay draft". Chrome asks to let Loomer read Google Docs: **Allow**. **Wait until the line under the title shows "Writing · 176 words"**, then answer "Does your teacher allow AI help on this one?" with **Yes, it's allowed**. **Your focus** appears. | "I'll choose the essay anyway, because I have time now. My choice wins. Loomer opens the Doc the assignment links to, and only that Doc. It asks whether AI help is allowed, then reads my draft and picks one thing to focus on." |
| 6 | 1:20-1:45 | Go to the EPA tab ("What Are Heat Islands?"). Right-click → **Add page to Loomer**; the toolbar shows ✓. Switch to the UW–Madison News tab and wait. Caption "30 seconds later, trimmed". The panel shows **Save this page as a source?** with "Study suggests trees are crucial to the future of our cities" → **Save**. Chrome asks to let Loomer read news.wisc.edu: **Allow**. The line under the title shows **2 sources**. | "These are the real articles I'm using. Research pages are saved with one action. If I stay on a related tab, Loomer quietly offers to save it. It only looked at the tab's title, never the page, and Chrome still asks me before it reads a new site." |
| 7 | 1:45-2:05 | In the session's **Ask for a hint** box: "Just write my thesis for me." Show the redirect. Then **Home** → **Ask Loomer anything** (the **General** chat): "Explain the urban heat island effect simply, with a diagram." The diagram appears (about 8 s). Then "Quiz me on that" and answer one question. **[2-min cut: keep the refusal and the diagram]** | "If I ask it to do the work, it won't. It helps me build my own argument instead. When I don't understand something, I can ask. It explains with a picture, and checks my understanding." |
| 8 | 2:05-2:30 | Back in the session (Home → **Keep going**). In the Doc, type the sentence from [Typed during the demo](#typed-during-the-demo) as a new paragraph. Stop typing. Caption "35 seconds later, trimmed". The **Hint** card appears. Press **Show the line** to show the quoted line from the draft, then **Hide**. | "When I pause after writing a new paragraph, Loomer may offer one quiet hint about my draft. Most of the time it stays silent. It never interrupts while I'm typing." |
| 9 | 2:30-2:45 | Tap **Checklist** in the line under the title, then **Check my draft** (about 5 s). **What it asks for** shows "3 open" with done rows checked. Tap an open row such as "Comparison of evidence" to show its quote from the draft. | "When I want to know where I stand, Loomer checks my draft against each requirement and quotes the line it means." |
| 10 | 2:45-3:00 | Press **End**. The card recaps the session ("You added 26 words and saved 2 sources in …"). Press **Done for today**. Wait for **Next time** to fill in (about 4 s), then **Save and close**. Home now leads with that step and **Keep going**. | "When I stop, Loomer recaps what I did and picks where to start next time. When I come back, that step is the first thing I see, one tap away." |
| 11 | 3:00-3:12 | Tap "Personal narrative" in Your plan: **No AI on this one** and the quoted rule "Do not use AI tools such as ChatGPT for any part of this assignment." Then the Gmail tab: right-click → **Add page to Loomer**; the badge shows "!". **[2-min cut: keep only the narrative]** | "If a teacher says no AI, Loomer turns its AI off for that assignment and shows the rule. And some pages, like email, Loomer never reads." |
| 12 | 3:12-3:20 | Options: **Pause Loomer**, then the README support matrix or the line "Also tested read-only on a real Canvas account." End on the loomer logo and "Less managing. More learning." | "Pause or clear everything any time. Less managing. More learning." |

### What not to claim

- Loomer does not track which parts of the essay are done. Say it checks the draft against each requirement when asked (shot 9), not that it "knows what's done".
- The resumed session does not say what happened last time. Say "the step I kept is the first thing I see", not "it remembers everything I did".
- If the hint is not about the sentence you just typed, do not narrate it as a reaction to that sentence.

### Separate clip: live Canvas proof (about 20 seconds, optional)

Record in your normal profile **only after hiding personal data**:
- Connect your real Canvas, open the panel, and **crop or blur every assignment and course title**. Show only "Last check", the course count, and the assignment count.
- Caption: "Read-only test on a real student Canvas account. Titles hidden."
- Do not show grades, the Canvas inbox, classmates, or your school's address bar.

---

## Demo Doc text

Paste this into the Doc. The first block repeats the assignment instructions (teacher text); the rest is the student's partial draft. The draft summarizes both sources but never compares them, which is the gap a hint or the draft check can point to.

The two sources are real published pages, and every number in the draft was checked against them:
- US Environmental Protection Agency, "What Are Heat Islands?", https://www.epa.gov/heatislands/what-are-heat-islands (last updated August 18, 2026).
- Adam Hinterthuer, "Study suggests trees are crucial to the future of our cities," UW–Madison News, March 25, 2019, https://news.wisc.edu/study-suggests-trees-are-crucial-to-the-future-of-our-cities/ (reporting Ziter et al., PNAS, 2019).

Loomer suggests the UW–Madison page only when the draft is linked: its headline matches through words the draft repeats ("trees", "cities"), not through the assignment title. Link the draft in shot 5 before the research shot.

```
Write a 900 to 1200 word essay comparing how two sources explain urban heat islands and the role of tree cover.
Summarize the main claim of each source.
Compare the evidence each source uses. Explain where they agree and where they differ.
Develop your own argument about what a city should prioritize.
Cite both sources in MLA format.

Cities Need Shade

Cities are getting hotter, and some neighborhoods feel it more than others. This essay looks at two sources about urban heat.

The first source, "What Are Heat Islands?" from the US Environmental Protection Agency, explains that buildings and roads absorb the sun's heat and release it more than natural landscapes like forests do. It says that in the United States, cities are about 1 to 7 degrees Fahrenheit warmer than outlying areas during the day and about 2 to 5 degrees warmer at night. It also says trees and other plants help cool the air by giving shade.

The second source, "Study suggests trees are crucial to the future of our cities" from UW–Madison News, describes a researcher who biked around Madison, Wisconsin, with a small weather station. The study found that tree canopy cover has to be above 40 percent to get the most cooling, and that the right amount of tree cover can lower summer daytime temperatures by as much as 10 degrees Fahrenheit.

Both sources talk about heat in cities.
```

### Typed during the demo

Type this as a new paragraph at the end of the draft in shot 8 (26 words):

```
I think trees are the best answer because they make the biggest difference, and the city should plant them on every street as soon as possible.
```

The sentence makes a claim without using either source's numbers, and it ignores the UW–Madison article's warning to think about how many trees to plant and where. A finished paragraph of 25 or more words lets Loomer consider a hint after a 30-second pause instead of the 90-second setting; in the rehearsal it appeared 35 seconds after typing. A hint is still not guaranteed. If none appears after about two minutes, go straight to shot 9.

---

## If something goes wrong during a take

| Problem | What to do |
|---|---|
| **Your focus** says to summarize the sources, or ignores the draft | You answered the AI question before the Doc finished linking. Loomer picks the focus once per session, so reset and redo the take, waiting for "176 words" before **Yes, it's allowed**. |
| **Use this** stays on "Linking…" | Chrome is showing its Google Docs permission prompt. Click **Allow**. It comes back after every **Clear all Loomer data**. |
| **Save** stays on "Saving…" | Chrome is asking to let Loomer read that site. Click **Allow**. |
| No suggestion on the UW–Madison tab | The draft is not linked yet, so its headline matches nothing. Link the draft first (shot 5). |
| The panel says the AI service is off | Start `npm run dev:server` (with `server/.env`) and reopen the panel. |
| Ask Loomer answers without a diagram or quiz | Models vary. Ask once more ("show it as a diagram"). Keep the real answer if it is useful; do not fake one. |
| Home still shows Loomer reading assignments | Wait. With AI on it should finish within about 20 seconds. If not, check the `npm run dev:server` terminal for errors. |
| AI answers take long or fail | Check the server log. Errors name the cause (timeout, provider error). Re-record that shot. |
| No research suggestion | Research suggestions must be on, a session must be active, and the tab must be in front for 30 seconds. Saved pages are never suggested again; use the other source. |
| No proactive hint | Make sure you typed after starting the session, as a new paragraph, and then stopped. Use **Check my draft** (shot 9) as the fallback. |
| **Save and close** is greyed out on the end card | Loomer is still picking where to start next time. Wait for the **Next time** text, or press **Write my own**. |
| After End, Home leads with the Photosynthesis response | The server restarted or `demo:reset` ran during the take, which drops your pick. Reset and redo the take. |
| Wrong next action at the start | That is the honest result for the current data. Narrate what it shows. Run `npm run demo:reset` before the next take so the dates match this script. |
