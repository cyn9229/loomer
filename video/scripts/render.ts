// Renders the video in three parts, so a change only re-renders the part it
// touches, then joins the parts and adds the audio.
//
//   node scripts/render.ts                 all parts
//   node scripts/render.ts demo            just the demo (intro and outro reuse out/parts/)
//   PORT=3092 node scripts/render.ts ...   if another app holds the default port
//
// Parts: intro (camera and slides), demo (screen recording), outro (privacy and
// closing). Every frame is rendered on its own, so parts join seamlessly. Run
// `node scripts/audio.ts` first when the audio changed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { DEMO_START, DURATION, FPS, PRIVACY_START } from '../src/timeline.ts';

const f = (t: number) => Math.round(t * FPS);
const PARTS = {
  intro: [0, f(DEMO_START) - 1],
  demo: [f(DEMO_START), f(PRIVACY_START) - 1],
  outro: [f(PRIVACY_START), f(DURATION) - 1],
} as const;
type Part = keyof typeof PARTS;

const requested = process.argv.slice(2);
const isPart = (p: string): p is Part => p in PARTS;
const bad = requested.filter((p) => !isPart(p));
if (bad.length) throw new Error(`unknown part ${bad.join(', ')}; use ${Object.keys(PARTS).join(', ')}`);
const parts: Part[] = requested.length ? requested.filter(isPart) : (Object.keys(PARTS) as Part[]);

const run = (cmd: string, args: string[]) => {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} failed`);
};

mkdirSync('out/parts', { recursive: true });
run('npx', ['remotion', 'bundle', 'src/index.ts', '--out-dir', 'out/bundle']);
for (const p of parts) {
  const [a, b] = PARTS[p];
  const started = Date.now();
  run('npx', ['remotion', 'render', 'out/bundle', 'Demo', `out/parts/${p}.mp4`, '--muted', `--frames=${a}-${b}`, '--concurrency=8', `--port=${process.env.PORT ?? 3091}`, '--timeout=120000']);
  console.log(`${p}: ${b - a + 1} frames in ${Math.round((Date.now() - started) / 1000)} s`);
}

const missing = (Object.keys(PARTS) as Part[]).filter((p) => !existsSync(`out/parts/${p}.mp4`));
if (missing.length) throw new Error(`render ${missing.join(', ')} before joining`);
writeFileSync('out/parts/list.txt', (Object.keys(PARTS) as Part[]).map((p) => `file '${p}.mp4'`).join('\n') + '\n');
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'out/parts/list.txt', '-c', 'copy', 'out/demo-video-picture.mp4']);
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'out/demo-video-picture.mp4', '-i', 'out/audio.m4a', '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', 'out/demo-video.mp4']);
console.log('wrote out/demo-video.mp4');
