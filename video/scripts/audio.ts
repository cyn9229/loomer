// Builds the video's sound from src/timeline.ts, the same timeline the picture
// uses: the intro, every demo narration piece, privacy and closing takes, and
// background music ducked under the voice.
//
//   node scripts/audio.ts      writes out/voice.wav (voice only, for checks) and out/audio.m4a
//
// Every piece is laid on a silent bed of the video's exact length, so no
// piece can shift another (mixing without the bed drops leading silence).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { CLOSING_START, CLOSING_TAKE, DURATION, INTRO_TAKE, PRIVACY_START, PRIVACY_TAKE, VOICE } from '../src/timeline.ts';

const MUSIC = 'public/music/digital-clouds.mp3';
/** Music level before ducking (about -14 dB). The ducker takes it down a further ~10 dB while someone talks. */
const MUSIC_LEVEL = 0.2;
const COPIES = Math.ceil(DURATION / 95) + 1;

type Piece = { file: string; in: number; out: number; at: number };
const pieces: Piece[] = [
  { file: INTRO_TAKE.file, in: INTRO_TAKE.in, out: INTRO_TAKE.out, at: 0 },
  ...VOICE,
  { file: PRIVACY_TAKE.file, in: PRIVACY_TAKE.in, out: PRIVACY_TAKE.out, at: PRIVACY_START },
  { file: CLOSING_TAKE.file, in: CLOSING_TAKE.in, out: CLOSING_TAKE.out, at: CLOSING_START },
];

const run = (args: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
};

mkdirSync('out', { recursive: true });
const MONO = 'aformat=sample_rates=48000:channel_layouts=mono';

// 1. Voice: each piece trimmed, faded at its cut points, and placed on the bed.
const inputs = pieces.flatMap((p) => ['-i', `../takes/${basename(p.file)}`]);
const voice = [
  `anullsrc=r=48000:cl=mono,atrim=0:${DURATION}[bed]`,
  ...pieces.map(
    (p, i) =>
      `[${i}:a]atrim=${p.in}:${p.out},asetpts=PTS-STARTPTS,${MONO},afade=t=in:d=0.02,afade=t=out:st=${(p.out - p.in - 0.04).toFixed(3)}:d=0.04,adelay=${Math.round(p.at * 1000)}:all=1[v${i}]`,
  ),
  `[bed]${pieces.map((_, i) => `[v${i}]`).join('')}amix=inputs=${pieces.length + 1}:normalize=0:duration=first,atrim=0:${DURATION},${MONO}[out]`,
].join(';');
run([...inputs, '-filter_complex', voice, '-map', '[out]', '-c:a', 'pcm_s16le', 'out/voice.wav']);

// 2. Music looped with crossfades, ducked under the voice, then the full mix leveled.
const music = [
  `[1:a]${MONO.replace('mono', 'stereo')}[m0]`,
  ...Array.from({ length: COPIES - 1 }, (_, i) => `[${i + 2}:a]aformat=sample_rates=48000:channel_layouts=stereo[c${i}]`),
  ...Array.from({ length: COPIES - 1 }, (_, i) => `[${i ? `x${i - 1}` : 'm0'}][c${i}]acrossfade=d=2.5:c1=tri:c2=tri[x${i}]`),
  `[x${COPIES - 2}]atrim=0:${DURATION},volume=${MUSIC_LEVEL},afade=t=in:d=1.5,afade=t=out:st=${(DURATION - 4).toFixed(2)}:d=4[music]`,
  `[0:a]asplit=2[vmix][vkey]`,
  `[vkey]aformat=channel_layouts=stereo[key]`,
  `[music][key]sidechaincompress=threshold=0.015:ratio=6:attack=40:release=500[ducked]`,
  `[vmix]aformat=sample_rates=48000:channel_layouts=stereo[vst]`,
  `[vst][ducked]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[out]`,
].join(';');
run([
  '-i', 'out/voice.wav',
  ...Array.from({ length: COPIES }, () => ['-i', MUSIC]).flat(),
  '-filter_complex', music,
  '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-t', String(DURATION), 'out/audio.m4a',
]);
console.log(`wrote out/voice.wav and out/audio.m4a (${DURATION.toFixed(2)} s, ${pieces.length} pieces, music x${COPIES})`);
