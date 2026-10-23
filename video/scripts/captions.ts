// Builds src/data/captions.json: demo captions with word timings. Run after
// transcribing each narration take:
//
//   whisper-cli -m .models/ggml-base.en.bin -f <take>.wav -ml 1 -sow -ojf -of transcripts/<take> --dtw base.en
//   node scripts/captions.ts
//
// Whisper gives the words; its timestamps drift late on longer takes, so the
// timing comes from the audio instead: the stretches where the speaker is
// actually talking (ffmpeg silencedetect), with words spread across them by
// syllable count. Pauses anchor the timing, so it cannot drift. Words are then
// placed on the final timeline the same way rough-cut v2 placed the audio (see
// VOICE in src/timeline.ts) and grouped into short one-line pages.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { VOICE } from '../src/timeline.ts';

type Word = { t: number; end: number; text: string };
type Whisper = { transcription: { offsets: { from: number; to: number }; text: string }[] };

/** Fixes for words whisper misheard, per take: [heard, meant]. Matched on whole words in order. */
const FIXES: Record<string, [string, string][]> = {
  '02': [['I chose me', 'it shows me'], ["heat-ion's", 'heat islands'], ['"no AI"', 'No AI'], ['view/week view', 'week view']],
  '03': [["heat-urban heat-iron's", 'urban heat islands'], ['I also caught', 'It also caught']],
  '04': [['Start Working,', 'Start working,']],
  '07': [['score-related.', 'school-related.']],
  '08': [['answered', 'answer'], ["each of source's", "each source's"], ['show the line', 'Show the line']],
  '10': [['"Done"', 'Done']],
};

/** Applies the fixes, then capitalizes the product name everywhere. */
const clean = (words: Word[], take: string) =>
  fix(words, FIXES[take.slice(0, 2)] ?? []).map((w) => ({ ...w, text: w.text.replace(/^loomer/, 'Loomer') }));

function readTake(file: string): Word[] {
  const json = JSON.parse(readFileSync(`transcripts/${file}.json`, 'utf8')) as Whisper;
  return json.transcription
    .map((s) => ({ t: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim() }))
    .filter((w) => w.text && !w.text.startsWith('['));
}

/** Replaces each heard phrase with the meant one, spreading its time evenly over the new words. */
function fix(words: Word[], fixes: [string, string][]): Word[] {
  let out = words;
  for (const [heard, meant] of fixes) {
    const h = heard.split(' ');
    const next: Word[] = [];
    for (let i = 0; i < out.length; i++) {
      if (h.every((x, j) => out[i + j]?.text === x)) {
        const span = out.slice(i, i + h.length);
        const m = meant.split(' ');
        const t0 = span[0].t;
        const step = (span[span.length - 1].end - t0) / m.length;
        m.forEach((text, k) => next.push({ t: t0 + k * step, end: t0 + (k + 1) * step, text }));
        i += h.length - 1;
      } else next.push(out[i]);
    }
    out = next;
  }
  return out;
}

const MAX_CHARS = 46;
type Page = { start: number; end: number; words: { t: number; text: string }[] };

/** Sentences (and anything after a long pause) become pages; long ones split into balanced lines, at a comma when one is near. */
function paginate(words: Word[]): Page[] {
  const groups: Word[][] = [[]];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && (/[.?!]$/.test(prev.text) || w.t - prev.end > 0.6)) groups.push([]);
    groups[groups.length - 1].push(w);
  });
  const chars = (ws: Word[]) => ws.map((w) => w.text).join(' ').length;
  const pages: Page[] = [];
  for (const g of groups.filter((g) => g.length)) {
    const total = chars(g);
    const target = total / Math.ceil(total / MAX_CHARS);
    let cur: Word[] = [];
    g.forEach((w, i) => {
      cur.push(w);
      const len = chars(cur);
      const rest = g.slice(i + 1);
      const atComma = /,$/.test(w.text) && len >= target - 10;
      const full = rest.length > 0 && len + 1 + rest[0].text.length > target + 6;
      if (rest.length && chars(rest) > 6 && (atComma || full)) {
        pages.push({ start: cur[0].t, end: w.end, words: cur.map(({ t, text }) => ({ t, text })) });
        cur = [];
      }
    });
    if (cur.length) pages.push({ start: cur[0].t, end: cur[cur.length - 1].end, words: cur.map(({ t, text }) => ({ t, text })) });
  }
  // Pages linger briefly but never overlap the next one.
  pages.forEach((p, i) => {
    p.end = Math.min(p.end + 0.35, pages[i + 1]?.start ?? Infinity);
  });
  return pages;
}

/** Stretches of the take where someone is talking, within [from, to]. */
function speech(file: string, from: number, to: number): [number, number][] {
  const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', `public/${file}`, '-vn', '-af', 'silencedetect=noise=-38dB:d=0.2', '-f', 'null', '-'], { encoding: 'utf8' });
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
function align(words: Word[], runs: [number, number][]): Word[] {
  const total = runs.reduce((s, [a, b]) => s + (b - a), 0);
  const weights = words.map((w) => syllables(w.text));
  const sum = weights.reduce((a, b) => a + b, 0);
  const at = (voiced: number) => {
    for (const [a, b] of runs) {
      if (voiced <= b - a) return a + voiced;
      voiced -= b - a;
    }
    return runs[runs.length - 1][1];
  };
  let acc = 0;
  return words.map((w, i) => {
    const t = at((acc / sum) * total);
    acc += weights[i];
    return { text: w.text, t, end: at((acc / sum) * total) };
  });
}

/**
 * Splits a take's words between the pieces cut from it: each piece starts at
 * the sentence that begins closest to its cut point.
 */
function split(words: Word[], pieces: typeof VOICE[number][], runs: [number, number][]): Word[][] {
  const rough = align(words, runs);
  const starts = rough.map((w, i) => (i === 0 || /[.?!]$/.test(rough[i - 1].text) ? i : -1)).filter((i) => i >= 0);
  const cuts = pieces.slice(1).map((p) => starts.reduce((best, i) => (Math.abs(rough[i].t - p.in) < Math.abs(rough[best].t - p.in) ? i : best), starts[0]));
  return pieces.map((_, k) => words.slice(k ? cuts[k - 1] : 0, k < cuts.length ? cuts[k] : undefined));
}

const pages: Page[] = [];
for (const file of [...new Set(VOICE.map((v) => v.file))]) {
  const pieces = VOICE.filter((v) => v.file === file);
  const take = basename(file, '.mp4');
  const words = clean(readTake(take), take);
  const parts = split(words, pieces, speech(file, pieces[0].in, pieces[pieces.length - 1].out));
  pieces.forEach((v, k) => {
    // Time each piece on its own talking stretches, so a cut point is also an anchor.
    const mine = align(parts[k], speech(file, v.in, v.out)).map((w) => ({ ...w, t: w.t - v.in + v.at, end: w.end - v.in + v.at }));
    pages.push(...paginate(mine));
  });
}
const round = (x: number) => Math.round(x * 100) / 100;
const out = pages.map((p) => ({ start: round(p.start), end: round(p.end), words: p.words.map((w) => ({ t: round(w.t), text: w.text })) }));
writeFileSync('src/data/captions.json', JSON.stringify(out, null, 1) + '\n');
console.log(`${out.length} caption pages, ${out.reduce((n, p) => n + p.words.length, 0)} words`);
