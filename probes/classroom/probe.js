// Side panel driver. Network probes run in the service worker; this page collects
// inputs, shows rows, and copies the report without any localPreview.

const $ = (id) => document.getElementById(id);
const SAVED = ['authuser', 'course', 'assignment']; // title and phrase are never saved
const rows = [];

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
      const badge = document.createElement('b');
      badge.className = r.result;
      badge.textContent = r.result;
      head.append(badge, ` ${r.name}`);
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(r.evidence, null, 1);
      el.append(head, pre);
      if (r.localPreview) {
        const preview = document.createElement('pre');
        preview.className = 'preview';
        preview.textContent = `Local preview, not in report:\n${r.localPreview}`;
        el.append(preview);
      }
      return el;
    }),
  );
}

chrome.storage.local.get('inputs').then(({ inputs }) => {
  for (const id of SAVED) if (inputs?.[id]) $(id).value = inputs[id];
});
for (const id of SAVED) {
  $(id).addEventListener('change', () => chrome.storage.local.set({ inputs: Object.fromEntries(SAVED.map((k) => [k, $(k).value])) }));
}

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'classroom',
      options: {
        authuser: $('authuser').value.trim() || '0',
        courseUrl: $('course').value.trim() || undefined,
        assignmentUrl: $('assignment').value.trim() || undefined,
        knownTitle: $('title').value.trim() || undefined,
        knownPhrase: $('phrase').value.trim() || undefined,
        preview: $('preview').checked,
      },
    });
    if (res?.error) throw new Error(res.error);
    for (const row of res.data) add(row);
  } catch (e) {
    add({ name: 'run', result: 'FAIL', evidence: { error: String(e) } });
  } finally {
    $('run').disabled = false;
  }
});

$('copy').addEventListener('click', async () => {
  const report = rows.map(({ localPreview, ...row }) => row);
  await navigator.clipboard.writeText(JSON.stringify({ probe: 'loomer-classroom', chrome: navigator.userAgent, rows: report }, null, 1));
  add({ name: 'copy', result: 'INFO', evidence: { copiedRows: report.length } });
});

$('clear').addEventListener('click', () => {
  rows.length = 0;
  render();
});
