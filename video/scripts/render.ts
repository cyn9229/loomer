// Renders the video in four parts, so a change only re-renders the part it
// touches, then joins the parts and adds the audio.
//
//   node scripts/render.ts                 all parts
//   node scripts/render.ts demo            just the demo (the other parts reuse out/parts/)
//   node scripts/render.ts join            no rendering: join the parts and add the audio
//   PORT=3092 node scripts/render.ts ...   if another app holds the default port
//
// Parts: title (the opening card, its own composition), intro (camera and
// slides), demo (screen recording), outro (privacy and closing). Every frame is
// rendered on its own, so parts join seamlessly. Run `node scripts/audio.ts`
// first when the audio changed. Each run bundles into its own folder, so two
// runs at once do not disturb each other.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { DEMO_START, DURATION, FPS, PRIVACY_START, TITLE } from '../src/timeline.ts';

const f = (t: number) => Math.round(t * FPS);
const PARTS = {
  title: { comp: 'Title', frames: [0, f(TITLE.duration) - 1] },
  intro: { comp: 'Demo', frames: [0, f(DEMO_START) - 1] },
  demo: { comp: 'Demo', frames: [f(DEMO_START), f(PRIVACY_START) - 1] },
  outro: { comp: 'Demo', frames: [f(PRIVACY_START), f(DURATION) - 1] },
} as const;
type Part = keyof typeof PARTS;

const joinOnly = process.argv[2] === 'join';
const requested = joinOnly ? [] : process.argv.slice(2);
const isPart = (p: string): p is Part => p in PARTS;
const bad = requested.filter((p) => !isPart(p));
if (bad.length) throw new Error(`unknown part ${bad.join(', ')}; use ${Object.keys(PARTS).join(', ')}`);
const parts: Part[] = joinOnly ? [] : requested.length ? requested.filter(isPart) : (Object.keys(PARTS) as Part[]);

const run = (cmd: string, args: string[]) => {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} failed`);
};

mkdirSync('out/parts', { recursive: true });
const bundle = `out/bundle-${process.pid}`;
if (parts.length) run('npx', ['remotion', 'bundle', 'src/index.ts', '--out-dir', bundle]);
for (const p of parts) {
  const { comp, frames: [a, b] } = PARTS[p];
  const started = Date.now();
  run('npx', ['remotion', 'render', bundle, comp, `out/parts/${p}.mp4`, '--muted', `--frames=${a}-${b}`, '--concurrency=8', `--port=${process.env.PORT ?? 3091}`, '--timeout=120000']);
  console.log(`${p}: ${b - a + 1} frames in ${Math.round((Date.now() - started) / 1000)} s`);
}
rmSync(bundle, { recursive: true, force: true });

const missing = (Object.keys(PARTS) as Part[]).filter((p) => !existsSync(`out/parts/${p}.mp4`));
if (missing.length) throw new Error(`render ${missing.join(', ')} before joining`);
writeFileSync('out/parts/list.txt', (Object.keys(PARTS) as Part[]).map((p) => `file '${p}.mp4'`).join('\n') + '\n');
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'out/parts/list.txt', '-c', 'copy', 'out/demo-video-picture.mp4']);
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'out/demo-video-picture.mp4', '-i', 'out/audio.m4a', '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', 'out/demo-video.mp4']);
console.log('wrote out/demo-video.mp4');
