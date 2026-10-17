// Read-only probe functions. They run in the service worker, which is the
// transport the real product would use for background collection.
// Every result is evidence (status, counts, timings, hashes), never page content,
// except the `localPreview` field, which the panel shows but never copies.

const CANVAS_JSON_PREFIX = 'while(1);';
const DAY_MS = 86_400_000;

/** GET a URL with the browser session and summarize the response without its body. */
async function probeGet(url, { credentials = 'include', accept = 'application/json' } = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { credentials, headers: { Accept: accept }, redirect: 'follow' });
  const text = await res.text();
  const final = new URL(res.url);
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0];
  const hadJsonPrefix = text.startsWith(CANVAS_JSON_PREFIX);
  const body = hadJsonPrefix ? text.slice(CANVAS_JSON_PREFIX.length) : text;
  let json = null;
  if (contentType.includes('json')) {
    try { json = JSON.parse(body); } catch { /* reported via jsonParsed */ }
  }
  const looksLikeLogin =
    contentType.includes('html') &&
    (/login|saml|sso|signin|ServiceLogin|accounts\.google\.com/i.test(final.host + final.pathname) ||/<input[^>]+type=["']?password/i.test(text));
  return {
    evidence: {
      status: res.status,
      redirected: res.redirected,
      finalHost: final.host,
      finalPath: final.pathname,
      contentType,
      ms: Math.round(performance.now() - t0),
      hadJsonPrefix,
      jsonParsed: json !== null,
      looksLikeLogin,
      bytes: text.length,
    },
    json,
    text: body,
    link: res.headers.get('link'),
  };
}

function nextLink(linkHeader) {
  return linkHeader?.split(',').find((part) => part.includes('rel="next"'))?.match(/<([^>]+)>/)?.[1] ?? null;
}

function stripHtml(html) {
  return (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function sha256Short(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key] ?? 'none'] = (counts[item[key] ?? 'none'] ?? 0) + 1;
  return counts;
}

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

/** Canvas: auth, logged-out signature, courses, planner overview, unopened assignment detail, syllabus. */
export async function runCanvas(originInput) {
  const origin = new URL(originInput).origin;
  if (!origin.startsWith('https://')) throw new Error('Canvas origin must be https');
  const results = [];
  const api = (path) => `${origin}/api/v1${path}`;

  await step(results, 'canvas.auth.session', async () => {
    const r = await probeGet(api('/users/self'));
    return { result: r.json?.id ? 'PASS' : 'FAIL', evidence: { ...r.evidence, hasUserId: Boolean(r.json?.id) } };
  });

  await step(results, 'canvas.auth.loggedOutSignature', async () => {
    const r = await probeGet(api('/users/self'), { credentials: 'omit' });
    return { result: 'INFO', evidence: r.evidence };
  });

  await step(results, 'canvas.courses.active', async () => {
    const r = await probeGet(api('/courses?enrollment_state=active&per_page=100'));
    const ok = Array.isArray(r.json);
    return {
      result: ok ? 'PASS' : 'FAIL',
      evidence: { ...r.evidence, courseCount: ok ? r.json.length : null, hasNextPage: Boolean(nextLink(r.link)) },
    };
  });

  const now = Date.now();
  const start = new Date(now - 7 * DAY_MS).toISOString();
  const end = new Date(now + 14 * DAY_MS).toISOString();
  const plannerItems = [];
  await step(results, 'canvas.planner.items', async () => {
    let url = api(`/planner/items?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&per_page=50`);
    let pages = 0;
    let last = null;
    while (url && pages < 10) {
      last = await probeGet(url);
      if (!Array.isArray(last.json)) break;
      plannerItems.push(...last.json);
      pages += 1;
      url = nextLink(last.link);
    }
    return {
      result: pages > 0 ? 'PASS' : 'FAIL',
      evidence: {
        ...last?.evidence,
        pages,
        stoppedWithMorePages: Boolean(url),
        itemCount: plannerItems.length,
        byType: countBy(plannerItems, 'plannable_type'),
        distinctCourses: new Set(plannerItems.map((i) => i.course_id).filter(Boolean)).size,
        withPlannableDate: plannerItems.filter((i) => i.plannable_date).length,
        submissionKeys: [...new Set(plannerItems.flatMap((i) => (i.submissions ? Object.keys(i.submissions) : [])))],
      },
    };
  });

  const target = plannerItems.find((i) => i.plannable_type === 'assignment' && i.course_id && i.plannable_id);
  if (!target) {
    results.push({ name: 'canvas.assignment.detail', result: 'SKIP', evidence: { reason: 'no assignment in planner window' } });
    return results;
  }

  await step(results, 'canvas.assignment.detail', async () => {
    const r = await probeGet(api(`/courses/${target.course_id}/assignments/${target.plannable_id}`));
    const a = r.json ?? {};
    const html = a.description ?? '';
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]);
    return {
      result: r.json?.id ? 'PASS' : 'FAIL',
      evidence: {
        ...r.evidence,
        descriptionChars: stripHtml(html).length,
        linkCount: hrefs.length,
        googleDocLinks: hrefs.filter((h) => /docs\.google\.com\/document/.test(h)).length,
        canvasFileLinks: hrefs.filter((h) => /\/files\/\d+/.test(h)).length,
        hasRubric: Array.isArray(a.rubric),
        rubricCriteria: Array.isArray(a.rubric) ? a.rubric.length : 0,
        hasDueAt: Boolean(a.due_at),
        hasPointsPossible: a.points_possible != null,
        submissionTypes: a.submission_types ?? [],
        dueInDays: a.due_at ? Math.round((Date.parse(a.due_at) - now) / DAY_MS) : null,
      },
    };
  });

  await step(results, 'canvas.course.assignments.paged', async () => {
    const r = await probeGet(api(`/courses/${target.course_id}/assignments?per_page=50&order_by=due_at`));
    const ok = Array.isArray(r.json);
    return {
      result: ok ? 'PASS' : 'FAIL',
      evidence: {
        ...r.evidence,
        firstPageCount: ok ? r.json.length : null,
        hasNextPage: Boolean(nextLink(r.link)),
        undatedOnFirstPage: ok ? r.json.filter((a) => !a.due_at).length : null,
      },
    };
  });

  await step(results, 'canvas.course.syllabus', async () => {
    const r = await probeGet(api(`/courses/${target.course_id}?include[]=syllabus_body`));
    const text = stripHtml(r.json?.syllabus_body);
    return {
      result: r.json?.id ? 'PASS' : 'FAIL',
      evidence: {
        ...r.evidence,
        syllabusChars: text.length,
        aiMentions: (text.match(/\b(AI|A\.I\.|artificial intelligence|ChatGPT|generative)\b/gi) ?? []).length,
      },
    };
  });

  return results;
}

/** Docs: read the owned demo doc through its export URL in several formats. */
export async function runDocs(docId, authuser) {
  const results = [];
  for (const format of ['txt', 'md']) {
    await step(results, `docs.export.${format}`, async () => {
      const r = await readDoc(docId, authuser, format);
      return { result: r.ok ? 'PASS' : 'FAIL', evidence: r.evidence, localPreview: r.ok ? r.text.slice(0, 400) : undefined };
    });
  }
  return results;
}

/** One export read, used both by runDocs and by the edit watch. */
export async function readDoc(docId, authuser, format = 'txt') {
  const params = new URLSearchParams({ format });
  if (authuser) params.set('authuser', authuser);
  const r = await probeGet(`https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?${params}`, { accept: '*/*' });
  const ok = r.evidence.status === 200 && !r.evidence.looksLikeLogin && !r.evidence.contentType.includes('html');
  return {
    ok,
    text: r.text,
    evidence: {
      ...r.evidence,
      chars: r.text.length,
      words: r.text.split(/\s+/).filter(Boolean).length,
      hash: await sha256Short(r.text),
    },
  };
}
