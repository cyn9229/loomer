// Typed Ask Loomer fixtures for the preview panel. Each one is a ChatModel the
// logic could produce: an empty thread, a finished answer with every block
// kind, a quiz, a sandboxed widget, a blocked assignment, AI off, and the
// local AI service not running. `revealTurn` replays a finished reply step by
// step so the preview shows how replies stream in. Fixture data only.
import { GENERAL_THREAD, type ChatBlock, type ChatModel, type ChatTurn } from '../model/chat';
import type { WorkItem } from '../model/home';

const DIAGRAM = `<svg viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="11" fill="#111018">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#736f68"/></marker></defs>
<g><rect x="6" y="14" width="86" height="40" rx="9" fill="#f5f4f1"/><text x="49" y="31" text-anchor="middle">Fewer trees</text><text x="49" y="45" text-anchor="middle" fill="#736f68" font-size="9.5">less shade</text></g>
<g><rect x="107" y="14" width="86" height="40" rx="9" fill="#f5f4f1"/><text x="150" y="31" text-anchor="middle">Dark surfaces</text><text x="150" y="45" text-anchor="middle" fill="#736f68" font-size="9.5">roads, roofs</text></g>
<g><rect x="208" y="14" width="86" height="40" rx="9" fill="#f5f4f1"/><text x="251" y="31" text-anchor="middle">Stored heat</text><text x="251" y="45" text-anchor="middle" fill="#736f68" font-size="9.5">let out at night</text></g>
<g><rect x="80" y="96" width="140" height="42" rx="10" fill="#feeae2"/><text x="150" y="114" text-anchor="middle" font-weight="600">Hotter city</text><text x="150" y="129" text-anchor="middle" fill="#c2380a" font-size="9.5">than the countryside</text></g>
<path d="M49 54 C49 80 110 80 120 94" fill="none" stroke="#736f68" stroke-width="1.5" marker-end="url(#arrow)"/>
<path d="M150 54v38" fill="none" stroke="#736f68" stroke-width="1.5" marker-end="url(#arrow)"/>
<path d="M251 54 C251 80 190 80 180 94" fill="none" stroke="#736f68" stroke-width="1.5" marker-end="url(#arrow)"/>
</svg>`;

const WIDGET = `<!doctype html><html><head><style>
body{margin:0;padding:14px;font:14px system-ui,sans-serif;color:#111018}
input{width:100%;accent-color:#fc4811}
.row{display:flex;justify-content:space-between;margin-top:6px;color:#55524c;font-size:13px}
.street{position:relative;height:46px;margin-top:12px;border-radius:8px;background:#fde3d6;overflow:hidden}
.shade{position:absolute;inset:0 auto 0 0;background:#cfe3c4}
b{color:#111018}
</style></head><body>
<label for="t">Tree cover on your block</label>
<input id="t" type="range" min="0" max="60" value="20">
<div class="row"><span id="v">20%</span><span>Shade on the street: <b id="s">some</b></span></div>
<div class="street"><div class="shade" id="sh"></div></div>
<script>
const t=document.getElementById('t');
function draw(){const n=+t.value;document.getElementById('v').textContent=n+'%';document.getElementById('s').textContent=n<15?'very little':n<35?'some':'a lot';document.getElementById('sh').style.width=Math.min(100,n*1.6)+'%';}
t.addEventListener('input',draw);draw();
</script></body></html>`;

const ANSWER: ChatBlock[] = [
  { kind: 'tool', label: 'Read the assignment', status: 'done' },
  { kind: 'tool', label: 'Checked your saved pages', status: 'done' },
  {
    kind: 'markdown',
    text: 'Cities run hotter mainly because **fewer trees means less shade**, and **dark roads and roofs soak up sun** and give the heat back at night.\n\nScientists write the difference as $\\Delta T = T_{city} - T_{rural}$.',
  },
  { kind: 'visual', visual: { type: 'svg', title: 'How a heat island forms', svg: DIAGRAM } },
  {
    kind: 'visual',
    visual: {
      type: 'chart',
      title: 'Surface temperature by tree cover',
      chart: { kind: 'bar', labels: ['0–10%', '10–20%', '20–30%', '30–40%', '40%+'], series: [{ name: 'Temp', values: [98, 95, 92, 89, 86] }], xLabel: 'Tree cover', yLabel: '°F' },
    },
  },
  { kind: 'markdown', text: 'Your tree canopy report measures the first cause directly. Want a quick quiz on this?' },
];

const QUIZ: ChatBlock = {
  kind: 'quiz',
  quiz: {
    concept: 'Urban heat islands',
    questions: [
      {
        prompt: 'Which cause of the heat-island effect does a tree canopy report measure directly?',
        choices: ['How dark roads and roofs are', 'How much shade trees give', 'How much heat buildings let out at night', 'How many cars drive through'],
        answerIndex: 1,
        explanation: 'Canopy is the area trees cover, which is about shade.',
      },
      {
        prompt: 'Why do cities stay warm after sunset?',
        choices: ['Streetlights give off heat', 'Pavement and buildings let out heat they stored', 'There is less wind at night'],
        answerIndex: 1,
        explanation: 'Dark surfaces store heat during the day and release it at night.',
      },
      {
        prompt: 'What does ΔT compare?',
        choices: ['City and rural temperature', 'Day and night temperature', 'Summer and winter temperature'],
        answerIndex: 0,
        explanation: 'ΔT is the city temperature minus the rural temperature.',
      },
    ],
  },
};

function turns(now: Date, pairs: [string, ChatBlock[], Partial<ChatTurn>?][]): ChatTurn[] {
  return pairs.flatMap(([question, reply, over], i) => [
    { id: i * 2 + 1, role: 'student' as const, blocks: [{ kind: 'markdown' as const, text: question }], status: 'done' as const, createdAt: new Date(now.getTime() - 60_000).toISOString() },
    { id: i * 2 + 2, role: 'loomer' as const, blocks: reply, status: 'done' as const, createdAt: now.toISOString(), ...over },
  ]);
}

export function buildChatFixtures(now: Date, items: WorkItem[]) {
  const general = (over: Partial<ChatModel>): ChatModel => ({ threadKey: GENERAL_THREAD, assignment: null, availability: 'available', turns: [], streaming: false, ...over });
  const essay = items.find((i) => i.assignmentId === 'a-essay') ?? null;
  const blocked = items.find((i) => i.policy.state === 'blocked') ?? null;
  return {
    empty: general({}),
    answer: general({ turns: turns(now, [['why do cities get hotter than the countryside?', ANSWER]]) }),
    quiz: general({ turns: turns(now, [['quiz me on this', [{ kind: 'markdown', text: 'Three quick questions on **urban heat islands**.' }, QUIZ]]]) }),
    widget: general({
      turns: turns(now, [
        [
          'can you show how shade changes with tree cover?',
          [
            { kind: 'tool', label: 'Made a visual', status: 'done' },
            { kind: 'markdown', text: 'Try it: drag the slider and watch the shade on the street change.' },
            { kind: 'visual', visual: { type: 'interactive', title: 'Tree cover and shade', html: WIDGET, height: 160 } },
            ...(essay ? [{ kind: 'open-assignment' as const, assignmentId: essay.assignmentId, title: essay.title }] : []),
          ],
        ],
      ]),
    }),
    assignment: {
      threadKey: essay?.assignmentId ?? 'a-essay',
      assignment: essay,
      availability: 'available',
      turns: [],
      streaming: false,
    } satisfies ChatModel,
    blocked: { threadKey: blocked?.assignmentId ?? 'a-reflection', assignment: blocked, availability: 'blocked', turns: [], streaming: false } satisfies ChatModel,
    'policy-question': { threadKey: essay?.assignmentId ?? 'a-essay', assignment: essay, availability: 'needs-policy-answer', turns: [], streaming: false } satisfies ChatModel,
    'ai-off': general({ availability: 'ai-off' }),
    'service-down': general({
      turns: turns(now, [
        ['what is a thesis statement?', [], { status: 'error', error: 'Loomer’s AI service isn’t running on this computer. Start it with npm run dev:server, then try again.' }],
      ]),
    }),
    stopped: general({ turns: turns(now, [['explain photosynthesis', [{ kind: 'markdown', text: 'Plants turn light, water and carbon dioxide into' }], { status: 'stopped' }]]) }),
  } satisfies Record<string, ChatModel>;
}

export type ChatFixtureName = keyof ReturnType<typeof buildChatFixtures> | 'streaming';

/** Steps in the streaming replay of the "answer" fixture. */
export const STREAM_STEPS = 64;

/**
 * The "answer" reply as it would look `step` ticks into streaming: tool lines
 * run then finish, the text arrives a few words at a time, each visual lands
 * whole, then the closing line.
 */
export function revealTurn(model: ChatModel, step: number): ChatModel {
  const reply = model.turns.at(-1);
  if (!reply || step >= STREAM_STEPS) return model;
  const blocks: ChatBlock[] = [];
  let budget = step;
  for (const block of reply.blocks) {
    if (budget <= 0) break;
    if (block.kind === 'markdown') {
      const words = block.text.split(' ');
      const shown = Math.min(words.length, budget * 3);
      blocks.push({ kind: 'markdown', text: words.slice(0, shown).join(' ') });
      budget -= Math.ceil(words.length / 3);
    } else if (block.kind === 'tool') {
      blocks.push({ ...block, status: budget > 3 ? 'done' : 'running' });
      budget -= 4;
    } else {
      blocks.push(block);
      budget -= 8;
    }
  }
  return { ...model, streaming: true, turns: [...model.turns.slice(0, -1), { ...reply, blocks, status: 'streaming' }] };
}
