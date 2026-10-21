// Test prep: setting up a test's topics, adding photos of notes, practice runs
// (start, answer with Sure or Guessing, teaching after a miss, "Try one like
// it", end), and the views the UI reads. AI calls go through the local service;
// multiple choice, flashcards, and math are checked here, written answers by
// the AI with quotes from the student's text.
import {
  brokerEnvelopeSchema,
  PRACTICE_GRADE_ROUTE,
  PRACTICE_ROUTE,
  practiceGradeResponseSchema,
  practiceResponseSchema,
  PREP_FORMATS,
  PREP_TOPICS_ROUTE,
  prepTopicsResponseSchema,
  TEACH_ROUTE,
  teachResponseSchema,
  type PracticeGradeRequest,
  type PracticeRequest,
  type PrepTopicsRequest,
  type TeachRequest,
} from '../../../shared/ai-contract';
import { instructionText, type Assignment, type LoomerDb, type PracticeQuestionRecord, type PracticeRecord, type PrepRecord, type TeachRecord } from '../core/db';
import { checkAiDispatch } from '../core/gate';
import type { AiSettings } from '../core/settings';
import type { Confidence, Practice, PracticeAnswer, PracticeSummary, PrepFormat, PrepSession, PrepSessionKind, PrepStep, TeachBlock, TestPrep } from '../model/prep';
import { assignmentPolicy, courseKey, effectiveDue, isOpen, policyAnswer } from '../analysis/facts';
import { assignmentNoun } from '../analysis/insight';
import { dayWords, localDay } from '../analysis/plan';
import { topicKey } from '../analysis/topicStanding';
import { isQuiz, storedWorkType } from '../analysis/workType';
import { strictnessFor } from './ladder';
import { activeTopics, answerRight, answerSolid, counts, diagnosis, fewNames, ladders, matchTopic, mistakes, names, outcomeOf, planSessions, practiceFor, readiness, stillWeak, topicCount, topicStandings, weakest } from './plan';

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

/**
 * Finds a test's topics, key terms, and formats from its instructions and study
 * guide. Runs once per test, with a retry after an hour on failure; `force`
 * ("Build my plan") retries a failed setup now.
 */
export async function setupPrep({ db, ai, fetch: fetchImpl = fetch, now = () => new Date() }: PrepDeps, a: Assignment, force = false): Promise<void> {
  const existing = await db.preps.get(a.id);
  if (existing && existing.status !== 'failed') return;
  if (existing && !force && now().getTime() - Date.parse(existing.failedAt ?? existing.startDay) < SETUP_RETRY_MS) return;
  const settings = await ai();
  if (!(await prepAllowed(db, settings, a))) return;
  const record: PrepRecord = existing ?? { assignmentId: a.id, startDay: localDay(now()), status: 'setup', topics: [], terms: [], formats: { selected: [], found: {}, asked: false }, notes: { photos: 0, found: null } };
  await db.preps.put({ ...record, status: 'setup' });
  const request: PrepTopicsRequest = { title: a.title.slice(0, 300), instructions: instructionText(a.detail).slice(0, 20_000), existing: [], images: [] };
  const reply = await post(settings, PREP_TOPICS_ROUTE, request, (v) => prepTopicsResponseSchema.safeParse(v), fetchImpl);
  if (typeof reply === 'string') {
    console.warn('loomer: prep setup failed:', reply);
    await db.preps.put({ ...record, status: 'failed', failedAt: now().toISOString(), error: "Loomer couldn't read this test's topics yet, so add your notes or a topic to start." });
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
  await db.preps.put({ ...prep, status: topics.some((t) => !t.removed) ? 'ready' : prep.status, topics });
}

export async function setFormats(db: LoomerDb, assignmentId: string, formats: PrepFormat[]) {
  const prep = await db.preps.get(assignmentId);
  if (prep) await db.preps.put({ ...prep, formats: { ...prep.formats, selected: formats.length ? formats : ['mcq'], asked: true } });
}

/** "How much time can you give this test today?" Today's sessions fit it. */
export async function setTodayMinutes(db: LoomerDb, assignmentId: string, minutes: number, now: Date) {
  const prep = await db.preps.get(assignmentId);
  if (prep) await db.preps.put({ ...prep, today: { day: localDay(now), minutes } });
}

/** Turns a later-today reminder on or off. Returns when it fires, for the alarm. */
export async function setReminder(db: LoomerDb, assignmentId: string, sessionId: string, on: boolean, now: Date): Promise<string | null> {
  const [prep, a] = await Promise.all([db.preps.get(assignmentId), db.assignments.get(assignmentId)]);
  const plan = prep && a ? await sessionsFor(db, prep, a, now) : null;
  const session = plan?.sessions.find((s) => s.id === sessionId);
  if (!prep || !session?.remindAt) return null;
  const rest = (prep.reminders ?? []).filter((id) => id !== sessionId);
  await db.preps.put({ ...prep, reminders: on ? [...rest, sessionId] : rest });
  return on ? session.remindAt : null;
}

async function sessionsFor(db: LoomerDb, prep: PrepRecord, a: Assignment, now: Date) {
  const testAt = effectiveDue(a, now).at;
  if (!testAt) return null;
  const [checks, practices] = await Promise.all([db.topicChecks.where('assignmentId').equals(prep.assignmentId).toArray(), db.practices.where('assignmentId').equals(prep.assignmentId).toArray()]);
  const topics = topicStandings(prep, checks, practices, strictnessFor(testAt, now));
  return { topics, checks, practices, testAt, ...planSessions(prep, testAt, topics, practices, checks, now) };
}

/** The session to do now: the first one today that isn't done. */
export async function currentPrepSession(db: LoomerDb, prep: PrepRecord, a: Assignment, now: Date): Promise<PrepSession | null> {
  return (await sessionsFor(db, prep, a, now))?.sessions.find((s) => s.status === 'today') ?? null;
}

/**
 * Writes a practice's questions. Called ahead of time for the current session,
 * and on prep:start when none is ready. `mistake`: practice on one earlier
 * wrong answer, with a question like it and two more on its topic.
 */
export async function writePractice(deps: PrepDeps, assignmentId: string, session: PrepSession | null, mistake?: PracticeQuestionRecord): Promise<string | null> {
  const { db, ai, fetch: fetchImpl = fetch, now = () => new Date() } = deps;
  const [a, prep] = await Promise.all([db.assignments.get(assignmentId), db.preps.get(assignmentId)]);
  if (!a || prep?.status !== 'ready' || activeTopics(prep).length === 0) return null;
  const settings = await ai();
  if (!(await prepAllowed(db, settings, a))) return null;
  const [checks, practices] = await Promise.all([db.topicChecks.where('assignmentId').equals(assignmentId).toArray(), db.practices.where('assignmentId').equals(assignmentId).toArray()]);
  const strict = strictnessFor(effectiveDue(a, now()).at ?? now().toISOString(), now());
  const topics = topicStandings(prep, checks, practices, strict);
  // Each topic is asked at its own rung on the ladder; the student never sees the rungs.
  const climbed = ladders(prep, practices, strict);
  const kind: PrepSessionKind | 'mistake' = mistake ? 'mistake' : (session?.kind ?? 'review');
  const practicedToday = practices.filter((p) => p.day === localDay(now())).flatMap((p) => p.questions.map((q) => q.topicId));
  const plan = mistake
    ? { topics: topics.filter((t) => t.id === mistake.topicId), kinds: mistake.kind === 'mcq' ? [{ kind: 'mcq' as const, count: 3 }] : [{ kind: mistake.kind, count: 1 }, { kind: 'mcq' as const, count: 2 }], perTopic: null }
    : practiceFor(kind === 'mistake' ? 'review' : kind, prep, topics, checks, now(), practicedToday);
  const id = crypto.randomUUID();
  const record: PracticeRecord = {
    id, assignmentId, dayKind: kind, sessionId: mistake ? null : (session?.id ?? null), day: localDay(now()), createdAt: now().toISOString(),
    startedAt: null, endedAt: null, closed: false, writing: true, error: null, index: 0, questions: [], answers: {}, blocks: [], showing: null,
  };
  await db.practices.put(record);
  const request: PracticeRequest = {
    title: a.title.slice(0, 300),
    source: sourceOf(a),
    topics: plan.topics.map((t) => t.text.slice(0, 160)),
    terms: prep.terms.slice(0, 40).map((t) => ({ term: t.term.slice(0, 160), definition: t.definition.slice(0, 400) })),
    kinds: plan.kinds,
    like: mistake ? { topic: mistake.topic.slice(0, 160), kind: mistake.kind, prompt: (mistake.prompt || mistake.term).slice(0, 2_000) } : null,
    avoid: askedPrompts(practices),
    perTopic: plan.perTopic,
    ask: plan.perTopic ? [] : plan.topics.map((t) => ({ topic: t.text.slice(0, 160), rung: climbed.get(t.id)?.ask ?? 'recall' })),
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

const askedPrompts = (practices: PracticeRecord[]) => practices.flatMap((p) => p.questions.map((q) => q.prompt.slice(0, 400))).slice(-60);

type AiQuestion = (typeof practiceResponseSchema)['_zod']['output']['questions'][number];

/** A usable question from the AI's reply, or none (a multiple choice with a bad answer index, an empty prompt). */
function questionFrom(q: AiQuestion, topics: PrepRecord['topics'], like: boolean, checkOf?: string): PracticeQuestionRecord[] {
  if (!q.prompt.trim() && q.kind !== 'vocab') return [];
  if (q.kind === 'mcq' && (q.options.length < 2 || q.answerIndex < 0 || q.answerIndex >= q.options.length)) return [];
  if (q.kind === 'vocab' && (!q.term.trim() || !q.definition.trim())) return [];
  if ((q.kind === 'short' || q.kind === 'frq' || q.kind === 'explain') && q.needs.length === 0) return [];
  const topic = matchTopic(q.topic, topics);
  // Models tend to put the right answer first, so the options are shuffled here.
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
  const options = q.kind === 'mcq' ? order.map((i) => q.options[i]!) : q.options;
  const answerIndex = q.kind === 'mcq' ? order.indexOf(q.answerIndex) : q.answerIndex;
  return [{ id: newId(), topicId: topic.id, topic: topic.text, kind: q.kind, skill: q.skill, label: q.label.slice(0, 80), prompt: q.prompt, options, answerIndex, why: q.why, term: q.term, definition: q.definition, answer: q.answer, worked: q.worked, needs: q.needs.slice(0, 8), like, ...(checkOf ? { checkOf } : {}) }];
}

const closeOthers = (db: LoomerDb, id: string) => db.practices.filter((p) => !!p.startedAt && !p.closed && p.id !== id).modify({ closed: true });

/** Starts the current session's practice (the one written ahead when there is one), or practice on one mistake. */
export async function startPractice(deps: PrepDeps, assignmentId: string, mistakeId?: string): Promise<string | null> {
  const { db, now = () => new Date() } = deps;
  const [prep, a] = await Promise.all([db.preps.get(assignmentId), db.assignments.get(assignmentId)]);
  if (!prep || !a) return "Loomer hasn't set up this test yet.";
  let id: string | null;
  if (mistakeId) {
    const mistake = (await db.practices.where('assignmentId').equals(assignmentId).toArray()).flatMap((p) => p.questions).find((q) => q.id === mistakeId);
    if (!mistake) return "Loomer couldn't find that mistake anymore.";
    id = await writePractice(deps, assignmentId, null, mistake);
  } else {
    const session = await currentPrepSession(db, prep, a, now());
    const ready = session && (await db.practices.where('assignmentId').equals(assignmentId).toArray()).find((p) => !p.startedAt && p.sessionId === session.id && !p.error);
    id = ready?.id ?? (await writePractice(deps, assignmentId, session));
  }
  if (!id) return "AI help is off for this test, so Loomer can't write practice.";
  await closeOthers(db, id);
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

/** What happens after a multiple-choice answer, in one sentence. */
function nextLine(outcome: ReturnType<typeof outcomeOf>, correct: string): string {
  switch (outcome) {
    case 'mixup':
      return `You were sure, and the answer was “${correct}”, so Loomer explains this one next.`;
    case 'gap':
      return `The answer was “${correct}”, so Loomer explains this one next.`;
    case 'shaky':
      return 'You got it, but since it was a guess, this topic comes back later.';
    case 'solid':
      return 'You got it, and you were sure.';
  }
}

/**
 * Records the student's answer. Multiple choice (with Sure or Guessing),
 * flashcards, and math are checked here at once; written answers by the AI.
 * Returns true when the answer should be taught (a mix-up, a gap, or a weak
 * written or math answer), so the caller can write a teaching block.
 */
export async function answerPractice(deps: PrepDeps, practiceId: string, questionId: string, input: { choice?: number; text?: string; knew?: boolean; confidence?: Confidence }): Promise<boolean> {
  const { db, ai, fetch: fetchImpl = fetch, now = () => new Date() } = deps;
  const p = await db.practices.get(practiceId);
  const q = p?.questions.find((x) => x.id === questionId);
  if (!p || !q || p.answers[questionId] || p.endedAt) return false;
  const save = async (answer: PracticeAnswer) => {
    const fresh = (await db.practices.get(practiceId))!;
    await db.practices.update(practiceId, { answers: { ...fresh.answers, [questionId]: answer } });
    const solid = answerSolid(answer);
    if (solid !== null) await db.topicChecks.add({ assignmentId: p.assignmentId, topic: topicKey(q.topic), quizId: practiceId, question: fresh.questions.indexOf(q), correct: solid, at: now().toISOString() });
  };
  switch (q.kind) {
    case 'mcq': {
      const picked = input.choice ?? -1;
      const right = picked === q.answerIndex;
      const outcome = outcomeOf(right, input.confidence ?? null);
      await save({ kind: 'mcq', picked, correct: q.answerIndex, right, confidence: input.confidence ?? null, outcome, why: q.why, next: nextLine(outcome, q.options[q.answerIndex] ?? '') });
      return outcome === 'mixup' || outcome === 'gap';
    }
    case 'vocab':
      await save({ kind: 'vocab', knew: input.knew === true });
      return false;
    case 'math': {
      const right = mathRight(input.text ?? '', q.answer);
      await save({ kind: 'math', text: (input.text ?? '').slice(0, 500), right, answer: q.answer, why: q.why, worked: right ? null : q.worked });
      return !right;
    }
    case 'short':
    case 'explain':
    case 'frq': {
      const text = (input.text ?? '').trim().slice(0, 8_000);
      const pending: PracticeAnswer = q.kind === 'frq' ? { kind: 'frq', text, status: 'pending', needs: [] } : { kind: q.kind, text, status: 'pending', met: [], missing: [] };
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
      const answer: PracticeAnswer =
        q.kind === 'frq'
          ? { kind: 'frq', text, status: 'ready', needs: checked.map((n) => ({ need: n.need, met: n.met, note: n.met ? n.quote : n.hint })) }
          : { kind: q.kind, text, status: 'ready', met: checked.filter((n) => n.met).map((n) => ({ need: n.need, quote: n.quote })), missing: checked.filter((n) => !n.met).map((n) => ({ need: n.need, hint: n.hint })) };
      await save(answer);
      return typeof reply !== 'string' && answerRight(answer) === false;
    }
  }
}

/** At most two teaching blocks per topic in one practice: the first, and one "again". */
const MAX_BLOCKS_PER_TOPIC = 2;

/**
 * Writes a teaching block for a missed question, starting from the student's
 * exact answer, and puts its check questions right after the missed one. A
 * miss on a check gets a different kind of block ("again").
 */
export async function teachAfter(deps: PrepDeps, practiceId: string, questionId: string): Promise<void> {
  const { db, ai, fetch: fetchImpl = fetch } = deps;
  const p = await db.practices.get(practiceId);
  const q = p?.questions.find((x) => x.id === questionId);
  const a = p && (await db.assignments.get(p.assignmentId));
  const prep = p && (await db.preps.get(p.assignmentId));
  const answer = q && p?.answers[q.id];
  if (!p || !q || !a || !prep || !answer) return;
  const earlier = p.blocks.filter((b) => b.block.topic === q.topic);
  if (earlier.length >= MAX_BLOCKS_PER_TOPIC) return;
  const settings = await ai();
  if (!(await prepAllowed(db, settings, a))) return;
  const blockId = newId();
  const again = Boolean(q.checkOf);
  const given =
    answer.kind === 'mcq' ? (q.options[answer.picked] ?? '')
    : answer.kind === 'math' || answer.kind === 'short' || answer.kind === 'explain' || answer.kind === 'frq' ? answer.text
    : '';
  const miss = answer.kind === 'mcq' && given ? `You picked “${given}”, and the answer is “${q.options[q.answerIndex] ?? ''}”.` : null;
  const placeholder: TeachBlock = { id: blockId, topic: q.topic, kind: 'explain', title: '', miss, text: null, quote: null, compare: null, steps: null, frame: null, again };
  await db.practices.update(practiceId, { blocks: [...p.blocks, { afterQuestionId: q.id, status: 'pending', shown: false, block: placeholder }] });

  const request: TeachRequest = {
    title: a.title.slice(0, 300),
    source: sourceOf(a).slice(0, 12_000),
    topic: q.topic.slice(0, 160),
    question: { kind: q.kind, prompt: (q.prompt || q.term).slice(0, 2_000), options: q.options.slice(0, 6).map((o) => o.slice(0, 400)), correct: (q.kind === 'mcq' ? (q.options[q.answerIndex] ?? '') : q.kind === 'math' ? q.answer : q.needs.join('; ')).slice(0, 400) },
    given: given.slice(0, 4_000),
    avoidKinds: earlier.map((b) => b.block.kind),
    avoid: askedPrompts([p]),
  };
  const reply = await post(settings, TEACH_ROUTE, request, (v) => teachResponseSchema.safeParse(v), fetchImpl);
  const fresh = (await db.practices.get(practiceId))!;
  const update = (status: TeachRecord['status'], block: TeachBlock, checks: PracticeQuestionRecord[]) => {
    const at = fresh.questions.findIndex((x) => x.id === q.id) + 1;
    return db.practices.update(practiceId, {
      blocks: fresh.blocks.map((b) => (b.block.id === blockId ? { ...b, status, block } : b)),
      questions: [...fresh.questions.slice(0, at), ...checks, ...fresh.questions.slice(at)],
    });
  };
  if (typeof reply === 'string') {
    console.warn('loomer: teaching block failed:', reply);
    await update('failed', placeholder, []);
    return;
  }
  const b = reply.block;
  // A quote must really be in the study guide.
  const guide = request.source.toLowerCase().replace(/\s+/g, ' ');
  const quote = b.quote.trim() && guide.includes(b.quote.toLowerCase().replace(/\s+/g, ' ').trim()) ? { text: b.quote.trim(), source: 'Your study guide' } : null;
  const block: TeachBlock = {
    ...placeholder,
    kind: b.kind,
    title: b.title.slice(0, 80),
    text: b.text.trim() || null,
    quote,
    compare: b.kind === 'compare' && b.compare && b.compare.heads.length >= 2 && b.compare.rows.length ? { heads: [b.compare.heads[0]!, b.compare.heads[1]!], rows: b.compare.rows.slice(0, 8) } : null,
    steps: (b.kind === 'timeline' || b.kind === 'visual') && b.steps?.length ? b.steps.slice(0, 8) : null,
    frame: b.kind === 'frq-skill' && b.frame?.length ? b.frame.map((piece) => (piece.blank.trim() ? { blank: piece.blank.trim() } : piece.text)) : null,
  };
  const checks = reply.checks.flatMap((x) => questionFrom(x, activeTopics(prep), true, blockId)).slice(0, 2);
  await update('ready', block, checks);
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
    avoid: askedPrompts([p]),
    perTopic: null,
    ask: [],
  };
  const reply = await post(settings, PRACTICE_ROUTE, request, (v) => practiceResponseSchema.safeParse(v), fetchImpl);
  const fresh = (await db.practices.get(practiceId))!;
  const like = typeof reply === 'string' ? [] : reply.questions.flatMap((x) => questionFrom(x, activeTopics(prep), true)).slice(0, 1);
  const at = fresh.questions.findIndex((x) => x.id === questionId) + 1;
  await db.practices.update(practiceId, { writing: false, questions: [...fresh.questions.slice(0, at), ...like, ...fresh.questions.slice(at)], index: at });
}

/**
 * Moves on. A missed question's teaching block shows first as its own step
 * (waiting while it is written); after the block, its check questions come
 * next. After the last question, the practice ends.
 */
export async function nextQuestion(db: LoomerDb, practiceId: string, now: Date): Promise<void> {
  const p = await db.practices.get(practiceId);
  if (!p || p.endedAt) return;
  if (p.showing) {
    await db.practices.update(practiceId, { showing: null, blocks: p.blocks.map((b) => (b.block.id === p.showing ? { ...b, shown: true } : b)) });
  } else {
    const q = p.questions[p.index];
    const block = q && p.blocks.find((b) => b.afterQuestionId === q.id && !b.shown && b.status !== 'failed');
    if (block) {
      await db.practices.update(practiceId, { showing: block.block.id });
      return;
    }
  }
  const fresh = (await db.practices.get(practiceId))!;
  if (fresh.index + 1 >= fresh.questions.length) await endPractice(db, practiceId, now);
  else await db.practices.update(practiceId, { index: fresh.index + 1 });
}

/** Ends a practice and posts its result as one line in the test's chat. */
export async function endPractice(db: LoomerDb, practiceId: string, now: Date): Promise<void> {
  const p = await db.practices.get(practiceId);
  if (!p || p.endedAt) return;
  await db.practices.update(practiceId, { endedAt: now.toISOString(), showing: null });
  const summary = await summaryOf(db, (await db.practices.get(practiceId))!, now);
  if (!summary) return;
  await db.chatTurns.add({ threadKey: p.assignmentId, role: 'loomer', blocks: [{ kind: 'practice-result', practiceId, line: summary.line, detail: summary.detail, mistakes: summary.mistakes }], status: 'done', createdAt: now.toISOString() });
}

const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "tomorrow's Unit 5 Test", "today's Unit 5 Test", "Friday's Unit 5 Test". */
function testName(a: Assignment, due: string | null, now: Date): string {
  if (!due) return a.title;
  const when = dayWords(due, now);
  const owner = when === 'today' || when === 'tomorrow' ? when : new Date(due).toLocaleDateString(undefined, { weekday: 'long' });
  return `${owner}'s ${a.title}`;
}

/** What the practice did and where its topics stand now; after a diagnostic, the diagnosis. */
async function summaryOf(db: LoomerDb, p: PracticeRecord, now: Date): Promise<PracticeSummary | null> {
  const [a, prep, checks, practices] = await Promise.all([db.assignments.get(p.assignmentId), db.preps.get(p.assignmentId), db.topicChecks.where('assignmentId').equals(p.assignmentId).toArray(), db.practices.where('assignmentId').equals(p.assignmentId).toArray()]);
  if (!a || !prep) return null;
  const answered = p.questions.filter((q) => p.answers[q.id]);
  const ids = new Set(answered.map((q) => q.topicId));
  const all = topicStandings(prep, checks, practices, strictnessFor(effectiveDue(a, now).at ?? now.toISOString(), now));
  const topics = all.filter((t) => ids.has(t.id));
  const wrong = answered.filter((q) => answerRight(p.answers[q.id]!) === false).length;
  const noun = assignmentNoun(a);
  const due = effectiveDue(a, now).at;
  const view = topics.map((t) => ({ text: t.text, standing: t.standing, lastCheck: t.lastCheck }));
  if (p.dayKind === 'diagnostic' && answered.length) {
    const plan = await sessionsFor(db, prep, a, now);
    const lines = diagnosis(p, Boolean(plan?.sessions.some((s) => s.when === 'later-today' && s.status !== 'done')));
    const solid = lines.filter((l) => l.outcome === 'solid').length;
    const first = lines.find((l) => l.outcome === 'mixup') ?? lines.find((l) => l.outcome === 'gap') ?? lines.find((l) => l.outcome === 'shaky');
    const detail = !first
      ? `All ${topicCount(lines.length)} look strong so far, and a later check makes them ready.`
      : `${solid} of ${topicCount(lines.length)} ${solid === 1 ? 'looks' : 'look'} strong so far, and ${first.outcome === 'mixup' ? `the ${first.topic} mix-up` : first.topic} is the first thing to fix.`;
    return { line: `Here's where you are for ${testName(a, due, now)}.`, detail, topics: view, mistakes: wrong, diagnosis: lines };
  }
  const line =
    answered.length === 0 ? `You stopped before answering, and ${noun} is still on your plan.`
    : p.dayKind === 'practice-test' ? `You finished a practice test with ${answered.length} questions.`
    : p.dayKind === 'warm-up' ? `You warmed up on ${names(topics)}.`
    : p.dayKind === 'mistake' ? `You practiced ${names(topics)} again.`
    : p.dayKind === 'mixed-check' ? `You did a mixed check on ${names(topics)}.`
    : p.dayKind === 'review' ? `You reviewed ${names(topics)}.`
    : `You practiced ${names(topics)}.`;
  const solid = topics.filter((t) => t.standing === 'solid' && !t.mixup);
  const weak = topics.filter((t) => t.standing !== 'solid' || t.mixup);
  const before = due ? ` before ${dayWords(due, now)}` : '';
  const detail =
    topics.length === 0 ? 'Start again whenever you are ready.'
    : weak.length === 0 ? `${capFirst(names(solid))} ${solid.length === 1 ? 'is' : 'are'} ready now.`
    : solid.length === 0 ? `${capFirst(names(weak))} still ${weak.length === 1 ? 'needs' : 'need'} one more round${before}.`
    : `${capFirst(names(solid))} ${solid.length === 1 ? 'is' : 'are'} ready now, and ${names(weak)} still ${weak.length === 1 ? 'needs' : 'need'} one more round${before}.`;
  return { line, detail, topics: view, mistakes: wrong, diagnosis: null };
}

/** The test page's prep view. Null for work that isn't a test, or before setup starts. */
export async function loadPrep(db: LoomerDb, a: Assignment, now: Date): Promise<TestPrep | null> {
  const prep = await db.preps.get(a.id);
  const plan = prep && (await sessionsFor(db, prep, a, now));
  if (!prep || !plan) return null;
  const today = prep.today?.day === localDay(now) ? prep.today.minutes : null;
  return {
    assignmentId: a.id,
    testAt: plan.testAt,
    status: prep.status === 'ready' ? 'ready' : 'setup',
    error: prep.status === 'failed' ? (prep.error ?? null) : null,
    readiness: readiness(plan.topics, plan.checks),
    counts: counts(plan.topics),
    topics: plan.topics,
    formats: prep.formats,
    today: { minutes: today, asked: today !== null },
    fits: plan.fits,
    note: plan.note,
    plan: prep.status === 'ready' ? plan.sessions : [],
    mistakes: mistakes(plan.practices),
    blocks: plan.practices
      .slice()
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .flatMap((p) => p.blocks.filter((b) => b.status === 'ready').map((b) => b.block))
      .slice(0, 20),
    notes: prep.notes,
  };
}

/** Home's step for a test with prep: the current session, or the later-today one it waits for. Null when today's sessions are done. */
export function prepStep(prep: PrepRecord, a: Assignment, checks: Parameters<typeof topicStandings>[1], practices: PracticeRecord[], now: Date): { step: PrepStep; action: string; insight: string } | null {
  const testAt = effectiveDue(a, now).at;
  if (prep.status !== 'ready' || !testAt) return null;
  const topics = topicStandings(prep, checks, practices, strictnessFor(testAt, now));
  if (topics.length === 0) return null;
  const session = planSessions(prep, testAt, topics, practices, checks, now).sessions.find((s) => s.status === 'today');
  if (!session) return null;
  const noun = assignmentNoun(a);
  const Noun = capFirst(noun);
  const when = dayWords(testAt, now);
  const weak = weakest(topics, checks, 2);
  const waiting = session.when === 'later-today' && session.remindAt && Date.parse(session.remindAt) > now.getTime();
  // Only topics that really need work are called weak; when everything is solid, the line says so.
  const shaky = stillWeak(topics);
  const focusOn = shaky.length ? shaky : weak;
  const insight =
    waiting ? 'Coming back after a few hours helps it stick.'
    : session.kind === 'diagnostic' ? `Loomer found ${topicCount(topics.length)}, so this shows where to start.`
    : session.kind === 'practice-test' ? `${Noun} is ${when}, so practice in its real format.`
    : session.kind === 'warm-up' ? `A quick warm-up on ${fewNames(focusOn.slice(0, 2))} before the test.`
    : session.kind === 'rescue' ? `${Noun} is today, so spend this on ${fewNames(focusOn.slice(0, 2))}.`
    : session.kind === 'review' ? `A light review keeps ${noun} fresh without cramming.`
    : session.kind === 'mixed-check' ? (shaky.length ? `A mixed check on ${fewNames(shaky)} shows what stuck.` : 'Everything is ready, so a mixed check helps it stick.')
    : shaky.length ? `${capFirst(fewNames(shaky))} ${shaky.length === 1 ? 'is' : 'are'} still shaky, so start there.`
    : 'Everything is ready, so this keeps it fresh.';
  return {
    step: {
      assignmentId: a.id,
      kind: session.kind,
      minutes: session.minutes,
      counts: counts(topics),
      readiness: readiness(topics, checks),
      waiting: waiting ? { sessionId: session.id, label: `Next at ${new Date(session.remindAt!).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`, step: session.step, remindAt: session.remindAt!, reminder: session.reminder } : null,
    },
    action: session.step,
    insight,
  };
}

/** The practice in progress, or just finished and not yet closed. */
export async function loadPracticeModel(db: LoomerDb, now: Date): Promise<Practice | null> {
  const open = (await db.practices.filter((p) => !!p.startedAt && !p.closed).toArray()).sort((x, y) => (y.startedAt ?? '').localeCompare(x.startedAt ?? ''))[0];
  if (!open) return null;
  const a = await db.assignments.get(open.assignmentId);
  const showing = open.showing ? open.blocks.find((b) => b.block.id === open.showing) : undefined;
  const q = open.writing || showing ? undefined : open.questions[open.index];
  return {
    id: open.id,
    assignmentId: open.assignmentId,
    title: a?.title ?? 'This test',
    mode: open.dayKind === 'diagnostic' ? 'diagnostic' : open.dayKind === 'mistake' ? 'mistake' : 'practice',
    index: open.index,
    total: open.questions.length,
    question: q && !open.endedAt ? { id: q.id, topic: q.topic, kind: q.kind, skill: q.skill, prompt: q.prompt, options: q.kind === 'mcq' ? q.options : [], term: q.kind === 'vocab' ? q.term : null, definition: q.kind === 'vocab' ? q.definition : null, like: q.like } : null,
    answer: q ? (open.answers[q.id] ?? null) : null,
    teach: showing?.status === 'ready' && !open.endedAt ? showing.block : null,
    done: open.endedAt ? await summaryOf(db, open, now) : null,
    error: open.error,
  };
}
