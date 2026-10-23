// The demo video's timeline, in seconds of the final video unless a name says
// "src" (seconds of the screen recording) or "take" (seconds of a camera take).
//
// The demo is an edit of the screen recording: kept stretches, loading waits
// played faster, and a few freeze frames where a callout needs time. Each
// narration sentence is placed by the screen moment it describes (`at(src)`),
// so voice and screen stay together however the edit changes. The audio is
// built from this same file (scripts/audio.ts).

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type Range = readonly [start: number, end: number];
export type Box = readonly [x0: number, y0: number, x1: number, y1: number];

// ---- Intro ----

export const INTRO_TAKE = {
  file: 'media/01-the-problem-and-introduction-take5.mp4',
  in: 0.75,
  out: 40.3,
  text: "Getting homework done isn't just about actually doing the work. You have to figure out what's due, decide where to start, and somehow pick up where you left off when you get distracted or take a break. For students with ADHD, these things can be especially difficult. They're called executive-function skills, and they're something I've struggled with a lot myself, along with a lot of my classmates. The problem is that traditional study apps and AI study tools mostly just give you information or help you make a plan. But when it's time to actually sit down and do the work, you're still on your own. That's why I built Loomer, a Chrome extension that helps students figure out what they need to do, guides them while they're working, and makes it easier to pick up right where they left off.",
};
export const DEMO_START = INTRO_TAKE.out - INTRO_TAKE.in;

// ---- Screen recording edit ----

export const SCREEN = 'media/screen.mp4';

/** A stretch of the recording played at `speed`, or one frame held for `dur` seconds. */
export type Segment = { src: Range; speed?: number } | { hold: number; dur: number; id: string };

const EDIT: readonly Segment[] = [
  // Home and the plan
  { src: [0, 2.9] },
  { hold: 2.9, dur: 1.6, id: 'replay' },
  { src: [2.9, 16.6] },
  { hold: 16.6, dur: 4.6, id: 'noai' },
  { src: [16.6, 19.6], speed: 3 },
  { src: [19.6, 23.4] },
  { hold: 23.4, dur: 1.0, id: 'week' },
  // Reading the essay, starting a session
  { src: [25.7, 44.0] },
  { src: [48.5, 55.2], speed: 1.7 },
  { src: [55.2, 61.2] },
  // Research and saving sources
  { src: [66.5, 69.4] },
  { src: [69.4, 71.3], speed: 2 },
  { src: [71.3, 74.4] },
  { src: [74.4, 80.2], speed: 3 },
  { src: [80.2, 88.5] },
  { src: [88.5, 90.5], speed: 3 },
  { src: [90.5, 100.6] },
  // Asking for help
  { src: [104.8, 110.0] },
  { src: [110.0, 112.8], speed: 1.5 },
  { src: [112.8, 113.2] },
  { src: [113.2, 115.0], speed: 1.5 },
  { src: [115.0, 118.2] },
  { src: [118.2, 121.7], speed: 3 },
  { src: [121.7, 124.4] },
  { hold: 124.4, dur: 1.4, id: 'refusal' },
  // General chat
  { src: [124.4, 125.0] },
  { src: [130.4, 136.1] },
  { src: [136.1, 140.7], speed: 1.6 },
  { src: [140.7, 145.0] },
  { src: [147.7, 150.0] },
  { src: [150.0, 154.8], speed: 4 },
  { src: [154.8, 155.6] },
  { src: [160.4, 169.7] },
  { hold: 169.7, dur: 4.5, id: 'quiz' },
  // Writing and a hint
  { src: [169.7, 171.0], speed: 2 },
  { src: [171.0, 174.8] },
  { src: [174.8, 178.0], speed: 3 },
  { src: [178.0, 179.0] },
  { src: [179.0, 190.2], speed: 1.5 },
  { src: [190.2, 202.0] },
  // Checking the draft
  { src: [206.0, 212.4] },
  { src: [212.4, 218.1], speed: 4 },
  { src: [218.1, 227.6] },
  // Ending the session
  { src: [235.2, 239.6] },
  { src: [239.6, 244.4], speed: 1.6 },
  { src: [244.4, 250.8] },
  { hold: 250.8, dur: 3.0, id: 'end' },
];

/** The edit placed on the final timeline. */
export type Placed = { t0: number; t1: number; seg: Segment };
export const SCREEN_EDIT: readonly Placed[] = (() => {
  let t = DEMO_START;
  return EDIT.map((seg) => {
    const d = 'hold' in seg ? seg.dur : (seg.src[1] - seg.src[0]) / (seg.speed ?? 1);
    const placed = { t0: t, t1: t + d, seg };
    t += d;
    return placed;
  });
})();

export const DEMO_END = SCREEN_EDIT[SCREEN_EDIT.length - 1].t1;

/** Final time of a moment in the screen recording (its first appearance in the edit). */
export function at(src: number, offset = 0): number {
  for (const { t0, seg } of SCREEN_EDIT) {
    if ('src' in seg && src >= seg.src[0] && src < seg.src[1]) return t0 + (src - seg.src[0]) / (seg.speed ?? 1) + offset;
  }
  throw new Error(`src ${src} is not in the edit`);
}

const held = (id: string) => {
  const p = SCREEN_EDIT.find((s) => 'hold' in s.seg && s.seg.id === id);
  if (!p) throw new Error(`no hold ${id}`);
  return p;
};
/** Final start and end of a freeze frame. */
export const holdStart = (id: string, offset = 0) => held(id).t0 + offset;
export const holdEnd = (id: string, offset = 0) => held(id).t1 + offset;

// ---- Demo narration ----

/**
 * A piece of a narration take: take seconds [in, out) play from final time
 * `at`. Cuts sit in breaths (checked against the take's loudness), and `text`
 * is exactly what is said, for the captions.
 */
export type VoicePiece = { file: string; in: number; out: number; at: number; text: string };
const T02 = 'media/02-home-and-the-plan-take1.mp4';
const T03 = 'media/03-reading-the-essay-take1.mp4';
const T04 = 'media/04-starting-a-session-take1.mp4';
const T05 = 'media/05-research-and-saving-sources-take1.mp4';
const T06 = 'media/06-asking-for-help-take1.mp4';
const T07 = 'media/07-general-chat-take2.mp4';
const T08 = 'media/08-writing-and-a-hint-take1.mp4';
const T09 = 'media/09-checking-my-draft-take1.mp4';
const T10 = 'media/10-ending-the-session-take1.mp4';

export const VOICE: readonly VoicePiece[] = [
  { file: T02, in: 0.55, out: 2.3, at: at(0.3), text: "Here's Loomer in the side panel." },
  { file: T02, in: 2.3, out: 16.95, at: holdEnd('replay', -0.24), text: "At the top, it shows me my next step. I can either start working, skip it for today, or set a time. Below that is the rest of my plan. I have a photosynthesis response, a heat islands essay, and I can see what's coming later and what's past due." },
  { file: T02, in: 16.95, out: 20.48, at: holdStart('noai', 0.95), text: "The personal narrative is marked No AI because the teacher doesn't allow it." },
  { file: T02, in: 20.48, out: 23.0, at: at(19.4), text: 'And this week view shows everything at once.' },
  { file: T03, in: 0.4, out: 17.2, at: at(26.2), text: 'Next, I can open this urban heat islands essay, and Loomer will list what the teacher is asking for, and I can expand each requirement to see what it means. It also caught a checkpoint in the instructions. The essay is due Wednesday, but the draft is due Tuesday, so Loomer says to start tomorrow.' },
  { file: T04, in: 0.6, out: 5.6, at: at(43.05), text: 'When I click Start working, I can link my Google Doc and confirm that my teacher allows AI help.' },
  { file: T04, in: 5.6, out: 11.2, at: at(55.45), text: 'Then, Loomer will read my draft and pick one thing to focus on, compare how each source uses evidence.' },
  { file: T05, in: 0.3, out: 2.95, at: at(66.6), text: 'Loomer continues to help me as I start researching.' },
  { file: T05, in: 2.95, out: 7.39, at: at(73.4, -2.65), text: 'For example, on this article, I can right-click and add the page to Loomer,' },
  { file: T05, in: 7.39, out: 10.4, at: at(80.4, -0.9), text: 'and it shows up under my sources, as you can see here.' },
  { file: T05, in: 10.57, out: 14.1, at: at(82.6), text: "Loomer even tracks whether I've used it in my draft yet." },
  { file: T05, in: 14.1, out: 15.81, at: at(86.13), text: 'I can open a second article.' },
  { file: T05, in: 15.81, out: 25.5, at: at(94.6, -4.3), text: "Because it's related to what I'm working on, Loomer proactively offers to save it as a source on its own. To make that suggestion, it only looks at the page's title and address." },
  { file: T06, in: 0.47, out: 7.85, at: at(105.0), text: "If I'm stuck, I can ask for a hint. I'll say I'm struggling to compare these sources and Loomer tells me what to focus on." },
  { file: T06, in: 7.85, out: 14.4, at: at(115.1), text: 'But if I just ask it to write my thesis, it refuses and gives me a sentence frame, so I still write my own argument.' },
  { file: T07, in: 0.58, out: 3.45, at: at(130.5), text: "There's also a general chat for anything school-related." },
  { file: T07, in: 3.45, out: 10.85, at: at(133.4), text: 'I can ask it to explain the urban heat effect simply using a diagram, and Loomer draws a visual of how cities stay warmer.' },
  { file: T07, in: 11.05, out: 13.95, at: at(148.0), text: 'I can also ask it to quiz me.' },
  { file: T07, in: 13.95, out: 18.74, at: at(160.6, -0.15), text: "I'm getting these wrong on purpose for the demo, but each time, Loomer explains the right answer." },
  { file: T07, in: 18.74, out: 26.05, at: at(166.45), text: 'And the quiz is just practice. So the teacher never sees it, and you can get some good reps in before your exams or practice tests.' },
  { file: T08, in: 0.4, out: 3.95, at: at(170.2), text: 'Going back to my essay session, I can keep writing in my Google Doc.' },
  { file: T08, in: 3.95, out: 23.4, at: at(178.0, -0.2), text: "For example, I can add here, I think trees are the best answer because they make the biggest difference and the city should plant them as soon as possible. So, Loomer has now prepared a hint for me. So, what does each source's evidence show? And how do their methods differ? And I can click Show the line to show the exact sentence in my draft that it based it on." },
  { file: T09, in: 0.55, out: 6.15, at: at(206.4), text: "After that, I can go to the checklist and ask Loomer to check my draft against the teacher's requirements." },
  { file: T09, in: 6.15, out: 10.75, at: at(218.2, -0.2), text: 'One requirement is done, as you can see, and Loomer shows the evidence from my draft.' },
  { file: T09, in: 10.75, out: 14.85, at: at(223.0), text: 'The other four still need work, and it can tell me exactly why and what I need to do.' },
  { file: T10, in: 0.35, out: 3.8, at: at(236.0), text: "When I'm finished, I can end this session and pick Done for today." },
  { file: T10, in: 3.8, out: 7.5, at: at(239.5), text: 'Loomer suggests a next step based on my draft and the requirements,' },
  { file: T10, in: 7.5, out: 9.77, at: at(245.05), text: 'and I can edit it before I save and close.' },
  { file: T10, in: 9.77, out: 14.45, at: at(247.4), text: 'Next time I open Loomer, that step is the first thing I see, so I can jump right back into my work.' },
];

// ---- Privacy and closing ----

export const PRIVACY_TAKE = {
  file: 'media/11-privacy-and-academic-integrity-take1.mp4',
  in: 0.2,
  out: 40.0,
  text: 'Since Loomer works with student assignments and writing, privacy and academic integrity have been central design considerations. Students control which sites and documents Loomer can access, and they can pause it, exclude sites, or clear their locally stored data. Some sensitive sites, including email services, are excluded by default. AI features are optional and disabled by default. When enabled, the relevant assignment information and draft text might be sent to an external AI provider to generate guidance. We ask for zero data retention from those providers. And as we saw with the personal narrative, if a teacher explicitly prohibits AI assistance on an assignment, Loomer turns off its assignment-specific AI features.',
};
export const CLOSING_TAKE = {
  file: 'media/12-technical-implementation-and-closing-take1.mp4',
  in: 0.2,
  out: 35.5,
  text: "I built Loomer as a Chrome extension in TypeScript and React. The hardest challenge was balancing two specific things. Loomer is more useful when it can see more, but students should stay in control of what it reads, and it can help a lot, but it shouldn't do the learning for the students. So, Loomer only reads what students approve, and it guides with hints and questions instead of just finished answers. Next, I want to test Loomer with students who have executive-function challenges and learn whether it actually helps them start sooner and get back to their interrupted work. With Loomer, I want students to spend less time managing schoolwork and more time on the work that matters. Thanks for watching.",
};
export const PRIVACY_START = DEMO_END;
export const CLOSING_START = PRIVACY_START + PRIVACY_TAKE.out - PRIVACY_TAKE.in;
export const DURATION = CLOSING_START + CLOSING_TAKE.out - CLOSING_TAKE.in;

/** Final time of a moment in the privacy or closing take. */
const privacy = (take: number) => PRIVACY_START + take - PRIVACY_TAKE.in;
const closing = (take: number) => CLOSING_START + take - CLOSING_TAKE.in;

/** Everything spoken in the video, in order: what the captions and the audio are built from. */
export const SPOKEN: readonly VoicePiece[] = [
  { ...INTRO_TAKE, at: 0 },
  ...VOICE,
  { ...PRIVACY_TAKE, at: PRIVACY_START },
  { ...CLOSING_TAKE, at: CLOSING_START },
];

// ---- Camera ----

/** A camera take placed on the final timeline: final [start, end) shows take time `from` onward. */
export type CameraClip = { file: string; start: number; end: number; from: number; small?: boolean };

const PIP_LEAD = 0.3;
const PIP_TAIL = 0.4;
/** Gaps between narration pieces up to this long keep the camera up (the take keeps playing). */
const PIP_BRIDGE = 3.2;

/** Camera picture-in-picture during the demo: each narration piece with a little lead and tail. */
export const DEMO_CAMERA: readonly CameraClip[] = VOICE.map((v) => ({
  file: v.file,
  start: v.at - PIP_LEAD,
  end: v.at + (v.out - v.in) + PIP_TAIL,
  from: Math.max(0, v.in - PIP_LEAD),
  small: true,
})).map((clip, i, all) => {
  const next = all[i + 1];
  return next && next.start - clip.end <= PIP_BRIDGE ? { ...clip, end: next.start } : clip;
});

export const CAMERA: readonly CameraClip[] = [
  { file: INTRO_TAKE.file, start: 0, end: DEMO_START, from: INTRO_TAKE.in },
  ...DEMO_CAMERA,
  { file: PRIVACY_TAKE.file, start: PRIVACY_START, end: CLOSING_START, from: PRIVACY_TAKE.in },
  { file: CLOSING_TAKE.file, start: CLOSING_START, end: DURATION, from: CLOSING_TAKE.in },
];

/** Camera frame: x, y, width, height, corner radius, opacity, scale. */
export type Frame = readonly [number, number, number, number, number, number, number];
const PIP_W = 336;
const PIP_H = 189;
const M = 36;
export const FULL: Frame = [0, 0, WIDTH, HEIGHT, 0, 1, 1];
export const BR: Frame = [WIDTH - M - PIP_W, HEIGHT - M - PIP_H, PIP_W, PIP_H, 22, 1, 1];
export const BL: Frame = [M, HEIGHT - M - PIP_H, PIP_W, PIP_H, 22, 1, 1];
export const TR: Frame = [WIDTH - M - PIP_W, M, PIP_W, PIP_H, 22, 1, 1];
const hidden = (f: Frame): Frame => [f[0], f[1], f[2], f[3], f[4], 0, 0.88];

/** Camera moves: from each time the frame springs (no overshoot) toward the new one. */
export type CameraKey = { t: number; frame: Frame; response: number };
export const CAMERA_KEYS: readonly CameraKey[] = (() => {
  const keys: CameraKey[] = [
    { t: 0, frame: FULL, response: 0.01 },
    { t: 3.22, frame: BR, response: 0.8 }, // "You have to figure out..." slide 3
    { t: 15.83, frame: FULL, response: 0.7 }, // "And there's something I've struggled with"
    { t: 20.45, frame: BR, response: 0.8 }, // "The problem is..." slide 4
    { t: DEMO_START, frame: BL, response: 0.7 },
  ];
  // During the demo the camera tucks away only in longer gaps between narration pieces.
  DEMO_CAMERA.forEach((clip, i) => {
    const next = DEMO_CAMERA[i + 1];
    if (i > 0 && DEMO_CAMERA[i - 1].end < clip.start) keys.push({ t: clip.start, frame: BL, response: 0.5 });
    if (!next || next.start > clip.end) keys.push({ t: clip.end - 0.15, frame: hidden(BL), response: 0.45 });
  });
  keys.push(
    { t: PRIVACY_START, frame: FULL, response: 0.8 },
    { t: privacy(7.51), frame: BR, response: 0.8 }, // "Students control..." privacy list
    { t: privacy(31.99), frame: FULL, response: 0.7 }, // "And as we saw..."
    { t: closing(11.62), frame: TR, response: 0.8 }, // "and it can help a lot" slide 10
    { t: closing(21.0), frame: BR, response: 0.7 }, // "Next, I want to test..." slide 11
    { t: closing(29.04), frame: TR, response: 0.7 }, // "With Loomer..." slide 12
    { t: closing(34.85), frame: hidden(TR), response: 0.5 },
  );
  return keys.sort((a, b) => a.t - b.t);
})();

export const NAME_TITLE: Range = [0.45, 2.9];

// ---- Slides and the privacy list ----

/** A full-frame slide. `reveal` slides animate out on top of what follows; others hide behind it. */
export type Slide = { file: string; start: number; end: number; reveal?: boolean };
export const SLIDES: readonly Slide[] = [
  { file: 'slides/slide03.png', start: 3.22, end: 10.49 },
  { file: 'slides/slide02.png', start: 10.49, end: 15.83 },
  { file: 'slides/slide04.png', start: 20.45, end: 30.97 },
  { file: 'slides/slide05.png', start: 30.97, end: DEMO_START, reveal: true },
  { file: 'slides/slide10.png', start: closing(11.62), end: closing(21.0) },
  { file: 'slides/slide11.png', start: closing(21.0), end: closing(29.04) },
  { file: 'slides/slide12.png', start: closing(29.04), end: DURATION + 1 },
];

export const PRIVACY_LIST: { range: Range; title: string; items: readonly { at: number; text: string }[] } = {
  range: [privacy(7.51), privacy(31.99)],
  title: 'Students stay in control.',
  items: [
    { at: privacy(7.51), text: 'You choose which sites and Docs Loomer can read' },
    { at: privacy(11.2), text: 'Pause it, exclude sites, or clear everything' },
    { at: privacy(15.08), text: 'Email is off-limits by default' },
    { at: privacy(19.24), text: 'AI is off until you turn it on' },
    { at: privacy(28.84), text: 'Zero data retention requested from the AI provider' },
  ],
};

// ---- Chapter titles during the demo ----

/** A short title for each part of the demo, shown as its narration starts. */
export const CHAPTERS: readonly { at: number; title: string }[] = [
  { at: at(26.2), title: 'Know the assignment' },
  { at: at(43.05), title: 'Start a session' },
  { at: at(66.6), title: 'Research' },
  { at: at(105.0), title: 'Get unstuck' },
  { at: at(130.5), title: 'Learn the idea' },
  { at: at(170.2), title: 'Keep writing' },
  { at: at(206.4), title: 'Check your draft' },
  { at: at(236.0), title: 'Pick up later' },
];

// ---- Callouts during the demo ----

/**
 * A punch-in callout over final [start, end). `box` is the target in
 * screen-recording pixels, measured on the frames shown then (so a callout only
 * spans stretches where the recording itself is not zooming). The card sits on
 * the `side` with more free space. Every claim is checked against the README
 * support matrix.
 */
export type Callout = {
  start: number;
  end: number;
  box: Box;
  zoom: number;
  side: 'left' | 'above' | 'below';
  headline: string;
  detail: string;
};
export const CALLOUTS: readonly Callout[] = [
  { start: at(0.4), end: holdEnd('replay'), box: [1514, 194, 1574, 218], zoom: 1.3, side: 'left', headline: 'Tested on real Canvas', detail: 'This is a labeled replay. A real account worked too: 53 assignments, read-only.' },
  { start: at(4.2), end: at(8.2), box: [1076, 364, 1716, 522], zoom: 1.12, side: 'left', headline: 'Pulled from Canvas', detail: 'Loomer checks your planner and courses every 15 minutes.' },
  { start: holdStart('noai', 0.2), end: holdEnd('noai'), box: [1080, 394, 1516, 458], zoom: 1.12, side: 'left', headline: 'AI rules, checked first', detail: "Loomer reads the teacher's rule before any AI runs." },
  { start: at(20.3), end: holdEnd('week'), box: [1300, 626, 1726, 680], zoom: 1.2, side: 'left', headline: 'Checkpoints count', detail: 'Draft dates from the instructions land on your week.' },
  { start: at(35.2), end: at(40.8), box: [1448, 408, 1584, 496], zoom: 1.3, side: 'left', headline: 'Draft due Tuesday', detail: 'Found in the instructions, a day early.' },
  { start: at(121.75), end: holdEnd('refusal'), box: [1334, 350, 1728, 522], zoom: 1.15, side: 'left', headline: "Won't write it for you", detail: 'Hints and questions, never finished answers.' },
  { start: at(141.2), end: at(144.9), box: [1340, 360, 1724, 556], zoom: 1.2, side: 'left', headline: 'Cleaned before it shows', detail: 'Loomer strips anything unsafe from AI-made diagrams.' },
  { start: holdStart('quiz', 0.1), end: holdEnd('quiz'), box: [1340, 520, 1726, 582], zoom: 1.2, side: 'left', headline: 'Never graded', detail: 'Quick checks stay between you and Loomer.' },
  { start: at(179.0), end: at(184.4), box: [464, 848, 1150, 892], zoom: 1.2, side: 'above', headline: 'Reads your draft live', detail: 'Edits show up in seconds. It never changes your Doc.' },
  { start: at(192.5), end: at(197.3), box: [1310, 460, 1724, 584], zoom: 1.25, side: 'left', headline: 'Most pauses get no hint', detail: 'When one shows, it quotes your own draft.' },
  { start: at(220.4), end: at(224.6), box: [1310, 700, 1724, 856], zoom: 1.2, side: 'left', headline: 'Proof from your draft', detail: 'A requirement only counts as done with a quote.' },
  { start: at(249.6), end: holdEnd('end'), box: [1310, 250, 1730, 462], zoom: 1.15, side: 'left', headline: 'Saved on this computer', detail: 'Your next step stays in this Chrome profile.' },
];
