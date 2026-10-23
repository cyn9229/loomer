// Builds src/data/captions.json: demo captions with word timings.
//
//   node scripts/captions.ts
//
// The words are each narration piece's `text` in src/timeline.ts. The timing
// comes from the audio: the stretches where the speaker is actually talking
// (ffmpeg silencedetect on the take), with the piece's words spread across them
// by syllable count. Pauses anchor the timing, so it cannot drift. Pages are
// short single lines that break at sentences, commas, or a balanced length.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { VOICE } from '../src/timeline.ts';

type Word = { t: number; end: number; text: string };

/** Stretches of the take where someone is talking, within [from, to]. */
function speech(file: string, from: number, to: number): [number, number][] {
  const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', `../takes/${basename(file)}`, '-vn', '-af', 'silencedetect=noise=-38dB:d=0.2', '-f', 'null', '-'], { encoding: 'utf8' });
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const runs: [number, number][] = [];
  let cur = from;
  starts.forEach((s, i) => {
    const e = ends[i] ?? Infinity;
    if (e <= cur || s >= to) return;
    if (s > cur) runs.push([cur, Math.min(s, to)]);
    cur = Math.max(cur, e);
  });
  if (cur < to) runs.push([cur, to]);
  return runs.filter(([a, b]) => b - a > 0.05);
}

/** Rough syllable count, the weight of a word in time. */
const syllables = (w: string) => Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length) + 0.25;

/** Spreads the words over the talking stretches in proportion to their syllables. */
function align(words: string[], runs: [number, number][]): Word[] {
  const total = runs.reduce((s, [a, b]) => s + (b - a), 0);
  const weights = words.map(syllables);
  const sum = weights.reduce((a, b) => a + b, 0);
  const at = (voiced: number) => {
    for (const [a, b] of runs) {
      if (voiced <= b - a) return a + voiced;
      voiced -= b - a;
    }
    return runs[runs.length - 1][1];
  };
  let acc = 0;
  return words.map((text, i) => {
    const t = at((acc / sum) * total);
    acc += weights[i];
    return { text, t, end: at((acc / sum) * total) };
  });
}

const MAX_CHARS = 46;
type Page = { start: number; end: number; words: { t: number; text: string }[] };

/** Sentences become pages; long ones split into balanced lines, at a comma when one is near. */
function paginate(words: Word[]): Page[] {
  const groups: Word[][] = [[]];
  words.forEach((w, i) => {
    if (i && /[.?!]$/.test(words[i - 1].text)) groups.push([]);
    groups[groups.length - 1].push(w);
  });
  const chars = (ws: Word[]) => ws.map((w) => w.text).join(' ').length;
  const pages: Page[] = [];
  for (const g of groups.filter((g) => g.length)) {
    const target = chars(g) / Math.ceil(chars(g) / MAX_CHARS);
    let cur: Word[] = [];
    g.forEach((w, i) => {
      cur.push(w);
      const len = chars(cur);
      const rest = g.slice(i + 1);
      const atComma = /,$/.test(w.text) && len >= target - 10;
      const full = rest.length > 0 && len + 1 + rest[0].text.length > target + 6;
      if (rest.length && chars(rest) > 10 && (atComma || full)) {
        pages.push({ start: cur[0].t, end: w.end, words: cur.map(({ t, text }) => ({ t, text })) });
        cur = [];
      }
    });
    if (cur.length) pages.push({ start: cur[0].t, end: cur[cur.length - 1].end, words: cur.map(({ t, text }) => ({ t, text })) });
  }
  return pages;
}

const pages: Page[] = [];
for (const v of VOICE) {
  const words = align(v.text.split(' '), speech(v.file, v.in, v.out)).map((w) => ({ ...w, t: w.t - v.in + v.at, end: w.end - v.in + v.at }));
  pages.push(...paginate(words));
}
// Pages linger briefly but never overlap the next one.
pages.forEach((p, i) => {
  p.end = Math.min(p.end + 0.35, pages[i + 1]?.start ?? Infinity);
});
const round = (x: number) => Math.round(x * 100) / 100;
const out = pages.map((p) => ({ start: round(p.start), end: round(p.end), words: p.words.map((w) => ({ t: round(w.t), text: w.text })) }));
writeFileSync('src/data/captions.json', JSON.stringify(out, null, 1) + '\n');
console.log(`${out.length} caption pages, ${out.reduce((n, p) => n + p.words.length, 0)} words`);
