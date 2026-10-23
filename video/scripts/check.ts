// Prints the demo edit for review: each narration piece's final time, any
// overlap (an error), and every silent gap, plus where callouts sit.
//
//   node scripts/check.ts
import { CALLOUTS, CHAPTERS, DEMO_END, DEMO_START, DURATION, VOICE } from '../src/timeline.ts';

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
let problems = 0;
let prevEnd = DEMO_START;
for (const v of VOICE) {
  const end = v.at + v.out - v.in;
  const gap = v.at - prevEnd;
  if (gap < -0.01) {
    problems++;
    console.log(`  OVERLAP ${gap.toFixed(2)}s`);
  } else if (gap > 1.2) console.log(`  gap ${gap.toFixed(1)}s`);
  console.log(`${clock(v.at)}-${clock(end)}  ${v.file.slice(6, 8)} ${v.in.toFixed(2)}-${v.out.toFixed(2)}`);
  prevEnd = end;
}
console.log(`  tail ${(DEMO_END - prevEnd).toFixed(1)}s`);
for (const c of CALLOUTS) {
  const len = c.end - c.start;
  if (len < 3.4) problems++;
  console.log(`callout ${clock(c.start)} ${len.toFixed(1)}s${len < 3.4 ? ' TOO SHORT' : ''}  ${c.headline}`);
}
for (const c of CHAPTERS) console.log(`chapter ${clock(c.at)} ${c.title}`);
console.log(`demo ${clock(DEMO_START)}-${clock(DEMO_END)} (${(DEMO_END - DEMO_START).toFixed(1)}s), total ${clock(DURATION)}`);
if (problems) {
  console.log(`${problems} problem(s)`);
  process.exit(1);
}
