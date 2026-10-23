# Loomer | Neighborhood Hacks 2026 Demo Script

Matched to `Loomer Demo Prelim.mp4` (4:11, screen only, no audio). "Video m:ss" is the position in that file. Each demo section's narration is sized to fit its clip at about 150 words per minute.

### Intro | The problem and introduction
**On screen:** Founder webcam, then footage of Canvas assignments, an unfinished Google Doc, and Loomer opening. (Not in the screen recording.)

Think about everything that goes into completing a homework assignment. You have to keep track of what's due, figure out what to prioritize, get yourself to start, and stay focused long enough to make progress. And if you get interrupted, you have to remember what you were doing when you come back.

These are all skills associated with executive functioning, and for students with ADHD, they can be especially difficult.

As a high school student, I've experienced some of these problems myself, and I've seen the same things happen to my classmates. Sometimes it's procrastinating because getting started feels overwhelming. Other times, it's getting distracted halfway through or coming back to an assignment and having to figure out where you left off.

We already use tools like Canvas, calendars, and AI chatbots for school. But they're often disconnected from the actual work we're doing, and students still have to manage much of that process themselves.

That's why I built Loomer.

Loomer is a Chrome extension designed to support students with executive-function challenges by understanding their assignments, helping them work through those assignments, and making it easier to pick up where they left off.

### Video 0:00–0:49 | Understanding and prioritizing assignments
**On screen:** Home with **Replay data**, leading with "Identify chlorophyll's role in leaves" (0:00) → Your plan → **Later**: Personal narrative with **No AI on this one** (0:13) → **Past due** (0:16) → **Week**: Tue "Submit a full draft for peer review", Wed essay due (0:19) → Urban heat islands essay: **In plain words**, **Tomorrow** / **Tue** / **Wed** tiles, **What it asks for** (0:26).

Here's Loomer running with a labeled replay of a Canvas course. It also supports read-only access to real Canvas accounts.

On Home, Loomer picks one next step: my short Biology response, due Saturday.

Below that is my plan. Loomer recommends when to start each assignment, not just when it's due. This personal narrative is marked No AI on this one, because the teacher doesn't allow AI tools.

This comparative essay isn't due until Wednesday. But the instructions say a full draft is due Tuesday for peer review, so Loomer recommends starting tomorrow.

It also explains the instructions in plain language and keeps the requirements visible, so I don't have to keep rereading the assignment.

### Video 0:49–1:08 | Starting a work session
**On screen:** **Start working** → **Which Doc is your draft?** → **Use this** on "Heat island essay draft" → **Yes, it's allowed** (0:49) → Demo Doc with **Your focus**: "Compare how each source uses evidence" (0:58).

Let's say I work on the essay anyway. I start a session and pick the Google Doc I'm writing in, which Loomer found in the instructions. It asks if AI help is allowed, then reads my draft and suggests one thing to focus on.

### Video 1:08–1:46 | Research and saving sources
**On screen:** EPA "What Are Heat Islands?" → right-click → loomer → **Add page to Loomer** (1:08) → **Sources 1** with "Not in your draft yet" (1:20) → UW–Madison News article (1:26) → **Save this page as a source?** → **Save** → **Sources 2** (1:34).

As I'm researching, I can save relevant sources directly from the browser.

The Sources tab shows what I've saved and whether I've used it in my draft yet.

Loomer can also notice when I stay on a related research page and offer to save it. To make that suggestion, it only uses the page's title and address. Saving it is still my choice.

### Video 1:46–2:05 | Asking Loomer for help
**On screen:** **Ask for a hint**: "I'm struggling to compare these sources. What should I focus on?" → answer (1:46) → "Just write my thesis for me." → "I can't write the thesis for you…" with a sentence frame (1:55).

I can also ask for help any time. When I'm stuck comparing sources, Loomer uses the assignment and my draft to suggest what to focus on. If I ask it to write my thesis, it won't. It gives me a sentence frame, so I build my own argument.

### Video 2:05–2:52 | Learning with the general assistant
**On screen:** Home → **Ask Loomer anything** → **General** (2:05) → "Explain the urban heat effect simply, using a diagram." → "How cities stay warmer" diagram (2:11) → "Quiz me on this" → three questions, wrong picks with explanations → "0 of 3 right" (2:28).

There's also a general learning assistant. I can ask about a concept, my week, or how to study for a test. Here, I'm asking it to explain urban heat islands with a diagram. It labels the diagram as AI-made, so I know to check it against my sources.

Then I ask it to quiz me. When I pick a wrong answer, it explains why. And it's only practice, so my teacher never sees it.

### Video 2:52–3:30 | Writing and hints
**On screen:** Home → **Keep going** → Doc: type "I think trees are the best answer because they make the biggest difference, and the city should plant them as soon as possible." (2:52) → **Hint**: "What does each source's evidence show, and how do their methods differ?" → **Show the line**: "Both sources talk about heat in cities." (3:12).

Back in my draft, I add my argument.

While I'm working, Loomer can occasionally offer a hint about my draft. This one asks what each source's evidence shows and how their methods differ. Show the line points to the exact sentence it's about.

It isn't constantly interrupting me or trying to write the essay itself. The idea is to make useful guidance available while I'm working, especially when I might be stuck.

### Video 3:30–3:52 | Checking actual progress
**On screen:** Essay page → **Check my draft** (3:30) → **4 open**, "Accurate summary of both sources" checked with a quote (3:37) → "Comparison of evidence" opened: what's missing and the quoted line (3:43).

Long assignments have a lot of requirements to keep track of. So I ask Loomer to check my draft against the teacher's instructions. One requirement is done, with a quote from my draft as evidence. Four still need work, and for each one, it explains what's missing.

### Video 3:52–4:11 | Ending and resuming work
**On screen:** **End** → recap → **Done for today** (3:55) → **Next time**: "Compare how each source supports its claim" → **Save and close** (4:04) → Home leads with that step and **Keep going** (4:07).

When I'm done for today, Loomer recaps the session and suggests a concrete next step, which I can edit before saving. When I come back, that step is the first thing I see, with Keep going right there. That continuity matters most when restarting work is the hard part.

### Privacy and academic integrity
**On screen:** Not in the screen recording. Record a short clip of **Privacy & controls** (site exclusions, **Pause Loomer**, **Clear all**), or run this over the architecture graphic.

Because Loomer works with student assignments and writing, privacy and academic integrity have been central design considerations.

Students control which sites and documents Loomer can access, and they can pause it, exclude sites, or clear their locally stored data. Some sensitive sites, including email services, are excluded by default.

AI features are optional and disabled by default. When enabled, relevant assignment information and draft text may be sent to an external AI provider to generate guidance. Loomer requests zero data retention from that provider.

And as we saw with the personal narrative, if a teacher explicitly prohibits AI assistance on an assignment, Loomer turns off its assignment-specific AI features.

### Technical implementation and closing
**On screen:** Simple architecture graphic → extension and working product → founder webcam full-screen.

I built Loomer as a Chrome extension in TypeScript and React.

The hardest challenge was balancing two things. Loomer is more useful when it can see more, but students should stay in control of what it reads. And it can help a lot, but it shouldn't do the learning for them. So Loomer only reads what students approve, and it guides with hints and questions instead of finished answers.

Next, I want to test Loomer with students who have executive-function challenges, and learn whether it actually helps them start sooner and get back to interrupted work.

With Loomer, I want students to spend less time managing schoolwork, and more time on the work that matters.

Thanks for watching.

---

## Fit

Neighborhood Hacks allows 2 to 6 minutes. Estimates at 150 words per minute:

| Part | Length |
|---|---|
| Intro (narration) | about 1:17 |
| Screen recording | 4:11 (its narration takes about 3:25) |
| Privacy (narration) | about 0:44 |
| Closing (narration) | about 0:45 |
| **Total** | **about 6:57** |

The intro, privacy, and closing together need to come down to about 1:49 for the whole video to fit in 6:00.
