// Repeatable rehearsal of the demo against the labeled Canvas replay.
// Starts the local server if needed, resets the replay dates, builds the E2E
// variant of the extension, drives the main flow in Chromium, saves a
// screenshot per step, and fails loudly when a check does not hold.
//
//   npm run e2e:replay              (first time: npx playwright install chromium)
//
// AI steps use server/.env (OPENROUTER_API_KEY) and cost a few cents. Without a
// key they are reported as skipped, not passed.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = 'http://127.0.0.1:8787';
const ESSAY = `${SERVER}|user:900001#assignment:5001`;
const NARRATIVE = `${SERVER}|user:900001#assignment:5005`;
const out = join(root, 'e2e-out', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, result: ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function serverUp() {
  try {
    return (await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}

let server;
if (!(await serverUp())) {
  console.log('Starting the local server...');
  server = spawn('node', ['--env-file-if-exists=.env', 'src/index.ts'], { cwd: join(root, 'server'), stdio: 'ignore' });
  for (let i = 0; i < 20 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 300));
}
await fetch(`${SERVER}/replay/reset`, { method: 'POST' });

console.log('Building the E2E extension...');
execSync('npx wxt build --mode e2e', { cwd: join(root, 'extension'), env: { ...process.env, LOOMER_E2E: '1' }, stdio: 'ignore' });
const ext = join(root, 'extension', '.output', 'chrome-mv3-e2e');

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'loomer-rehearsal-')), {
  channel: 'chromium',
  headless: true,
  deviceScaleFactor: 2,
  viewport: { width: 400, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const panel = await ctx.newPage();
const pageErrors = [];
panel.on('pageerror', (e) => pageErrors.push(e.message));
await panel.goto(`chrome-extension://${id}/sidepanel.html`);

const send = (m) => panel.evaluate((m) => chrome.runtime.sendMessage(m), m);
const shot = async (n, name) => {
  await panel.waitForTimeout(600);
  await panel.screenshot({ path: join(out, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: true });
};
const table = (store) =>
  panel.evaluate(
    (store) =>
      new Promise((res) => {
        const q = indexedDB.open('loomer');
        q.onsuccess = () => {
          const r = q.result.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => {
            q.result.close();
            res(r.result);
          };
        };
      }),
    store,
  );
const waitFor = async (fn, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await panel.waitForTimeout(500);
  }
  return null;
};
const lastReply = async (thread) => (await table('chatTurns')).filter((t) => t.threadKey === thread && t.role === 'loomer').at(-1);
/** Sends a message and waits for the reply that comes after it (not an earlier one). */
const ask = async (thread, text) => {
  const before = (await lastReply(thread))?.id ?? 0;
  await send({ type: 'chat:send', threadKey: thread, text });
  return waitFor(async () => {
    const r = await lastReply(thread);
    return r && r.id > before && r.status !== 'streaming' ? r : null;
  }, 120_000);
};

try {
  // 1. Setup and collection
  await shot(1, 'not-connected');
  check('connect replay', (await send({ type: 'canvas:connect', origin: SERVER })).ok);
  check('turn AI on', (await send({ type: 'ai:set', enabled: true })).ok);
  const run = await waitFor(async () => (await table('runs')).at(-1), 15_000);
  check('Canvas replay collected', run?.outcome === 'ok', `${run?.coverage?.plannerItems ?? 0} planner items`);
  const service = await sw.evaluate(() => chrome.storage.local.get('aiService'));
  const aiUp = service.aiService?.up === true;
  check('AI service reachable', aiUp ? true : null, aiUp ? '' : 'no key or server; AI steps skipped');
  if (aiUp) {
    const analyzed = await waitFor(async () => (await table('analyses')).filter((a) => a.status === 'ok').length >= 3 || null, 60_000);
    check('requirement analysis ran', Boolean(analyzed));
  }
  await panel.reload();
  await shot(2, 'home');
  const home = await panel.innerText('body');
  check('Home shows a next step', /Start working|Keep going|Start session|Next step/i.test(home));
  check('replay is labeled', /Replay/i.test(home));

  // 2. Work session and research
  check('start essay session', (await send({ type: 'session:start', assignmentId: ESSAY })).ok);
  await send({ type: 'discovery:set', enabled: true });
  const source = await ctx.newPage();
  await source.goto('http://localhost:8787/sources/heat-islands');
  await source.bringToFront();
  const suggestion = await waitFor(async () => (await sw.evaluate(() => chrome.storage.session.get('discovery'))).discovery?.suggestion, 40_000);
  const discovery = (await sw.evaluate(() => chrome.storage.session.get('discovery'))).discovery;
  check('research suggestion after dwell', Boolean(suggestion), suggestion?.matched?.join(', ') ?? JSON.stringify(discovery));
  if (suggestion) {
    await send({ type: 'suggestion:add', tabId: suggestion.tabId });
    check('suggested page saved', (await waitFor(async () => (await table('sources')).length, 5_000)) === 1);
  }
  await panel.bringToFront();
  await shot(3, 'session');

  // 3. Ask Loomer
  if (aiUp) {
    const plan = await ask('general', 'What should I work on this week?');
    check('chat: plans with the assignment tool', plan?.status === 'done' && plan.blocks.some((b) => b.kind === 'tool'), plan?.error ?? plan?.blocks.map((b) => b.kind).join(','));
    const visual = await ask('general', 'Explain the urban heat island effect simply, with a small diagram.');
    check('chat: makes a visual', visual?.status === 'done' && visual.blocks.some((b) => b.kind === 'visual'), visual?.error ?? visual?.blocks.map((b) => b.kind).join(','));
    const quiz = await ask('general', 'Can you quiz me on that?');
    check('chat: makes a quiz', quiz?.status === 'done' && quiz.blocks.some((b) => b.kind === 'quiz'), quiz?.error ?? quiz?.blocks.map((b) => b.kind).join(','));
    const demo = await ask('general', 'Show me a small interactive demo: a slider for tree canopy percent that shows how street temperature changes.');
    const interactive = demo?.blocks.some((b) => b.kind === 'visual' && b.visual.type === 'interactive');
    check('chat: makes an interactive demo', demo?.status === 'done' && interactive ? true : demo?.status === 'done' ? null : false, demo?.blocks.map((b) => b.kind).join(','));
    // Open the real chat screen and confirm the visuals render there.
    const askBar = panel.getByText(/Ask Loomer anything/i).first();
    if (await askBar.count()) {
      await askBar.click();
      await panel.waitForTimeout(1_500);
      await shot(4, 'chat');
      const svgCount = await panel.locator('.vis-svg svg, svg[role="img"]').count();
      check('chat screen renders the diagram', svgCount > 0, `${svgCount} svg`);
      const frames = await panel.locator('iframe[sandbox]').count();
      check('chat screen embeds the demo in a sandboxed frame', interactive ? frames > 0 : null, `${frames} sandboxed iframes`);
      await panel.mouse.wheel(0, 4000);
      await shot(5, 'chat-bottom');
    } else {
      check('chat screen opened', false, 'Ask bar not found');
    }
  } else {
    check('chat steps', null, 'AI service not available');
  }
  const blocked = await ask(NARRATIVE, 'Help me get started.');
  check('no-AI assignment is refused without sending', blocked?.error === 'not-allowed');

  // 4. Privacy: Gmail is never captured; widget sandbox stays isolated
  const sandbox = await panel.evaluate(async () => {
    const html = `<script>const r={};r.chrome=typeof chrome!=='undefined'&&!!(chrome.runtime&&chrome.runtime.id);try{document.cookie;r.cookie='open'}catch(e){r.cookie='blocked'}fetch('${'http://127.0.0.1:8787/health'}').then(()=>{r.net='OPEN';parent.postMessage({t:'r',r},'*')},()=>{r.net='blocked';parent.postMessage({t:'r',r},'*')});<\/script>`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = chrome.runtime.getURL('/widget.html');
    document.body.appendChild(frame);
    return new Promise((resolve) => {
      setTimeout(() => resolve(null), 6_000);
      window.addEventListener('message', (e) => {
        if (e.source !== frame.contentWindow) return;
        if (e.data?.type === 'loomer-widget-ready') frame.contentWindow.postMessage({ type: 'loomer-widget', html }, '*');
        if (e.data?.t === 'r') resolve(e.data.r);
      });
    });
  });
  check('widget sandbox isolated', sandbox?.chrome === false && sandbox?.cookie === 'blocked' && sandbox?.net === 'blocked', JSON.stringify(sandbox));

  // 5. End and resume
  check('end session', (await send({ type: 'session:end' })).ok);
  await panel.reload();
  await shot(6, 'home-after-session');
  check('no page errors in the panel', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  await ctx.close();
  server?.kill();
  writeFileSync(join(out, 'report.json'), JSON.stringify(results, null, 2));
  console.log(`\nScreenshots and report: ${out}`);
}

const failed = results.filter((r) => r.result === 'FAIL');
console.log(`${results.filter((r) => r.result === 'PASS').length} passed, ${failed.length} failed, ${results.filter((r) => r.result === 'SKIP').length} skipped`);
process.exit(failed.length ? 1 : 0);
