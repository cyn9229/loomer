// Ask Loomer tools. They run in the extension over the student's local data and
// never change anything. Each returns text for the model and, for display
// tools, one validated block for the panel. Arguments are untrusted model output.
import { chatTools, type ChatToolName } from '../../../shared/chat-contract';
import { buildHomeModel, type RecommendInput } from '../analysis/recommend';
import type { LoomerDb } from '../core/db';
import type { ChatBlock } from '../model/chat';
import type { WorkItem } from '../model/home';
import { loadHomeData } from '../model/homeData';
import { cleanSvg } from './sanitize';

const MAX_INSTRUCTIONS = 6_000;
const MAX_HTML = 60_000;
const DAY_MS = 86_400_000;

export type ToolSettings = Pick<RecommendInput, 'ai' | 'choice' | 'snapshot'> & { connected: boolean };
export type ToolResult = { forModel: string; block?: ChatBlock; label: string };

const LABELS: Record<ChatToolName, string> = {
  list_work: 'Looked at your assignments',
  get_assignment: 'Read the assignment',
  get_saved_sources: 'Checked your saved pages',
  open_assignment: 'Linked an assignment',
  show_visual: 'Made a visual',
  quiz_me: 'Made a quick check',
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
    size: i.effort.label,
    checkpoints: i.checkpoints.map((c) => `${c.text}: ${day(c.at)}`),
    ai_help: i.policy.state === 'blocked' ? 'off (teacher rule)' : 'allowed',
    plan_note: i.rankReason,
  };
}

async function allItems(db: LoomerDb, settings: ToolSettings, now: Date): Promise<WorkItem[]> {
  const home = buildHomeModel({ ...(await loadHomeData(db)), ...settings, briefDismissedOn: null, now });
  if (home.status === 'not-connected') return [];
  return home.status === 'ready' ? [home.next.item, ...home.rest] : home.rest;
}

export async function runTool(db: LoomerDb, settings: ToolSettings, name: string, rawArgs: string, now: Date): Promise<ToolResult> {
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
      const items = (await allItems(db, settings, now)).filter((i) => !i.hidden && i.correction !== 'done-offline');
      const inWeek = (i: WorkItem) => {
        const t = Math.min(i.due ? Date.parse(i.due.at) : Infinity, i.startBy ? Date.parse(i.startBy.at) : Infinity);
        return t <= now.getTime() + 7 * DAY_MS;
      };
      const chosen = (args.success && args.data.range === 'all' ? items : items.filter(inWeek)).slice(0, 25);
      return { forModel: JSON.stringify({ items: chosen.map(itemSummary), shown: chosen.length, total_open: items.length }), label };
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
      const analysis = await db.analyses.get(a.id);
      return {
        forModel: JSON.stringify({
          ...itemSummary(item),
          instructions: (a.detail?.text ?? '(not readable)').slice(0, MAX_INSTRUCTIONS),
          rubric: (a.detail?.rubric ?? []).map((r) => r.description),
          plain_words: analysis?.status === 'ok' ? (analysis.plainWords ?? null) : null,
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
    case 'quiz_me': {
      const args = chatTools.quiz_me.schema.safeParse(json);
      if (!args.success) return { forModel: 'The quiz did not match the schema.', label };
      const questions = args.data.questions.filter((q) => q.answer_index < q.choices.length);
      if (questions.length === 0) return { forModel: 'Every answer index was out of range.', label };
      return {
        forModel: "Quiz shown; the student checks answers on their screen and the results are not shared with you.",
        block: {
          kind: 'quiz',
          quiz: { concept: args.data.concept, questions: questions.map((q) => ({ prompt: q.prompt, choices: q.choices, answerIndex: q.answer_index, explanation: q.explanation })) },
        },
        label,
      };
    }
  }
}
