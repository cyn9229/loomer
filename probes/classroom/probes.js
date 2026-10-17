// Read-only Google Classroom probe. It runs in the service worker, the transport a real
// background adapter would use. GET requests only. Every row is evidence (status, counts,
// lengths, timings, marker names), never page content, except `localPreview`, which the
// panel shows only when the student turns it on and never copies.

const CLASSROOM = 'https://classroom.google.com';
const API = 'https://classroom.googleapis.com/v1';
const PAUSE_MS = 300;
const MAX_ACCOUNTS = 5;
const DAY_MS = 86_400_000;

// Classroom links: /c/{course}, /w/{course}/t/all, /c/{course}/{kind}/{item}/details.
// IDs are usually base64 of a decimal ID, e.g. NjI1MDk5MzA1MjIy -> 625099305222.
// Item kinds seen in Classroom URLs: a assignment, m material, sa/mc question, p post.
const REF_RE =
  /(?<![\w.])(?:https:\/\/classroom\.google\.com)?(?:\/u\/\d+)?\/(?:c|w)\/([A-Za-z0-9_-]{8,32})(?:\/(a|m|sa|mc|p)\/([A-Za-z0-9_-]{8,32}))?/g;

const LINK_KINDS = [
  ['doc', /docs\.google\.com\/document\/d\//],
  ['sheet', /docs\.google\.com\/spreadsheets\/d\//],
  ['slides', /docs\.google\.com\/presentation\/d\//],
  ['form', /docs\.google\.com\/forms\/|forms\.gle\//],
  ['driveFile', /drive\.google\.com\/(?:file\/d\/|open\?id=)/],
  ['youtube', /youtube\.com\/watch|youtu\.be\//],
];
const GOOGLE_INFRA = /^https:\/\/(?:[\w-]+\.)*(?:google|gstatic|googleapis|googleusercontent|youtube|ggpht|withgoogle)\.com\//;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const count = (text, re) => text.match(re)?.length ?? 0;

/** Keeps path shape but hides IDs (segments of 8+ chars that contain a digit). */
const redactPath = (path) => path.split('/').map((seg) => (/^(?=.*\d)[\w-]{8,}$/.test(seg) ? ':id' : seg)).join('/');

/** Undoes the escapes embedded data uses, so links and emails in JSON match plain regexes. */
const normalize = (html) =>
  html
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u003[dD]/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\u0040/g, '@');

/** GET a URL and summarize the response without its body. Network errors become evidence. */
async function probeGet(url, { credentials = 'include', accept = 'text/html' } = {}) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, { credentials, headers: { Accept: accept }, redirect: 'follow', cache: 'no-store' });
  } catch (error) {
    // A redirect to an origin outside host_permissions also lands here.
    return { evidence: { fetchError: String(error), ms: Math.round(performance.now() - t0) }, text: '', json: null, headers: null };
  }
  const text = await res.text();
  const final = new URL(res.url);
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0];
  let json = null;
  if (contentType.includes('json')) {
    try { json = JSON.parse(text); } catch { /* reported via jsonParsed */ }
  }
  return {
    evidence: {
      status: res.status,
      redirected: res.redirected,
      finalHost: final.host,
      finalPath: redactPath(final.pathname),
      contentType,
      ms: Math.round(performance.now() - t0),
      bytes: text.length,
      jsonParsed: json !== null,
      landing: landing(final, text),
    },
    text,
    json,
    headers: res.headers,
  };
}

/** Where a request ended up: the Classroom app, a Google sign-in page, a marketing page, or elsewhere. */
function landing(final, text) {
  if (final.host === 'accounts.google.com') return 'signIn';
  if (final.host === 'classroom.googleapis.com') return 'api';
  if (final.host === 'classroom.google.com') {
    if (/AF_initDataCallback|WIZ_global_data/.test(text)) return 'classroomApp';
    return /<input[^>]+type=["']?password/i.test(text) ? 'signIn' : 'classroomOther';
  }
  if (/(^|\.)(edu|workspace|www)\.google\.com$/.test(final.host)) return 'marketing';
  return 'other';
}

function visibleText(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => entities[e])
    .replace(/\s+/g, ' ')
    .trim();
}

/** Human-looking strings (have a space and a word) inside AF_initDataCallback script blocks. */
function embeddedStrings(html) {
  const out = [];
  for (const [, body] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!body.includes('AF_initDataCallback')) continue;
    for (const [quoted] of body.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (quoted.length < 14) continue;
      let s;
      try { s = JSON.parse(quoted); } catch { continue; }
      if (/\s/.test(s) && /\p{L}{3}/u.test(s) && !/^https?:/.test(s) && !/[{}<>]/.test(s)) out.push(s);
    }
  }
  return out;
}

function decodeId(id) {
  try {
    const b64 = id.replace(/-/g, '+').replace(/_/g, '/');
    const s = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    return /^\d{6,}$/.test(s) ? s : null;
  } catch {
    return null;
  }
}

function classroomRefs(normalized) {
  const courses = new Set();
  const items = new Map();
  for (const [, course, kind, item] of normalized.matchAll(REF_RE)) {
    courses.add(course);
    if (kind) items.set(`${course}/${kind}/${item}`, { course, kind, item });
  }
  return { courses: [...courses], items: [...items.values()] };
}

/** Distinct attachment-like links by kind, deduped by file or video ID. */
function linkKinds(normalized) {
  const counts = Object.fromEntries([...LINK_KINDS.map(([k]) => [k, 0]), ['otherExternal', 0]]);
  const seen = new Set();
  for (const url of new Set(normalized.match(/https:\/\/[^\s"'<>\\)]+/g) ?? [])) {
    const kind = LINK_KINDS.find(([, re]) => re.test(url))?.[0] ?? (GOOGLE_INFRA.test(url) ? null : 'otherExternal');
    if (!kind) continue;
    const id = url.match(/\/d\/(?:e\/)?([\w-]{10,})|[?&]id=([\w-]+)|[?&]v=([\w-]+)|youtu\.be\/([\w-]+)|forms\.gle\/([\w-]+)/)?.slice(1).find(Boolean);
    const key = `${kind}:${id ?? url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[kind] += 1;
  }
  return counts;
}

/** Epoch timestamps within -30..+90 days of now. Real due dates cluster here; build IDs do not. */
function datesNearNow(normalized) {
  const now = Date.now();
  const near = (ms) => ms > now - 30 * DAY_MS && ms < now + 90 * DAY_MS;
  const seconds = [...normalized.matchAll(/\[(1[6-9]\d{8}),\d{1,9}\]/g)].map((m) => Number(m[1]) * 1000);
  const millis = [...normalized.matchAll(/(?<![\d.])(1[6-9]\d{11})(?![\d.])/g)].map((m) => Number(m[1]));
  return { secondsNanosPairs: seconds.length, msEpochNumbers: millis.length, nearNow: [...seconds, ...millis].filter(near).length };
}

/** Whether a phrase the student typed locally appears, and where. The phrase never leaves the panel and this worker. */
function knownHits(phrase, { visible, embedded, html }) {
  const p = phrase?.trim().toLowerCase();
  if (!p) return undefined;
  return {
    inVisibleText: visible.toLowerCase().includes(p),
    inEmbeddedData: embedded.some((s) => s.toLowerCase().includes(p)),
    inRawHtml: html.toLowerCase().includes(p),
  };
}

/** Marker counts for one Classroom HTML page, plus the raw pieces used for the local preview. */
function analyze(html) {
  const normalized = normalize(html);
  const visible = visibleText(html);
  const embedded = embeddedStrings(html);
  const refs = classroomRefs(normalized);
  const byKind = {};
  for (const { kind } of refs.items) byKind[kind] = (byKind[kind] ?? 0) + 1;
  return {
    refs,
    visible,
    embedded,
    html,
    counts: {
      visibleTextChars: visible.length,
      anchorTags: count(html, /<a\b/gi),
      afInitDataCallback: count(html, /AF_initDataCallback\(/g),
      dsKeys: new Set(html.match(/key:\s*'ds:\d+'/g)).size,
      wizGlobalData: html.includes('WIZ_global_data'),
      courseRefs: refs.courses.length,
      courseRefsDecodable: refs.courses.filter(decodeId).length,
      itemRefsByKind: byKind,
      assignmentRefs: byKind.a ?? 0,
      ...datesNearNow(normalized),
      ymdTriples: count(normalized, /\[20\d\d,(?:1[0-2]|[1-9]),(?:3[01]|[12]\d|[1-9])\]/g),
      dueWordsVisible: count(visible, /\bDue\b/g),
      dueWordsRaw: count(normalized, /\bDue\b/g),
      humanStrings: embedded.length,
      longestHumanStringChars: Math.max(0, ...embedded.map((s) => s.length)),
      humanStringsOver80: embedded.filter((s) => s.length > 80).length,
      links: linkKinds(normalized),
    },
  };
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}...` : s);
const listPreview = (m) =>
  [...m.embedded.slice(0, 8).map((s) => `embedded: ${clip(s, 80)}`), `visible: ${clip(m.visible, 300)}`].join('\n');
const detailPreview = (m) =>
  [...[...m.embedded].sort((a, b) => b.length - a.length).slice(0, 2).map((s) => `embedded: ${clip(s, 400)}`), `visible: ${clip(m.visible, 300)}`].join('\n');

/** Runs one named step and turns exceptions into a FAIL row. */
async function step(results, name, fn) {
  try {
    const row = await fn();
    results.push({ name, ...row });
    return row;
  } catch (error) {
    results.push({ name, result: 'FAIL', evidence: { error: String(error) } });
    return null;
  }
}

/** GET a Classroom page and analyze it. Pauses first so the probe stays gentle. */
async function classroomPage(url, credentials = 'include') {
  await sleep(PAUSE_MS);
  const r = await probeGet(url, { credentials });
  return { r, m: r.text ? analyze(r.text) : null };
}

/** Overview page row: PASS when it holds assignment links and dates near now. */
async function overviewRow(url, { knownTitle, preview }) {
  const { r, m } = await classroomPage(url);
  if (!m) return { row: { result: 'FAIL', evidence: r.evidence }, m };
  const dated = m.counts.nearNow > 0 || m.counts.ymdTriples > 0 || m.counts.dueWordsRaw > 0;
  const ok = r.evidence.landing === 'classroomApp' && m.counts.assignmentRefs > 0 && dated;
  return {
    m,
    row: {
      result: r.evidence.landing !== 'classroomApp' ? 'FAIL' : ok ? 'PASS' : 'INFO',
      evidence: { ...r.evidence, ...m.counts, knownTitle: knownHits(knownTitle, m) },
      localPreview: preview ? listPreview(m) : undefined,
    },
  };
}

/** Classroom REST call with cookies only. Reports the error shape (codes and reason enums), not messages. */
async function apiRow(url) {
  await sleep(PAUSE_MS);
  const r = await probeGet(url, { accept: 'application/json' });
  const err = r.json?.error;
  return {
    result: 'INFO',
    evidence: {
      ...r.evidence,
      cookieAuthWorked: r.evidence.status === 200 && !err,
      errorCode: err?.code,
      errorStatus: err?.status,
      errorReasons: (err?.details ?? []).map((d) => d.reason).filter(Boolean),
      errorDetailTypes: (err?.details ?? []).map((d) => d['@type']?.split('.').pop()).filter(Boolean),
      wwwAuthenticateScheme: r.headers?.get('www-authenticate')?.split(' ')[0] ?? null,
    },
  };
}

/** A stable per-account key from a Classroom page, used only to tell accounts apart. */
function accountIdentity(html) {
  const normalized = normalize(html);
  const ogEmail = normalized.match(/"oPEP7c":"([^"]+@[^"]+)"/)?.[1];
  const emails = (normalized.match(/[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g) ?? []).filter(
    (e) => !/\.(png|jpe?g|gif|svg|webp)$/i.test(e) && !/@(google|gstatic)\.com$/i.test(e),
  );
  const tally = new Map();
  for (const e of emails) tally.set(e.toLowerCase(), (tally.get(e.toLowerCase()) ?? 0) + 1);
  const common = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  const email = ogEmail ?? common;
  if (email) {
    return { key: email.toLowerCase(), source: ogEmail ? 'oPEP7c' : 'mostCommonEmail', kind: /@(gmail|googlemail)\.com$/i.test(email) ? 'consumer' : 'workspace' };
  }
  const gaia = normalized.match(/"S06Grb":"(\d+)"/)?.[1];
  return gaia ? { key: gaia, source: 'S06Grb', kind: 'unknown' } : null;
}

/** Validates a pasted URL: Classroom origin only, so the worker never fetches arbitrary sites. */
function classroomUrl(input) {
  if (!input) return null;
  const url = new URL(input.trim());
  if (url.origin !== CLASSROOM) throw new Error('pasted URL must be on https://classroom.google.com');
  return url;
}

/**
 * Full probe. Options come from the panel:
 * authuser (account index), courseUrl and assignmentUrl (optional pasted fallbacks),
 * knownTitle and knownPhrase (local-only checks), preview (attach localPreview).
 */
export async function runClassroom({ authuser = '0', courseUrl, assignmentUrl, knownTitle, knownPhrase, preview = false } = {}) {
  const results = [];
  const index = /^\d+$/.test(authuser) ? authuser : '0';
  const u = `${CLASSROOM}/u/${index}`;
  const pastedCourse = classroomUrl(courseUrl)?.pathname.match(/\/(?:c|w)\/([\w-]+)/)?.[1] ?? null;
  const pastedAssignment = classroomUrl(assignmentUrl);
  const summary = {};

  // Q1: REST API with cookies only.
  await step(results, 'q1.api.courses', async () => {
    const row = await apiRow(`${API}/courses?pageSize=1&studentId=me`);
    summary.apiCookieAuth = row.evidence.cookieAuthWorked;
    return row;
  });

  // Q2: overview pages, fetched without opening anything in a tab.
  const discovered = { courses: [], assignments: [] };
  await step(results, 'q2.home', async () => {
    const { row, m } = await overviewRow(`${u}/h`, { knownTitle: undefined, preview });
    if (m) discovered.courses = m.refs.courses.filter(decodeId);
    // Home lists classes, not assignments, so PASS here means class links were found.
    return { ...row, result: row.evidence.landing !== 'classroomApp' ? 'FAIL' : discovered.courses.length > 0 ? 'PASS' : 'INFO' };
  });

  const overviews = [
    ['q2.todo.assigned', `${u}/a/not-turned-in/all`],
    ['q2.todo.missing', `${u}/a/missing/all`],
    ['q2.calendar.week', `${u}/calendar/this-week/course/all`],
  ];
  for (const [name, url] of overviews) {
    await step(results, name, async () => {
      const { row, m } = await overviewRow(url, { knownTitle, preview });
      if (m && name === 'q2.todo.assigned') {
        discovered.assignments.push(...m.refs.items.filter((i) => i.kind === 'a'));
        summary.todoHasAssignmentLinks = m.counts.assignmentRefs > 0;
        summary.todoHasDatesNearNow = m.counts.nearNow > 0;
        summary.todoTitleConfirmed = row.evidence.knownTitle ? row.evidence.knownTitle.inRawHtml : null;
      }
      return row;
    });
  }

  const course = pastedCourse ?? discovered.assignments[0]?.course ?? discovered.courses[0] ?? null;
  if (course) {
    await step(results, 'q2.classwork', async () => {
      const { row, m } = await overviewRow(`${u}/w/${course}/t/all`, { knownTitle, preview });
      if (m) discovered.assignments.push(...m.refs.items.filter((i) => i.kind === 'a'));
      summary.classworkHasAssignmentLinks = (m?.counts.assignmentRefs ?? 0) > 0;
      return { ...row, evidence: { ...row.evidence, courseSource: pastedCourse ? 'pasted' : 'discovered' } };
    });
  } else {
    results.push({ name: 'q2.classwork', result: 'SKIP', evidence: { reason: 'no class found; paste a class URL' } });
  }

  // Q3: one assignment detail page the student has not opened in a tab.
  const target = pastedAssignment
    ? { url: pastedAssignment.href, source: 'pasted' }
    : discovered.assignments[0]
      ? { url: `${u}/c/${discovered.assignments[0].course}/a/${discovered.assignments[0].item}/details`, source: 'discovered' }
      : null;
  if (target) {
    await step(results, 'q3.detail', async () => {
      const { r, m } = await classroomPage(target.url);
      if (!m) return { result: 'FAIL', evidence: r.evidence };
      const phrase = knownHits(knownPhrase, m);
      const ok = r.evidence.landing === 'classroomApp' && (phrase ? phrase.inRawHtml : m.counts.longestHumanStringChars > 80);
      summary.detailHasLongText = m.counts.longestHumanStringChars > 80;
      summary.detailPhraseConfirmed = phrase ? phrase.inRawHtml : null;
      summary.detailAttachmentLinks = Object.values(m.counts.links).reduce((a, b) => a + b, 0);
      return {
        result: r.evidence.landing !== 'classroomApp' ? 'FAIL' : ok ? 'PASS' : 'INFO',
        evidence: { ...r.evidence, targetSource: target.source, ...m.counts, knownTitle: knownHits(knownTitle, m), knownPhrase: phrase },
        localPreview: preview ? detailPreview(m) : undefined,
      };
    });
  } else {
    results.push({ name: 'q3.detail', result: 'SKIP', evidence: { reason: 'no assignment found; paste an assignment URL' } });
  }

  const numericCourse = course ? decodeId(course) : null;
  await step(results, 'q1.api.courseWork', async () => {
    const row = await apiRow(`${API}/courses/${numericCourse ?? '0'}/courseWork?pageSize=1`);
    return { ...row, evidence: { ...row.evidence, usedRealCourseId: Boolean(numericCourse) } };
  });

  // Q4: what a signed-out request looks like, the signature for "session expired".
  for (const [name, url] of [['q4.loggedOut.home', `${CLASSROOM}/u/0/h`], ['q4.loggedOut.detail', target?.url]]) {
    if (!url) continue;
    await step(results, name, async () => {
      const { r } = await classroomPage(url, 'omit');
      if (name === 'q4.loggedOut.home') summary.loggedOutLanding = r.evidence.landing ?? 'fetchError';
      return { result: 'INFO', evidence: r.evidence };
    });
  }

  // Q5: several signed-in Google accounts. Labels A, B, ... replace identities; keys stay in this worker.
  const labels = new Map();
  const labelFor = (id) => {
    if (!id) return null;
    if (!labels.has(id.key)) labels.set(id.key, String.fromCharCode(65 + labels.size));
    return labels.get(id.key);
  };
  const byIndex = [];
  await step(results, 'q5.accounts.path', async () => {
    for (let n = 0; n < MAX_ACCOUNTS; n += 1) {
      const { r } = await classroomPage(`${CLASSROOM}/u/${n}/h`);
      const id = r.text ? accountIdentity(r.text) : null;
      const finalIndex = r.evidence.finalPath?.match(/^\/u\/(\d+)\//)?.[1] ?? null;
      const row = { requested: n, status: r.evidence.status, landing: r.evidence.landing, finalIndex, account: labelFor(id), identitySource: id?.source ?? null, accountKind: id?.kind ?? null, ms: r.evidence.ms };
      byIndex.push(row);
      if (r.evidence.landing !== 'classroomApp' || finalIndex !== String(n)) break;
    }
    const valid = byIndex.filter((row) => row.landing === 'classroomApp' && row.finalIndex === String(row.requested));
    summary.signedInAccounts = valid.length;
    summary.pathSelectsDistinctAccounts = valid.length < 2 ? null : new Set(valid.map((row) => row.account)).size === valid.length;
    return { result: 'INFO', evidence: { rows: byIndex, validIndexes: valid.length, distinctAccounts: new Set(valid.map((row) => row.account).filter(Boolean)).size } };
  });

  await step(results, 'q5.accounts.authuserParam', async () => {
    const rows = [];
    for (const { requested, account, landing: pathLanding, finalIndex } of byIndex) {
      if (pathLanding !== 'classroomApp' || finalIndex !== String(requested)) continue;
      const { r } = await classroomPage(`${CLASSROOM}/h?authuser=${requested}`);
      const label = r.text ? labelFor(accountIdentity(r.text)) : null;
      rows.push({ authuser: requested, status: r.evidence.status, landing: r.evidence.landing, finalPath: r.evidence.finalPath, account: label, matchesPath: account !== null && label === account });
    }
    summary.authuserParamMatchesPath = rows.length ? rows.every((row) => row.matchesPath) : null;
    return { result: 'INFO', evidence: { rows } };
  });

  results.push({ name: 'summary', result: 'INFO', evidence: summary });
  return results;
}
