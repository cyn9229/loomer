// Side panel driver. Network probes run in the service worker; this page only
// requests permissions (which need a user gesture), drives the edit watch, and shows rows.

const $ = (id) => document.getElementById(id);
const rows = [];
let watchTimer = null;
let lastDoc = null; // { hash, chars }
let editMark = null;
let tabOrigin = null;

function add(row) {
  rows.push({ at: new Date().toISOString(), ...row });
  render();
}

function render() {
  $('results').replaceChildren(
    ...rows.map((r) => {
      const el = document.createElement('div');
      el.className = 'row';
      const head = document.createElement('div');
      head.innerHTML = `<b class="${r.result}"></b> `;
      head.querySelector('b').textContent = r.result;
      head.append(r.name);
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(r.evidence, null, 1);
      el.append(head, pre);
      if (r.localPreview) {
        const preview = document.createElement('pre');
        preview.textContent = `Local preview, not in report:\n${r.localPreview}`;
        el.append(preview);
      }
      return el;
    }),
  );
}

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (res?.error) throw new Error(res.error);
  return res.data;
}

const canvasOrigin = () => new URL($('origin').value.trim()).origin;
const docId = () => $('doc').value.match(/\/document\/d\/([\w-]+)/)?.[1] ?? $('doc').value.trim();
const authuser = () => $('authuser').value.trim() || undefined;

// Restore inputs between panel openings.
chrome.storage.local.get('inputs').then(({ inputs }) => {
  for (const id of ['origin', 'doc', 'authuser']) if (inputs?.[id]) $(id).value = inputs[id];
});
for (const id of ['origin', 'doc', 'authuser']) {
  $(id).addEventListener('change', () =>
    chrome.storage.local.set({ inputs: { origin: $('origin').value, doc: $('doc').value, authuser: $('authuser').value } }),
  );
}

/** Wraps a click handler so failures become FAIL rows instead of silent errors. */
const on = (id, name, fn) =>
  $(id).addEventListener('click', () => {
    Promise.resolve()
      .then(fn)
      .catch((e) => add({ name, result: 'FAIL', evidence: { error: String(e) } }));
  });

// permissions.request must be the first call in the click handler to keep the user gesture.
$('grant-canvas').addEventListener('click', () => {
  let origin;
  try { origin = canvasOrigin(); } catch { return add({ name: 'perm.canvasOrigin', result: 'FAIL', evidence: { error: 'invalid origin' } }); }
  chrome.permissions.request({ origins: [`${origin}/*`] }).then(
    (granted) => add({ name: 'perm.canvasOrigin', result: granted ? 'PASS' : 'FAIL', evidence: { granted } }),
    (e) => add({ name: 'perm.canvasOrigin', result: 'FAIL', evidence: { error: String(e) } }),
  );
});

$('grant-docs').addEventListener('click', () => {
  chrome.permissions.request({ origins: ['https://docs.google.com/*', 'https://*.googleusercontent.com/*'] }).then(
    (granted) => add({ name: 'perm.docs', result: granted ? 'PASS' : 'FAIL', evidence: { granted } }),
    (e) => add({ name: 'perm.docs', result: 'FAIL', evidence: { error: String(e) } }),
  );
});

on('run-canvas', 'canvas', async () => {
  for (const row of await send({ type: 'canvas', origin: canvasOrigin() })) add(row);
});

on('run-docs', 'docs', async () => {
  for (const row of await send({ type: 'docs', docId: docId(), authuser: authuser() })) add(row);
});

on('watch', 'docs.watch', async () => {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
    $('watch').textContent = 'Start edit watch';
    return add({ name: 'docs.watch', result: 'INFO', evidence: { stopped: true } });
  }
  lastDoc = null;
  $('watch').textContent = 'Stop edit watch';
  const tick = async () => {
    const t0 = Date.now();
    const r = await send({ type: 'docs-hash', docId: docId(), authuser: authuser() });
    if (!r.ok) return add({ name: 'docs.watch.read', result: 'FAIL', evidence: r.evidence });
    if (lastDoc && r.evidence.hash !== lastDoc.hash) {
      add({
        name: 'docs.edit.detected',
        result: 'PASS',
        evidence: {
          charsDelta: r.evidence.chars - lastDoc.chars,
          delayFromMarkMs: editMark ? t0 - editMark : null,
          readMs: r.evidence.ms,
        },
      });
      editMark = null;
    }
    lastDoc = { hash: r.evidence.hash, chars: r.evidence.chars };
  };
  await tick();
  add({ name: 'docs.watch', result: 'INFO', evidence: { started: true, intervalMs: 5000, chars: lastDoc?.chars } });
  watchTimer = setInterval(() => tick().catch((e) => add({ name: 'docs.watch.read', result: 'FAIL', evidence: { error: String(e) } })), 5000);
});

on('mark', 'docs.mark', () => {
  editMark = Date.now();
});

on('schedule', 'bg.schedule', async () => {
  const data = await send({ type: 'schedule-background', config: { origin: $('origin').value && canvasOrigin(), docId: $('doc').value && docId(), authuser: authuser() } });
  add({ name: 'bg.schedule', result: 'INFO', evidence: data });
});

on('load-bg', 'bg.result', async () => {
  const { bgResult } = await chrome.storage.local.get('bgResult');
  if (!bgResult) return add({ name: 'bg.result', result: 'FAIL', evidence: { error: 'no background result yet' } });
  add({ name: 'bg.run', result: 'INFO', evidence: { ranAt: bgResult.ranAt, panelOpenAtRun: bgResult.panelOpenAtRun } });
  for (const row of bgResult.results) add({ ...row, name: `bg.${row.name}` });
});

// activeTab: does opening the panel from the toolbar, then clicking here, allow a read?
on('cap-active', 'capture.activeTab', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ origin: location.origin, titleChars: document.title.length, textChars: document.body?.innerText.length ?? 0 }),
  });
  tabOrigin = result.origin;
  add({ name: 'capture.activeTab', result: 'PASS', evidence: { titleChars: result.titleChars, textChars: result.textChars } });
});

$('cap-tabs').addEventListener('click', () => {
  chrome.permissions
    .request({ permissions: ['tabs'] })
    .then(async (granted) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) tabOrigin = new URL(tab.url).origin;
      add({ name: 'perm.tabs', result: granted ? 'PASS' : 'FAIL', evidence: { granted, urlVisible: Boolean(tab?.url), titleVisible: Boolean(tab?.title) } });
    })
    .catch((e) => add({ name: 'perm.tabs', result: 'FAIL', evidence: { error: String(e) } }));
});

// Needs tabOrigin from one of the two buttons above, so the request stays first in the gesture.
$('cap-origin').addEventListener('click', () => {
  if (!tabOrigin) return add({ name: 'capture.origin', result: 'FAIL', evidence: { error: 'run one of the two buttons above first' } });
  chrome.permissions
    .request({ origins: [`${tabOrigin}/*`] })
    .then(async (granted) => {
      if (!granted) return add({ name: 'capture.origin', result: 'FAIL', evidence: { granted } });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.body?.innerText.length ?? 0 });
      add({ name: 'capture.origin', result: 'PASS', evidence: { granted, textChars: result } });
    })
    .catch((e) => add({ name: 'capture.origin', result: 'FAIL', evidence: { error: String(e) } }));
});

on('copy', 'copy', async () => {
  const report = rows.map(({ localPreview, ...row }) => row);
  await navigator.clipboard.writeText(JSON.stringify({ probe: 'loomer-g0', chrome: navigator.userAgent, rows: report }, null, 1));
  add({ name: 'copy', result: 'INFO', evidence: { copiedRows: report.length } });
});

on('clear', 'clear', () => {
  rows.length = 0;
  render();
});
