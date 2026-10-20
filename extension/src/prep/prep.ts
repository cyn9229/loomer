// Test prep: setting up a test's topics, adding photos of notes, practice runs
// (start, answer, "Try one like it", end), and the views the UI reads. AI calls
// go through the local service; multiple choice, flashcards, and math are
// checked here, written answers by the AI with quotes from the student's text.
import {
  brokerEnvelopeSchema,
  PRACTICE_GRADE_ROUTE,
  PRACTICE_ROUTE,
  practiceGradeResponseSchema,
  practiceResponseSchema,
  PREP_FORMATS,
  PREP_TOPICS_ROUTE,
  prepTopicsResponseSchema,
  type PracticeGradeRequest,
  type PracticeRequest,
  type PrepTopicsRequest,
} from '../../../shared/ai-contract';
import { instructionText, type Assignment, type LoomerDb, type PracticeQuestionRecord, type PracticeRecord, type PrepRecord } from '../core/db';
import { checkAiDispatch } from '../core/gate';
import type { AiSettings } from '../core/settings';
import type { Practice, PracticeAnswer, PracticeSummary, PrepDayKind, PrepFormat, PrepStep, TestPrep } from '../model/prep';
import { assignmentPolicy, courseKey, effectiveDue, isOpen, policyAnswer } from '../analysis/facts';
import { assignmentNoun } from '../analysis/insight';
import { dayWords, localDay } from '../analysis/plan';
import { topicKey } from '../analysis/topicStanding';
import { isQuiz, storedWorkType } from '../analysis/workType';
import { activeTopics, answerRight, comebacks, counts, DAY_MINUTES, topicCount, matchTopic, mistakes, names, planDays, practiceFor, readiness, topicStandings, weakest } from './plan';

const PREP_HORIZON_DAYS = 14;
const SOURCE_CHARS = 15_000;
const SETUP_RETRY_MS = 60 * 60 * 1000;

export type PrepDeps = { db: LoomerDb; ai: () => Promise<AiSettings>; fetch?: typeof fetch; now?: () => Date };

/** A test or quiz due in the next two weeks: Canvas quizzes, online tests, and study work. */
export async function prepEligible(db: LoomerDb, a: Assignment, now: Date): Promise<boolean> {
  const due = effectiveDue(a, now).at;
  if (!isOpen(a) || !due || Date.parse(due) < now.getTime() || Date.parse(due) > now.getTime() + PREP_HORIZON_DAYS * 86_400_000) return false;
  return isQuiz(a) || (await storedWorkType(db, a)) === 'study';
}

/**
 * AI may help prepare: AI is on, the teacher's rule allows AI on this class's
 * text, and no quiz or test session is open (Ask Loomer pauses then too).
 */
export async function prepAllowed(db: LoomerDb, settings: AiSettings, a: Assignment): Promise<boolean> {
  const active = await db.sessions.where('state').equals('active').first();
  const activeA = active && (await db.assignments.get(active.assignmentId));
  if (activeA && isQuiz(activeA)) return false;
  const context = new Map((await db.studentContext.bulkGet([a.id, courseKey(a)])).filter((c) => c !== undefined).map((c) => [c.key, c]));
  const policy = assignmentPolicy(a, await db.courses.get(courseKey(a)));
  return checkAiDispatch({ aiEnabled: settings.enabled, policy, answer: policyAnswer(a, context), purpose: 'requirements-analysis' }).allowed;
}

async function post<T>(settings: AiSettings, route: string, body: unknown, parse: (v: unknown) => { success: true; data: T } | { success: false }, fetchImpl: typeof fetch): Promise<T | string> {
  try {
    const res = await fetchImpl(`${settings.brokerOrigin}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-loomer-client': 'extension' }, body: JSON.stringify(body) });
    const envelope = brokerEnvelopeSchema.safeParse(await res.json().catch(() => null));
    if (!envelope.success) return `AI service status ${res.status}`;
    if (!envelope.data.ok) return envelope.data.error;
    const parsed = parse(envelope.data.result);
    return parsed.success ? parsed.data : 'provider returned an invalid shape';
  } catch (error) {
    return `AI service unreachable: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

const sourceOf = (a: Assignment) => instructionText(a.detail).slice(0, SOURCE_CHARS);
const newId = () => crypto.randomUUID().slice(0, 8);

/** Finds a test's topics, key terms, and formats from its instructions and study guide. Runs once per test, with a retry after an hour on failure. */
export async function setupPrep({ db, ai, fetch: fetchImpl = fetch, now = () => new Date() }: PrepDeps, a: Assignment): Promise<void> {
  const existing = await db.preps.get(a.id);
  if (existing && (existing.status !== 'failed' || now().getTime() - Date.parse(existing.startDay) < SETUP_RETRY_MS)) return;
  const settings = await ai();
  if (!(await prepAllowed(db, settings, a))) return;
  const record: PrepRecord = existing ?? { assignmentId: a.id, startDay: localDay(now()), status: 'setup', topics: [], terms: [], formats: { selected: [], found: {}, asked: false }, notes: { photos: 0, found: null } };
  await db.preps.put({ ...record, status: 'setup' });
  const request: PrepTopicsRequest = { title: a.title.slice(0, 300), instructions: instructionText(a.detail).slice(0, 20_000), existing: [], images: [] };
  const reply = await post(settings, PREP_TOPICS_ROUTE, request, (v) => prepTopicsResponseSchema.safeParse(v), fetchImpl);
  if (typeof reply === 'string') {
    console.warn('loomer: prep setup failed:', reply);
    await db.preps.put({ ...record, status: 'failed', error: "Loomer couldn't read this test's topics yet, so add your notes or a topic to start." });
    return;
  }
  // A topic from the text must quote it, so Loomer never invents what the test covers.
  const text = request.instructions.toLowerCase().replace(/\s+/g, ' ');
  const topics = reply.topics.filter((t) => t.text.trim() && (!t.quote.trim() || text.includes(t.quote.toLowerCase().replace(/\s+/g, ' ').trim())));
  const found: PrepRecord['formats']['found'] = Object.fromEntries(PREP_FORMATS.filter((f) => reply.formats[f]).map((f) => [f, isQuiz(a) && f === 'mcq' ? 'canvas' : 'guide']));
  await db.preps.put({
    ...record,
    status: 'ready',
    error: undefined,
    topics: topics.slice(0, 12).map((t) => ({ id: newId(), text: t.text.trim().slice(0, 120), source: 'guide', new: false, removed: false })),
    terms: reply.terms.slice(0, 40).map((t) => ({ term: t.term.slice(0, 120), definition: t.definition.slice(0, 300) })),
    formats: { selected: Object.keys(found).length ? (Object.keys(found) as PrepFormat[]) : ['mcq'], found, asked: false },
  });
}

/** Photos of the student's paper notes: new topics (marked new until kept) and key terms. The photos are sent once and not kept. */
export async function addNotes({ db, ai, fetch: fetchImpl = fetch }: PrepDeps, assignmentId: string, images: string[]): Promise<string | null> {
  const [a, prep] = await Promise.all([db.assignments.get(assignmentId), db.preps.get(assignmentId)]);
  if (!a || !prep) return "Loomer hasn't set up this test yet.";
  const settings = await ai();
  if (!(await prepAllowed(db, settings, a))) return "AI help is off for this test, so Loomer can't read your notes.";
  const request: PrepTopicsRequest = { title: a.title.slice(0, 300), instructions: '', existing: activeTopics(prep).map((t) => t.text.slice(0, 160)), images: images.slice(0, 6) };
  const reply = await post(settings, PREP_TOPICS_ROUTE, request, (v) => prepTopicsResponseSchema.safeParse(v), fetchImpl);
  if (typeof reply === 'string') {
    console.warn('loomer: notes failed:', reply);
    return "Loomer couldn't read those photos, so try clearer ones.";
  }
  const known = new Set(prep.topics.map((t) => topicKey(t.text)));
  const added = reply.topics.filter((t) => t.text.trim() && !known.has(topicKey(t.text))).slice(0, 8);
  const knownTerms = new Set(prep.terms.map((t) => t.term.toLowerCase()));
  const terms = reply.terms.filter((t) => !knownTerms.has(t.term.toLowerCase())).slice(0, 25);
  const found = { ...prep.formats.found };
  for (const f of PREP_FORMATS) if (reply.formats[f] && !found[f]) found[f] = 'notes';
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  await db.preps.put({
    ...prep,
    status: 'ready',
    topics: [...prep.topics, ...added.map((t) => ({ id: newId(), text: t.text.trim().slice(0, 120), source: 'notes' as const, new: true, removed: false }))],
    terms: [...prep.terms, ...terms.map((t) => ({ term: t.term.slice(0, 120), definition: t.definition.slice(0, 300) }))],
    formats: { ...prep.formats, found },
    notes: {
      photos: prep.notes.photos + images.length,
      found: added.length || terms.length ? `From your notes, Loomer found ${plural(added.length, 'more topic')} and ${plural(terms.length, 'key term')}.` : 'Loomer read your notes and found nothing new beyond the study guide.',
    },
  });
  return null;
}

/** Remove, add, or keep (a topic found in notes) topics. */
export async function editTopics(db: LoomerDb, assignmentId: string, edit: { remove?: string[]; add?: string[]; keep?: string[] }) {
  const prep = await db.preps.get(assignmentId);
  if (!prep) return;
  const topics = prep.topics.map((t) => ({ ...t, removed: t.removed || (edit.remove ?? []).includes(t.id), new: t.new && !(edit.keep ?? []).includes(t.id) }));
  for (const text of edit.add ?? []) if (text.trim()) topics.push({ id: newId(), text: text.trim().slice(0, 120), source: 'student', new: false, removed: false });
  await db.preps.put({ ...prep, status: activeTopicsOf(topics).length ? 'ready' : prep.status, topics });
}
const activeTopicsOf = (topics: PrepRecord['topics']) => topics.filter((t) => !t.removed);

export async function setFormats(db: LoomerDb, assignmentId: string, formats: PrepFormat[]) {
  const prep = await db.preps.get(assignmentId);
  if (prep) await db.preps.put({ ...prep, formats: { ...prep.formats, selected: formats.length ? formats : ['mcq'], asked: true } });
}

/** Today's day kind for a test, or null when today's practice is done or the plan has no day today. */
export async function todayKind(db: LoomerDb, prep: PrepRecord, testAt: string, now: Date): Promise<PrepDayKind | 'comeback' | null> {
  const [checks, practices] = await Promise.all([db.topicChecks.where('assignmentId').equals(prep.assignmentId).toArray(), db.practices.where('assignmentId').equals(prep.assignmentId).toArray()]);
  const topics = topicStandings(prep, checks);
  const day = planDays(prep, testAt, topics, practices, checks, now).find((d) => d.status === 'today');
  if (!day) return null;
  if (day.kind === 'focus' && !topics.some((t) => t.standing !== 'solid') && comebacks(topics, checks, now).length) return 'comeback';
  return day.kind;
}

/** Writes a practice's questions. Called ahead of time for today, and on prep:start when none is ready. */
export async function writePractice(deps: PrepDeps, assignmentId: string, kind: PrepDayKind | 'comeback'): Promise<string | null> {
  const { db, ai, fetch: fetchImpl = fetch, now = () => new Date() } = deps;
  const [a, prep] = await Promise.all([db.assignments.get(assignmentId), db.preps.get(assignmentId)]);
  if (!a || prep?.status !== 'ready' || activeTopics(prep).length === 0) return null;
  const settings = await ai();
  if (!(await prepAllowed(db, settings, a))) return null;
  const checks = await db.topicChecks.where('assignmentId').equals(assignmentId).toArray();
  const topics = topicStandings(prep, checks);
  const plan = practiceFor(kind, prep, topics, checks, now());
  const id = crypto.randomUUID();
  const record: PracticeRecord = { id, assignmentId, dayKind: kind, day: localDay(now()), createdAt: now().toISOString(), startedAt: null, endedAt: null, closed: false, writing: true, error: null, index: 0, questions: [], answers: {} };
  await db.practices.put(record);
  const asked = (await db.practices.where('assignmentId').equals(assignmentId).toArray()).flatMap((p) => p.questions.map((q) => q.prompt.slice(0, 400)));
  const request: PracticeRequest = {
    title: a.title.slice(0, 300),
    source: sourceOf(a),
    topics: plan.topics.map((t) => t.text.slice(0, 160)),
    terms: prep.terms.slice(0, 40).map((t) => ({ term: t.term.slice(0, 160), definition: t.definition.slice(0, 400) })),
    kinds: plan.kinds,
    like: null,
    avoid: asked.slice(-60),
  };
  const reply = await post(settings, PRACTICE_ROUTE, request, (v) => practiceResponseSchema.safeParse(v), fetchImpl);
  if (typeof reply === 'string') {
    console.warn('loomer: practice failed:', reply);
    await db.practices.update(id, { writing: false, error: "Loomer couldn't write practice questions right now, so try again in a bit." });
    return id;
  }
  await db.practices.update(id, { writing: false, questions: reply.questions.flatMap((q) => questionFrom(q, activeTopics(prep), false)) });
  return id;
}

/** A usable question from the AI's reply, or none (a multiple choice with a bad answer index, an empty prompt). */
function questionFrom(q: (typeof practiceResponseSchema)['_zod']['output']['questions'][number], topics: PrepRecord['topics'], like: boolean): PracticeQuestionRecord[] {
  if (!q.prompt.trim() && q.kind !== 'vocab') return [];
  if (q.kind === 'mcq' && (q.options.length < 2 || q.answerIndex < 0 || q.answerIndex >= q.options.length)) return [];
  if (q.kind === 'vocab' && (!q.term.trim() || !q.definition.trim())) return [];
  if ((q.kind === 'short' || q.kind === 'frq' || q.kind === 'explain') && q.needs.length === 0) return [];
  const topic = matchTopic(q.topic, topics);
  // Models tend to put the right answer first, so the options are shuffled here.
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
  const options = q.kind === 'mcq' ? order.map((i) => q.options[i]!) : q.options;
  const answerIndex = q.kind === 'mcq' ? order.indexOf(q.answerIndex) : q.answerIndex;
  return [{ id: newId(), topicId: topic.id, topic: topic.text, kind: q.kind, label: q.label.slice(0, 80), prompt: q.prompt, options, answerIndex, why: q.why, term: q.term, definition: q.definition, answer: q.answer, worked: q.worked, needs: q.needs.slice(0, 8), like }];
}

/** Starts today's practice: the one written ahead if it is still today's, or a new one. */
export async function startPractice(deps: PrepDeps, assignmentId: string): Promise<string | null> {
  const { db, now = () => new Date() } = deps;
  const prep = await db.preps.get(assignmentId);
  const a = await db.assignments.get(assignmentId);
  const testAt = a && effectiveDue(a, now()).at;
  if (!prep || !testAt) return "Loomer hasn't set up this test yet.";
  const kind = (await todayKind(db, prep, testAt, now())) ?? 'comeback';
  const ready = (await db.practices.where('assignmentId').equals(assignmentId).toArray()).find((p) => !p.startedAt && p.day === localDay(now()) && p.dayKind === kind && !p.error);
  const id = ready?.id ?? (await writePractice(deps, assignmentId, kind));
  if (!id) return "AI help is off for this test, so Loomer can't write practice.";
  // Only one practice is open at a time.
  await db.practices.filter((p) => !!p.startedAt && !p.closed && p.id !== id).modify({ closed: true });
  await db.practices.update(id, { startedAt: now().toISOString() });
  return null;
}

const normalizeAnswer = (t: string) => t.toLowerCase().replace(/[$\s]/g, '').replace(/,(?=\d{3})/g, '');
/** A math answer is right when it matches as text, or as a number within rounding. */
export function mathRight(given: string, expected: string): boolean {
  const g = normalizeAnswer(given);
  const e = normalizeAnswer(expected);
  if (!g) return false;
  if (g === e) return true;
  const gn = Number(g);
  const en = Number(e);
  return Number.isFinite(gn) && Number.isFinite(en) && Math.abs(gn - en) <= Math.max(1e-6, Math.abs(en) * 1e-3);
}

/** Records the student's answer. Multiple choice, flashcards, and math are checked here at once; written answers by the AI. */
export async function answerPractice(deps: PrepDeps, practiceId: string, questionId: string, input: { choice?: number; text?: string; knew?: boolean }): Promise<void> {
  const { db, ai, fetch: fetchImpl = fetch, now = () => new Date() } = deps;
  const p = await db.practices.get(practiceId);
  const q = p?.questions.find((x) => x.id === questionId);
  if (!p || !q || p.answers[questionId] || p.endedAt) return;
  const save = async (answer: PracticeAnswer) => {
    const fresh = (await db.practices.get(practiceId))!;
    await db.practices.update(practiceId, { answers: { ...fresh.answers, [questionId]: answer } });
    const right = answerRight(answer);
    if (right !== null) {
      await db.topicChecks.add({ assignmentId: p.assignmentId, topic: topicKey(q.topic), quizId: practiceId, question: fresh.questions.indexOf(q), correct: right, at: now().toISOString() });
    }
  };
  switch (q.kind) {
    case 'mcq': {
      const picked = input.choice ?? -1;
      return save({ kind: 'mcq', picked, correct: q.answerIndex, right: picked === q.answerIndex, why: q.why });
    }
    case 'vocab':
      return save({ kind: 'vocab', knew: input.knew === true });
    case 'math': {
      const right = mathRight(input.text ?? '', q.answer);
      return save({ kind: 'math', right, answer: q.answer, why: q.why, worked: right ? null : q.worked });
    }
    case 'short':
    case 'explain':
    case 'frq': {
      const text = (input.text ?? '').trim().slice(0, 8_000);
      const pending: PracticeAnswer = q.kind === 'frq' ? { kind: 'frq', status: 'pending', needs: [] } : { kind: q.kind, status: 'pending', met: [], missing: [] };
      await db.practices.update(practiceId, { answers: { ...p.answers, [questionId]: pending } });
      const request: PracticeGradeRequest = { kind: q.kind, topic: q.topic.slice(0, 160), prompt: q.prompt.slice(0, 2_000), needs: q.needs.map((n) => n.slice(0, 300)), answer: text };
      const reply = text ? await post(await ai(), PRACTICE_GRADE_ROUTE, request, (v) => practiceGradeResponseSchema.safeParse(v), fetchImpl) : { needs: q.needs.map((need) => ({ need, met: false, quote: '', hint: 'Write a few words first.' })) };
      const graded = typeof reply === 'string' ? q.needs.map((need) => ({ need, met: false, quote: '', hint: "Loomer couldn't check this one right now." })) : reply.needs;
      // A "met" must quote the student's own words; otherwise it shows without a quote.
      const said = text.toLowerCase().replace(/\s+/g, ' ');
      const checked = graded.map((n) => ({ ...n, quote: n.met && n.quote.trim() && said.includes(n.quote.toLowerCase().replace(/\s+/g, ' ').trim()) ? n.quote.trim() : '' }));
      // Drop the pending answer first, so save() writes the graded one.
      const fresh = (await db.practices.get(practiceId))!;
      const { [questionId]: _, ...rest } = fresh.answers;
      await db.practices.update(practiceId, { answers: rest });
      return save(
        q.kind === 'frq'
          ? { kind: 'frq', status: 'ready', needs: checked.map((n) => ({ need: n.need, met: n.met, note: n.met ? n.quote : n.hint })) }
          : { kind: q.kind, status: 'ready', met: checked.filter((n) => n.met).map((n) => ({ need: n.need, quote: n.quote })), missing: checked.filter((n) => !n.met).map((n) => ({ need: n.need, hint: n.hint })) },
      );
    }
  }
}

/** "Try one like it": a new question on the same idea, shown next. */
export async function practiceLike(deps: PrepDeps, practiceId: string, questionId: string): Promise<void> {
  const { db, ai, fetch: fetchImpl = fetch } = deps;
  const p = await db.practices.get(practiceId);
  const q = p?.questions.find((x) => x.id === questionId);
  const [a, prep] = p ? await Promise.all([db.assignments.get(p.assignmentId), db.preps.get(p.assignmentId)]) : [];
  if (!p || !q || !a || !prep || p.writing) return;
  const settings = await ai();
  if (!(await prepAllowed(db, settings, a))) return;
  await db.practices.update(practiceId, { writing: true, index: p.questions.indexOf(q) + 1 });
  const request: PracticeRequest = {
    title: a.title.slice(0, 300),
    source: sourceOf(a),
    topics: [q.topic.slice(0, 160)],
    terms: prep.terms.slice(0, 40).map((t) => ({ term: t.term.slice(0, 160), definition: t.definition.slice(0, 400) })),
    kinds: [{ kind: q.kind, count: 1 }],
    like: { topic: q.topic.slice(0, 160), kind: q.kind, prompt: (q.prompt || q.term).slice(0, 2_000) },
    avoid: p.questions.map((x) => x.prompt.slice(0, 400)).slice(-60),
  };
  const reply = await post(settings, PRACTICE_ROUTE, request, (v) => practiceResponseSchema.safeParse(v), fetchImpl);
  const fresh = (await db.practices.get(practiceId))!;
  const like = typeof reply === 'string' ? [] : reply.questions.flatMap((x) => questionFrom(x, activeTopics(prep), true)).slice(0, 1);
  const at = fresh.questions.indexOf(fresh.questions.find((x) => x.id === questionId)!) + 1;
  await db.practices.update(practiceId, {
    writing: false,
    questions: [...fresh.questions.slice(0, at), ...like, ...fresh.questions.slice(at)],
    // Nothing came back: stay on the next question as written.
    index: at,
    error: like.length ? null : fresh.error,
  });
}

export async function nextQuestion(db: LoomerDb, practiceId: string, now: Date): Promise<void> {
  const p = await db.practices.get(practiceId);
  if (!p) return;
  if (p.index + 1 >= p.questions.length) await endPractice(db, practiceId, now);
  else await db.practices.update(practiceId, { index: p.index + 1 });
}

/** Ends a practice and posts its result as one line in the test's chat. */
export async function endPractice(db: LoomerDb, practiceId: string, now: Date): Promise<void> {
  const p = await db.practices.get(practiceId);
  if (!p || p.endedAt) return;
  await db.practices.update(practiceId, { endedAt: now.toISOString() });
  const summary = await summaryOf(db, (await db.practices.get(practiceId))!, now);
  if (!summary) return;
  await db.chatTurns.add({ threadKey: p.assignmentId, role: 'loomer', blocks: [{ kind: 'practice-result', practiceId, line: summary.line, detail: summary.detail, mistakes: summary.mistakes }], status: 'done', createdAt: now.toISOString() });
}

/** What the practice did and where its topics stand now. */
async function summaryOf(db: LoomerDb, p: PracticeRecord, now: Date): Promise<PracticeSummary | null> {
  const [a, prep, checks] = await Promise.all([db.assignments.get(p.assignmentId), db.preps.get(p.assignmentId), db.topicChecks.where('assignmentId').equals(p.assignmentId).toArray()]);
  if (!a || !prep) return null;
  const answered = p.questions.filter((q) => p.answers[q.id]);
  const ids = new Set(answered.map((q) => q.topicId));
  const topics = topicStandings(prep, checks).filter((t) => ids.has(t.id));
  const wrong = answered.filter((q) => answerRight(p.answers[q.id]!) === false).length;
  const noun = assignmentNoun(a);
  const due = effectiveDue(a, now).at;
  const line =
    answered.length === 0 ? `You stopped before answering, and ${noun} is still on your plan.`
    : p.dayKind === 'check-all' ? `You checked ${topicCount(topics.length)} on ${noun}.`
    : p.dayKind === 'practice-test' ? `You finished a practice test with ${answered.length} questions.`
    : p.dayKind === 'warm-up' ? `You warmed up on ${names(topics)}.`
    : `You did ${DAY_MINUTES[p.dayKind]} minutes on ${names(topics)}.`;
  const solid = topics.filter((t) => t.standing === 'solid');
  const weak = topics.filter((t) => t.standing !== 'solid');
  const before = due ? ` before ${dayWords(due, now)}` : '';
  const detail =
    topics.length === 0 ? 'Start again whenever you are ready.'
    : weak.length === 0 ? `${names(solid)} ${solid.length === 1 ? 'is' : 'are'} solid now.`
    : solid.length === 0 ? `${names(weak)} still ${weak.length === 1 ? 'needs' : 'need'} one more round${before}.`
    : `${names(solid)} ${solid.length === 1 ? 'is' : 'are'} solid now, and ${names(weak)} still ${weak.length === 1 ? 'needs' : 'need'} one more round${before}.`;
  return { line, detail, topics: topics.map((t) => ({ text: t.text, standing: t.standing, lastCheck: t.lastCheck })), mistakes: wrong };
}

/** The test page's prep view. Null for work that isn't a test, or before setup starts. */
export async function loadPrep(db: LoomerDb, a: Assignment, now: Date): Promise<TestPrep | null> {
  const prep = await db.preps.get(a.id);
  const testAt = effectiveDue(a, now).at;
  if (!prep || !testAt) return null;
  const [checks, practices] = await Promise.all([db.topicChecks.where('assignmentId').equals(a.id).toArray(), db.practices.where('assignmentId').equals(a.id).toArray()]);
  const topics = topicStandings(prep, checks);
  return {
    assignmentId: a.id,
    testAt,
    status: prep.status === 'ready' ? 'ready' : 'setup',
    error: prep.status === 'failed' ? (prep.error ?? null) : null,
    readiness: readiness(topics, checks),
    counts: counts(topics),
    topics,
    formats: prep.formats,
    plan: prep.status === 'ready' ? planDays(prep, testAt, topics, practices, checks, now) : [],
    mistakes: mistakes(practices),
    notes: prep.notes,
  };
}

/** Home's step for a test with prep, from today's plan day. Null when today's practice is done. */
export function prepStep(prep: PrepRecord, a: Assignment, checks: Parameters<typeof topicStandings>[1], practices: PracticeRecord[], now: Date): { step: PrepStep; action: string; insight: string } | null {
  const testAt = effectiveDue(a, now).at;
  if (prep.status !== 'ready' || !testAt) return null;
  const topics = topicStandings(prep, checks);
  if (topics.length === 0) return null;
  const day = planDays(prep, testAt, topics, practices, checks, now).find((d) => d.status === 'today');
  if (!day) return null;
  const back = comebacks(topics, checks, now);
  const kind = day.kind === 'focus' && !topics.some((t) => t.standing !== 'solid') && back.length ? 'comeback' : day.kind;
  const noun = assignmentNoun(a);
  const when = dayWords(testAt, now);
  const weak = weakest(topics, checks, 2);
  const insight =
    kind === 'check-all' ? `Loomer found ${topicCount(topics.length)} for ${noun}, so today starts with a quick check on each.`
    : kind === 'practice-test' ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} is ${when}, so today is a practice test in its formats.`
    : kind === 'warm-up' ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} is ${when}, so a short warm-up on ${names(weak)} is the last step.`
    : kind === 'comeback' ? `${names(back.slice(0, 2))} ${back.length === 1 ? 'was' : 'were'} solid a few days ago, so a quick check today helps ${back.length === 1 ? 'it' : 'them'} stick.`
    : `${names(weak)} ${weak.length === 1 ? 'is' : 'are'} the shakiest, so today is 10 minutes on ${weak.length === 1 ? 'it' : 'them'} before ${when}.`;
  return { step: { assignmentId: a.id, kind, minutes: DAY_MINUTES[kind], counts: counts(topics), readiness: readiness(topics, checks) }, action: kind === 'comeback' ? `Quick check: ${names(back.slice(0, 2))}, so ${back.length === 1 ? 'it sticks' : 'they stick'}` : day.step, insight };
}

/** The practice in progress, or just finished and not yet closed. */
export async function loadPracticeModel(db: LoomerDb, now: Date): Promise<Practice | null> {
  const open = (await db.practices.filter((p) => !!p.startedAt && !p.closed).toArray()).sort((x, y) => (y.startedAt ?? '').localeCompare(x.startedAt ?? ''))[0];
  if (!open) return null;
  const a = await db.assignments.get(open.assignmentId);
  const q = open.writing ? undefined : open.questions[open.index];
  return {
    id: open.id,
    assignmentId: open.assignmentId,
    title: a?.title ?? 'This test',
    index: open.index,
    total: open.questions.length,
    question: q && !open.endedAt ? { id: q.id, topic: q.topic, kind: q.kind, prompt: q.prompt, options: q.kind === 'mcq' ? q.options : [], term: q.kind === 'vocab' ? q.term : null, definition: q.kind === 'vocab' ? q.definition : null, like: q.like } : null,
    answer: q ? (open.answers[q.id] ?? null) : null,
    done: open.endedAt ? await summaryOf(db, open, now) : null,
    error: open.error,
  };
}
