// The demo video's timeline, in seconds of the final 5:49 video unless a name
// says "src" (seconds of the screen recording). It mirrors rough-cut v2
// (intro take, screen recording with four cuts, privacy take, closing take), so
// the audio from that cut lines up frame for frame. Times that follow speech
// come from whisper.cpp word timings of each take.

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 349.0;

export const DEMO_START = 39.55;
export const DEMO_END = 273.9;
export const PRIVACY_START = 273.9;
export const CLOSING_START = 313.7;

export type Range = readonly [start: number, end: number];
export type Box = readonly [x0: number, y0: number, x1: number, y1: number];

// ---- Screen recording ----

export const SCREEN = 'media/screen.mp4';

/** Parts of the screen recording kept, played back to back from DEMO_START. */
export const SCREEN_KEEP: readonly Range[] = [
  [0, 44],
  [48.5, 60.5],
  [66.5, 98.5],
  [104.5, 250.85],
];

/** Final time of a moment in the screen recording (it must sit in a kept part). */
export function fromSrc(src: number): number {
  let t = DEMO_START;
  for (const [a, b] of SCREEN_KEEP) {
    if (src < b) return t + Math.max(0, src - a);
    t += b - a;
  }
  return t;
}

/** Screen-recording time shown at final time `t`. */
export function toSrc(t: number): number {
  let rest = t - DEMO_START;
  for (const [a, b] of SCREEN_KEEP) {
    if (rest < b - a) return a + rest;
    rest -= b - a;
  }
  return SCREEN_KEEP[SCREEN_KEEP.length - 1][1];
}

/**
 * Where the Gmail tab (it shows the user's address) sits while the recording is
 * zoomed out, and when that is. Found by template matching; zoomed-in frames
 * push the tab off screen.
 */
export const GMAIL_TAB: Box = [316, 42, 560, 84];
export const GMAIL_TAB_SRC: readonly Range[] = [
  [0.0, 3.5], [20.9, 25.5], [27.0, 28.2], [29.8, 33.0], [34.5, 41.5], [43.9, 49.8], [51.4, 52.9],
  [55.8, 58.5], [61.9, 68.7], [69.8, 75.8], [79.4, 80.8], [84.0, 86.5], [89.1, 97.2], [98.8, 105.3],
  [106.2, 125.1], [126.3, 131.0], [133.6, 146.5], [148.1, 161.3], [169.5, 170.5], [171.7, 174.1],
  [177.7, 188.4], [189.1, 197.7], [199.2, 203.7], [205.3, 210.2], [211.4, 213.6], [215.2, 218.6],
  [220.2, 225.0], [226.5, 235.3], [240.5, 246.4], [247.9, 251.1],
];

// ---- Camera ----

/** A camera take placed on the final timeline: final [start, end) shows take time `from` onward. */
export type CameraClip = { file: string; start: number; end: number; from: number };

/** Narration recorded for the demo, placed exactly as in rough-cut v2. `in`/`out` are take times. */
export type VoicePiece = { file: string; in: number; out: number; at: number };
export const VOICE: readonly VoicePiece[] = [
  { file: 'media/02-home-and-the-plan-take1.mp4', in: 0.55, out: 23.3, at: 39.85 },
  { file: 'media/03-reading-the-essay-take1.mp4', in: 0.4, out: 17.2, at: 65.85 },
  { file: 'media/04-starting-a-session-take1.mp4', in: 0.55, out: 11.3, at: 84.35 },
  { file: 'media/05-research-and-saving-sources-take1.mp4', in: 0.3, out: 25.9, at: 97.35 },
  { file: 'media/06-asking-for-help-take1.mp4', in: 0.47, out: 14.6, at: 129.35 },
  { file: 'media/07-general-chat-take2.mp4', in: 0.58, out: 13.85, at: 154.05 },
  { file: 'media/07-general-chat-take2.mp4', in: 13.85, out: 26.4, at: 175.05 },
  { file: 'media/08-writing-and-a-hint-take1.mp4', in: 0.4, out: 23.4, at: 200.05 },
  { file: 'media/09-checking-my-draft-take1.mp4', in: 0.56, out: 15.2, at: 233.35 },
  { file: 'media/10-ending-the-session-take1.mp4', in: 0.0, out: 14.5, at: 255.35 },
];

const PIP_LEAD = 0.3;
const PIP_TAIL = 0.4;
/** Gaps between narration pieces up to this long keep the camera up (holding the last frame). */
const PIP_BRIDGE = 1.5;

/** Camera picture-in-picture during the demo: each narration piece with a little lead and tail. */
export const DEMO_CAMERA: readonly CameraClip[] = VOICE.map((v) => ({
  file: v.file,
  start: v.at - PIP_LEAD,
  end: v.at + (v.out - v.in) + PIP_TAIL,
  from: Math.max(0, v.in - PIP_LEAD),
})).map((clip, i, all) => {
  const next = all[i + 1];
  return next && next.start - clip.end <= PIP_BRIDGE ? { ...clip, end: next.start } : clip;
});

export const CAMERA: readonly CameraClip[] = [
  { file: 'media/01-the-problem-and-introduction-take5.mp4', start: 0, end: DEMO_START, from: 0.75 },
  ...DEMO_CAMERA,
  { file: 'media/11-privacy-and-academic-integrity-take1.mp4', start: PRIVACY_START, end: CLOSING_START, from: 0.2 },
  { file: 'media/12-technical-implementation-and-closing-take1.mp4', start: CLOSING_START, end: DURATION, from: 0.2 },
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
  // During the demo the camera tucks away between narration pieces.
  DEMO_CAMERA.forEach((clip, i) => {
    const next = DEMO_CAMERA[i + 1];
    if (i > 0 && DEMO_CAMERA[i - 1].end < clip.start) keys.push({ t: clip.start, frame: BL, response: 0.5 });
    if (!next || next.start > clip.end) keys.push({ t: clip.end - 0.15, frame: hidden(BL), response: 0.45 });
  });
  keys.push(
    { t: PRIVACY_START, frame: FULL, response: 0.8 },
    { t: 281.21, frame: BR, response: 0.8 }, // "Students control..." privacy list
    { t: 305.69, frame: FULL, response: 0.7 }, // "And as we saw..."
    { t: 325.12, frame: TR, response: 0.8 }, // "and it can help a lot" slide 10
    { t: 334.5, frame: BR, response: 0.7 }, // "Next, I want to test..." slide 11
    { t: 342.54, frame: TR, response: 0.7 }, // "With Loomer..." slide 12
    { t: 348.35, frame: hidden(TR), response: 0.5 },
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
  { file: 'slides/slide10.png', start: 325.12, end: 334.5 },
  { file: 'slides/slide11.png', start: 334.5, end: 342.54 },
  { file: 'slides/slide12.png', start: 342.54, end: DURATION + 1 },
];

export const PRIVACY_LIST: { range: Range; title: string; items: readonly { at: number; text: string }[] } = {
  range: [281.21, 305.69],
  title: 'Students stay in control.',
  items: [
    { at: 281.21, text: 'You choose which sites and Docs Loomer can read' },
    { at: 284.9, text: 'Pause it, exclude sites, or clear everything' },
    { at: 288.78, text: 'Email is off-limits by default' },
    { at: 292.94, text: 'AI is off until you turn it on' },
    { at: 302.54, text: 'Zero data retention requested from the AI provider' },
  ],
};

// ---- Callouts during the demo ----

/**
 * A punch-in callout on a still stretch of the screen recording. `box` is the
 * target in screen-recording pixels; the card sits on the `side` of it with
 * more free space. Every claim is checked against the README support matrix.
 */
export type Callout = {
  src: Range;
  box: Box;
  zoom: number;
  side: 'left' | 'above' | 'below';
  headline: string;
  detail: string;
};
export const CALLOUTS: readonly Callout[] = [
  { src: [4.2, 8.2], box: [1076, 364, 1716, 522], zoom: 1.12, side: 'left', headline: 'Pulled from Canvas', detail: 'Loomer checks your planner and courses every 15 minutes.' },
  { src: [35.2, 40.8], box: [1448, 408, 1584, 496], zoom: 1.3, side: 'left', headline: 'Draft due Tuesday', detail: 'Found in the instructions, a day early.' },
  { src: [90.9, 94.3], box: [1340, 48, 1580, 76], zoom: 1.25, side: 'below', headline: 'Noticed, not read', detail: 'It spots related tabs from the title and address alone.' },
  { src: [118.4, 122.0], box: [1500, 248, 1720, 284], zoom: 1.3, side: 'left', headline: "Won't write it for you", detail: 'Hints and questions, never finished answers.' },
  { src: [127.3, 130.6], box: [1514, 190, 1700, 220], zoom: 1.3, side: 'left', headline: 'Tested on real Canvas', detail: '53 assignments across 10 courses, read-only.' },
  { src: [141.2, 145.8], box: [1340, 360, 1724, 556], zoom: 1.2, side: 'left', headline: 'Cleaned before it shows', detail: 'Loomer strips anything unsafe from AI-made diagrams.' },
  { src: [179.0, 184.0], box: [464, 848, 1150, 892], zoom: 1.2, side: 'above', headline: 'Reads your draft live', detail: 'Edits show up in seconds. It never changes your Doc.' },
  { src: [192.5, 197.3], box: [1310, 460, 1724, 584], zoom: 1.25, side: 'left', headline: 'Most pauses get no hint', detail: 'When one shows, it quotes your own draft.' },
  { src: [220.4, 224.6], box: [1310, 700, 1724, 856], zoom: 1.2, side: 'left', headline: 'Proof from your draft', detail: 'A requirement only counts as done with a quote.' },
  { src: [243.2, 246.3], box: [1330, 790, 1704, 916], zoom: 1.2, side: 'left', headline: 'Saved on this computer', detail: 'Sessions are saved in this Chrome profile.' },
];
