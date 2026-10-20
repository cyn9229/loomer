// Ask Loomer tools. They run in the extension over the student's local data and
// never change anything. Each returns text for the model and, for display
// tools, one validated block for the panel. Arguments are untrusted model output.
import { chatTools, type ChatToolName } from '../../../shared/chat-contract';
import { editFromItem, proposeChange, type PlanSettings } from '../analysis/changes';
import { assignmentPolicy, courseKey, offPlan, policyAnswer } from '../analysis/facts';
import { localDay, minutesWords, WORKLOAD_WORDS } from '../analysis/plan';
import { buildHomeModel } from '../analysis/recommend';
import { roomDays, roomKey, roomLookup } from '../analysis/room';
import { checkAiDispatch } from '../core/gate';
import { findTopic, loadSheetTopics, reusedFromSheet, sheetTextFor } from '../session/topics';
import { ownDraft, workHelpDecision } from '../session/help';
import { instructionText, type LoomerDb, type PlanEdit } from '../core/db';
import type { ChatBlock } from '../model/chat';
import type { WorkItem } from '../model/home';
import { loadHomeData } from '../model/homeData';
import { cleanSvg } from './sanitize';

const MAX_INSTRUCTIONS = 6_000;
const MAX_HTML = 60_000;
const MAX_DRAFT_CHARS = 15_000;
const DAY_MS = 86_400_000;

export type ToolSettings = PlanSettings;
export type ToolResult = { forModel: string; block?: ChatBlock; label: string };

const LABELS: Record<ChatToolName, string> = {
  list_work: 'Looked at your assignments',
  get_assignment: 'Read the assignment',
  get_saved_sources: 'Checked your saved pages',
  open_assignment: 'Linked an assignment',
  show_visual: 'Made a visual',
  quiz_me: 'Made a quick check',
  propose_plan_change: 'Suggested a plan change',
  propose_add_assignment: 'Suggested adding an assignment',
  read_my_draft: 'Read your draft',
};

const isTool = (name: string): name is ChatToolName => Object.hasOwn(chatTools, name);

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : null;

/** What the model may see about one item: dates, size, class, and whether AI help is off. */
function itemSummary(i: WorkItem) {
  return {
    id: i.assignmentId,
    title: i.title,
    class: i.courseName,
    due: day(i.due?.at),
    start_by: day(i.startBy?.at),
    workload: WORKLOAD_WORDS[i.effort.label],
    workload_set_by: i.effort.source === 'student' ? 'student' : 'loomer',
    start_day_picked_by_student: i.startBy?.basis === 'student',
    student_guess: i.guessMinutes ? minutesWords(i.guessMinutes) : null,
    checkpoints: i.checkpoints.map((c) => `${c.text}: ${day(c.at)}`),
    work_type: i.workType.type,
    ai_help: i.quiz ? 'off (quiz or test)' : i.policy.state === 'blocked' ? 'off (teacher rule)' : 'allowed',
    plan_note: i.rankReason,
    added_by_student: i.source === 'student',
  };
}

async function allItems(db: LoomerDb, settings: ToolSettings, now: Date): Promise<WorkItem[]> {
  const home = buildHomeModel({ ...(await loadHomeData(db)), ...settings, briefDismissedOn: null, now });
  if (home.status === 'not-connected') return [];
  return home.status === 'ready' ? [home.next.item, ...home.rest] : home.rest;
}

/** The student's room for the coming week (only days that are not plain free) and their normal day. */
async function roomSummary(db: LoomerDb, now: Date) {
  const records = await db.dayRoom.toArray();
  const normal = records.find((r) => r.key === roomKey.default);
  const days = roomDays(roomLookup(records), localDay(now), 7)
    .filter((d) => d.level !== 'free' || d.repeating)
    .map((d) => ({ date: d.date, room: d.level, every_week: d.repeating, student_minutes: d.minutes }));
  const session = await db.sessions.where('state').equals('active').last();
  const left = session?.plannedUntil ? Math.max(0, Math.round((Date.parse(session.plannedUntil) - now.getTime()) / 60_000)) : null;
  return {
    your_room: days,
    normal_day: normal?.minutes != null ? minutesWords(normal.minutes) : 'not set yet',
    session: session ? { assignment_id: session.assignmentId, minutes_left: left } : null,
  };
}

/** Where a tool call happens: the thread, and the sheet topic the student asked about with one tap, if any. */
export type ToolContext = { threadKey: string | null; topic: string | null };

export async function runTool(db: LoomerDb, settings: ToolSettings, name: string, rawArgs: string, now: Date, { threadKey, topic }: ToolContext = { threadKey: null, topic: null }): Promise<ToolResult> {
  if (!isTool(name)) return { forModel: `Unknown tool ${name}.`, label: 'Unknown tool' };
  let json: unknown;
  try {
    json = JSON.parse(rawArgs || '{}');
  } catch {
    return { forModel: 'Arguments were not valid JSON.', label: LABELS[name] };
  }
  const label = LABELS[name];

  switch (name) {
    case 'list_work': {
      const args = chatTools.list_work.schema.safeParse(json);
      const items = (await allItems(db, settings, now)).filter((i) => !i.hidden && !offPlan(i.correction));
      const inWeek = (i: WorkItem) => {
        const t = Math.min(i.due ? Date.parse(i.due.at) : Infinity, i.startBy ? Date.parse(i.startBy.at) : Infinity);
        return t <= now.getTime() + 7 * DAY_MS;
      };
      const chosen = (args.success && args.data.range === 'all' ? items : items.filter(inWeek)).slice(0, 25);
      return { forModel: JSON.stringify({ items: chosen.map(itemSummary), shown: chosen.length, total_open: items.length, ...(await roomSummary(db, now)) }), label };
    }
    case 'get_assignment': {
      const args = chatTools.get_assignment.schema.safeParse(json);
      if (!args.success) return { forModel: 'Missing assignment_id.', label };
      const item = (await allItems(db, settings, now)).find((i) => i.assignmentId === args.data.assignment_id);
      const a = await db.assignments.get(args.data.assignment_id);
      if (!item || !a) return { forModel: 'No assignment with that id. Use list_work first.', label };
      // A teacher's no-AI rule: share only that help is off, never the content.
      if (item.policy.state === 'blocked') {
        return { forModel: JSON.stringify({ ...itemSummary(item), blocked: true, rule: item.policy.quote ?? 'The teacher does not allow AI help.' }), label };
      }
      // Instructions go to AI under the same rule as requirement analysis (not when the policy is unclear or unreadable).
      const context = new Map((await db.studentContext.bulkGet([a.id, courseKey(a)])).filter((c) => c !== undefined).map((c) => [c.key, c]));
      const policy = assignmentPolicy(a, await db.courses.get(courseKey(a)));
      if (!checkAiDispatch({ aiEnabled: true, policy, answer: policyAnswer(a, context), purpose: 'requirements-analysis' }).allowed) {
        return { forModel: JSON.stringify({ ...itemSummary(item), paused: true, note: 'Loomer is not sure AI help is allowed here, so the instructions are not shared.' }), label };
      }
      const analysis = await db.analyses.get(a.id);
      return {
        forModel: JSON.stringify({
          ...itemSummary(item),
          instructions: (a.detail ? instructionText(a.detail) : '(not readable)').slice(0, MAX_INSTRUCTIONS),
          rubric: (a.detail?.rubric ?? []).map((r) => r.description),
          plain_words: analysis?.status === 'ok' ? (analysis.plainWords ?? null) : null,
          // Where the student stands on each sheet topic, from their own quick checks.
          topics: ((await loadSheetTopics(db, a.id))?.items ?? []).map((t) => ({
            topic: t.text,
            standing: t.skipped ? 'skipped' : t.standing,
            last_check: t.lastCheck ? `${t.lastCheck.correct} of ${t.lastCheck.total} right` : null,
          })),
        }),
        label,
      };
    }
    case 'get_saved_sources': {
      const args = chatTools.get_saved_sources.schema.safeParse(json);
      if (!args.success) return { forModel: 'Missing assignment_id.', label };
      const sources = await db.sources.where('assignmentId').equals(args.data.assignment_id).toArray();
      return { forModel: JSON.stringify(sources.map((s) => ({ title: s.title, url: s.url, kind: s.kind ?? 'page' }))), label };
    }
    case 'open_assignment': {
      const args = chatTools.open_assignment.schema.safeParse(json);
      const a = args.success ? await db.assignments.get(args.data.assignment_id) : undefined;
      if (!a) return { forModel: 'No assignment with that id.', label };
      return { forModel: 'A button to open it is shown.', block: { kind: 'open-assignment', assignmentId: a.id, title: a.title }, label };
    }
    case 'show_visual': {
      const args = chatTools.show_visual.schema.safeParse(json);
      if (!args.success) return { forModel: 'The visual did not match the schema; explain in words instead.', label };
      const { type, title, svg, chart, html, height } = args.data;
      if (type === 'svg') {
        const clean = svg ? cleanSvg(svg) : null;
        if (!clean) return { forModel: 'The SVG was not safe to show; explain in words instead.', label };
        return { forModel: 'Shown to the student.', block: { kind: 'visual', visual: { type: 'svg', title, svg: clean } }, label };
      }
      if (type === 'chart') {
        if (!chart || chart.series.some((s) => s.values.length !== chart.labels.length)) return { forModel: 'Each series needs one value per label.', label };
        return {
          forModel: 'Shown to the student.',
          block: {
            kind: 'visual',
            visual: { type: 'chart', title, chart: { kind: chart.kind, labels: chart.labels, series: chart.series, xLabel: chart.x_label ?? undefined, yLabel: chart.y_label ?? undefined } },
          },
          label,
        };
      }
      if (!html || html.length > MAX_HTML) return { forModel: 'The interactive page was missing or too large.', label };
      // Runs only in the sandboxed widget page; no extension access, no network.
      return { forModel: 'Shown to the student in a sandboxed frame.', block: { kind: 'visual', visual: { type: 'interactive', title, html, height: height ?? 320 } }, label };
    }
    case 'propose_plan_change': {
      const args = chatTools.propose_plan_change.schema.safeParse(json);
      if (!args.success) return { forModel: 'The changes did not match the schema.', label };
      const edits: PlanEdit[] = [];
      for (const c of args.data.changes) {
        const edit = editFromItem(c, now);
        if (typeof edit === 'string') return { forModel: `Not proposed: ${edit}`, label };
        edits.push(edit);
      }
      const proposed = await proposeChange(db, edits, threadKey, settings, now);
      if (!proposed.ok) return { forModel: `Not proposed: ${proposed.error}`, label };
      const { preview } = proposed.change;
      const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'off the plan');
      return {
        forModel: JSON.stringify({
          shown: 'A card with Apply and Not now is on the student’s screen. Nothing changes until they tap Apply. Say in one short sentence what it does.',
          changes: preview.lines,
          start_days_that_move: preview.moves.map((m) => `${m.title}: ${day(m.from)} → ${day(m.to)}`),
        }),
        block: { kind: 'plan-change', changeId: proposed.change.id },
        label,
      };
    }
    case 'read_my_draft': {
      const args = chatTools.read_my_draft.schema.safeParse(json);
      if (!args.success) return { forModel: 'Pass assignment_id.', label };
      const id = args.data.assignment_id;
      if (!(await workHelpDecision(db, settings.ai, id)).allowed) return { forModel: 'Help on this assignment is off, so the draft is not shared.', label };
      const draft = await ownDraft(db, id);
      if (!draft) return { forModel: 'No readable draft is linked. Tell the student they can link their Google Doc from their work session.', label };
      return { forModel: JSON.stringify({ scope: draft.text.length > MAX_DRAFT_CHARS ? 'partial' : 'full', words: draft.words, text: draft.text.slice(0, MAX_DRAFT_CHARS) }), label };
    }
    case 'propose_add_assignment': {
      const args = chatTools.propose_add_assignment.schema.safeParse(json);
      if (!args.success) return { forModel: 'The assignment did not match the schema.', label };
      const { title, class_name, due_date, due_time, work_type } = args.data;
      let dueAt: string | null = null;
      if (due_date) {
        const [y, m, d] = due_date.split('-').map(Number);
        const [hh, mm] = (due_time ?? '23:59').split(':').map(Number);
        const due = new Date(y!, m! - 1, d!, hh, mm);
        if (Number.isNaN(due.getTime()) || due.getMonth() !== m! - 1) return { forModel: 'Not proposed: that date does not exist.', label };
        if (due.getTime() < now.getTime()) return { forModel: 'Not proposed: that due date has already passed. Ask the student when it is due.', label };
        dueAt = due.toISOString();
      }
      const run = await db.runs.orderBy('startedAt').last();
      const name = class_name?.trim().toLowerCase();
      const course = name ? (await db.courses.toArray()).find((c) => c.sourceKey === run?.sourceKey && (c.name.toLowerCase().includes(name) || name.includes(c.name.toLowerCase()))) : undefined;
      const draft = { title: title.trim(), courseKey: course?.id ?? null, courseName: course?.name ?? null, dueAt, workType: work_type };
      return {
        forModel: JSON.stringify({
          shown: 'A card with Add and Not now is on the student’s screen. Nothing is added until they tap Add, and they can change any field first. Say in one short sentence what it adds.',
          draft: { ...draft, due: day(dueAt), class: course?.name ?? (class_name ? `no class named ${class_name}; the card says Other` : null) },
        }),
        block: { kind: 'add-assignment', draftId: crypto.randomUUID(), draft },
        label,
      };
    }
    case 'quiz_me': {
      const args = chatTools.quiz_me.schema.safeParse(json);
      if (!args.success) return { forModel: 'The quiz did not match the schema.', label };
      const questions = args.data.questions.filter((q) => q.answer_index < q.choices.length);
      if (questions.length === 0) return { forModel: 'Every answer index was out of range.', label };
      // Never hand the student their own homework: refuse a question that copies math from their sheet.
      const sheet = threadKey ? await sheetTextFor(db, threadKey) : '';
      for (const [i, q] of questions.entries()) {
        const copied = reusedFromSheet([q.prompt, ...q.choices].join(' '), sheet);
        if (copied) return { forModel: `Not shown: question ${i + 1} uses "${copied}" from the student's own sheet. Write new problems on the same idea with different numbers, then call quiz_me again.`, label };
      }
      // A check on a sheet topic: the one the student tapped, or a topic whose name matches the concept.
      const sheetTopic = threadKey ? ((topic && (await findTopic(db, threadKey, topic))) || (await findTopic(db, threadKey, args.data.concept))) : null;
      return {
        forModel: "Quiz shown; the student checks answers on their screen and the results are not shared with you.",
        block: {
          kind: 'quiz',
          quiz: { id: crypto.randomUUID(), topic: sheetTopic?.text ?? null, concept: args.data.concept, questions: questions.map((q) => ({ prompt: q.prompt, choices: q.choices, answerIndex: q.answer_index, explanation: q.explanation })) },
        },
        label,
      };
    }
  }
}
