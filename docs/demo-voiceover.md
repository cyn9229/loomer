# Loomer | Neighborhood Hacks 2026 Demo Script

Matched to `Loomer Demo Prelim.mp4` (4:11, screen only, no audio). "Video m:ss" is the position in that file. Each demo section follows what happens on screen, in order, and fits its clip at about 190 words per minute.

### Intro | The problem and introduction
**On screen:** Founder webcam, then footage of Canvas assignments, an unfinished Google Doc, and Loomer opening. (Not in the screen recording.)

Getting homework done isn't just about actually doing the work. You have to figure out what's due, decide where to start, and somehow pick up where you left off when you get distracted or take a break.

For students with ADHD, these things can be especially difficult. They're called executive-function skills, and they're something I've struggled with myself, along with a lot of my classmates.

The problem is that traditional study apps and even AI study tools mostly give you information or help you make a plan. But when it's time to actually sit down and do the work, you're still on your own.

That's why I built Loomer, a Chrome extension that helps students figure out what they need to do, guides them while they're working, and makes it easier to pick up right where they left off.

### Video 0:00–0:26 | Home and the plan
**On screen:** Home: next step with Start working, Not today, Set a time (0:00). Scroll the plan: photosynthesis, heat islands essay, Later with No AI, Past due (0:13). Week view (0:19).

Here's Loomer in the side panel, using a labeled replay of a Canvas course. At the top is my next step. I can start working, skip it for today, or set a time.

Below that is the rest of my plan: my photosynthesis response, the heat islands essay, what's coming later, and what's past due. This personal narrative is marked No AI, because the teacher doesn't allow it. And the week view shows everything at once.

### Video 0:26–0:49 | Reading the essay
**On screen:** Open the heat islands essay (0:26). What it asks for, then expand a requirement. Date tiles: start tomorrow, draft due Tue, essay due Wed.

Next, I open the urban heat islands essay. Loomer lists what the teacher is asking for, and I can expand each requirement to see what it means.

It also caught a checkpoint in the instructions. The essay is due Wednesday, but the draft is due Tuesday, so Loomer says to start tomorrow.

### Video 0:49–1:08 | Starting a session
**On screen:** Start working (0:49). Link the Doc. Yes, AI is allowed. Focus appears: compare how each source uses evidence (0:58).

When I click Start working, I link my Google Doc and confirm that my teacher allows AI help. Then Loomer reads my draft and picks one thing to focus on: compare how each source uses evidence.

### Video 1:08–1:46 | Research and saving sources
**On screen:** EPA article: right-click, Add page to Loomer (1:08). Sources tab shows it (1:20). UW–Madison article (1:26). Loomer offers to save it. Save (1:34).

Now I start researching. On this article, I right-click and add the page to Loomer, and it shows up under my sources. Loomer even tracks whether I've used it in my draft yet.

Then I open a second article. Because it's related to what I'm working on, Loomer offers to save it as a source on its own. To make that suggestion, it only looks at the page's title and address.

### Video 1:46–2:05 | Asking for help
**On screen:** Ask for a hint: struggling to compare these sources (1:46). Ask it to write my thesis. Refusal with a sentence frame (1:55).

If I'm stuck, I can ask for a hint. I'll say I'm struggling to compare these sources, and Loomer tells me what to focus on.

But if I ask it to just write my thesis, it refuses and gives me a sentence frame, so I still write my own argument.

### Video 2:05–2:52 | General chat
**On screen:** General chat (2:05). Ask for a diagram. Diagram appears (2:11). Quiz me. Wrong answers, each explained (2:28).

There's also a general chat for anything school related. I'll ask it to explain the urban heat effect simply, using a diagram, and Loomer draws a visual of how cities stay warmer. It labels the diagram as AI-made, so I know to check it against my sources.

Then I ask it to quiz me. I'm getting these wrong on purpose for the demo, but each time, Loomer explains the right answer. And the quiz is just practice, so my teacher never sees it.

### Video 2:52–3:30 | Writing and a hint
**On screen:** Back to the session, Keep going. Type the new sentence in the Doc (2:52). Hint card. Show the line (3:12).

Now I go back to my essay session and keep writing in my Google Doc. I add: I think trees are the best answer because they make the biggest difference, and the city should plant them as soon as possible.

Loomer also has a hint for me: what does each source's evidence show, and how do their methods differ? Show the line points to the exact sentence in my draft that it's about.

### Video 3:30–3:52 | Checking my draft
**On screen:** Essay checklist: Check my draft (3:30). 1 done with evidence, 4 open (3:37). Open one to see why (3:43).

Then I go to the checklist and ask Loomer to check my draft against the teacher's requirements. One requirement is done, and Loomer shows the evidence from my draft. The other four still need work, and it tells me why.

### Video 3:52–4:11 | Ending the session
**On screen:** End, then Done for today (3:55). Next step appears. Save and close (4:04). Home shows the step (4:07).

When I'm finished, I end the session and pick Done for today. Loomer suggests a next step based on my draft and the requirements, and I can edit it before I save and close. Next time I open Loomer, that step is the first thing I see.

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

Neighborhood Hacks allows 2 to 6 minutes. Estimates at 190 words per minute (the measured reading pace):

| Part | Length |
|---|---|
| Intro (narration) | about 0:44 |
| Screen recording | 4:11 (its narration takes about 2:47) |
| Privacy (narration) | about 0:34 |
| Closing (narration) | about 0:37 |
| **Total** | **about 6:06** |

The intro, privacy, and closing together need to come down to about 1:49 for the whole video to fit in 6:00.
