// Renders one Ask Loomer reply block. Markdown (with math) streams in word by
// word; tool lines, visuals, quizzes, and assignment links ease in once when
// they mount. Model output is untrusted: Markdown renders without raw HTML or
// images, SVG is sanitized again here before it touches the panel, and
// interactive HTML only ever goes to the sandboxed widget page in an iframe.
import DOMPurify from 'dompurify';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import 'katex/dist/katex.min.css';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { sendWidgetHtml } from '../chat/widgetFrame';
import type { ChartSpec, ChatBlock, Quiz, Visual } from '../model/chat';
import { Icon } from './Icon';

type BlockProps = {
  block: ChatBlock;
  /** The reply is still being written: new words fade in as they arrive. */
  streaming: boolean;
  /** The sandboxed widget page (an extension page in the live panel). */
  widgetUrl: string;
  onOpenItem: (assignmentId: string) => void;
};

export function Block({ block, streaming, widgetUrl, onOpenItem }: BlockProps) {
  switch (block.kind) {
    case 'markdown':
      return <MarkdownText text={block.text} streaming={streaming} />;
    case 'tool':
      return <ToolLine label={block.label} status={block.status} />;
    case 'visual':
      return <VisualBlock visual={block.visual} widgetUrl={widgetUrl} />;
    case 'quiz':
      return <QuizCard quiz={block.quiz} />;
    case 'open-assignment':
      return (
        <button type="button" className="openas enter" onClick={() => onOpenItem(block.assignmentId)}>
          <Icon name="doc" />
          <span className="grow ellipsis">Open {block.title}</span>
          <Icon name="chevronRight" size="sm" />
        </button>
      );
  }
}

// ---------------------------------------------------------------- Markdown

/** Wraps each word in <span class="w"> so words that just arrived fade in. Skips math and code. */
function streamWords() {
  return (tree: Root) => wrap(tree);
}

function wrap(node: Root | Element): void {
  if (node.type === 'root') node.children = node.children.flatMap(splitText);
  else node.children = node.children.flatMap(splitText);
}

function splitText<T extends RootContent>(child: T): (T | ElementContent)[] {
  if (child.type === 'text') {
    return child.value
      .split(/(\s+)/)
      .filter(Boolean)
      .map((part): ElementContent => (/^\s+$/.test(part) ? { type: 'text', value: part } : { type: 'element', tagName: 'span', properties: { className: ['w'] }, children: [{ type: 'text', value: part }] }));
  }
  if (child.type === 'element' && !skipWords(child)) wrap(child);
  return [child];
}

function skipWords(el: Element): boolean {
  const cls = el.properties.className;
  return el.tagName === 'code' || el.tagName === 'pre' || (Array.isArray(cls) && cls.some((c) => String(c).startsWith('katex')));
}

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

/** Model Markdown: no raw HTML, no images (they would load from anywhere), links open in a new tab. */
function MarkdownText({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className={streaming ? 'md streaming' : 'md'}>
      <Markdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={streaming ? [rehypeKatex, streamWords] : [rehypeKatex]}
        disallowedElements={['img']}
        components={markdownComponents}
      >
        {text}
      </Markdown>
    </div>
  );
}

// ---------------------------------------------------------------- Tool lines

const toolIcon = { running: 'sparkle', done: 'check', error: 'xCircle' } as const;

/** What the AI looked at or made, as a quiet line. Running lines hold still; nothing spins. */
function ToolLine({ label, status }: { label: string; status: 'running' | 'done' | 'error' }) {
  return (
    <p className={`tool ${status} enter`} role={status === 'running' ? 'status' : undefined}>
      <Icon name={toolIcon[status]} size="xs" />
      {label}
    </p>
  );
}

// ---------------------------------------------------------------- Visuals

const visualKind: Record<Visual['type'], string> = { svg: 'Diagram', chart: 'Chart', interactive: 'Interactive' };

function VisualBlock({ visual, widgetUrl }: { visual: Visual; widgetUrl: string }) {
  return (
    <figure className="vis enter">
      <figcaption>
        <span className="grow">{visual.title}</span>
        <em>{visualKind[visual.type]}</em>
      </figcaption>
      {visual.type === 'svg' ? <SafeSvg svg={visual.svg} title={visual.title} /> : visual.type === 'chart' ? <Chart spec={visual.chart} title={visual.title} /> : <Widget html={visual.html} height={visual.height} title={visual.title} widgetUrl={widgetUrl} />}
      <p className="made">
        <Icon name="sparkle" size="xs" />
        {visual.type === 'interactive' ? 'Made by Loomer’s AI. Runs in a sandbox.' : 'Made by Loomer’s AI. Check it against your sources.'}
      </p>
    </figure>
  );
}

/**
 * Model SVG, sanitized again (the worker already stripped scripts). Style and
 * image elements are dropped so a diagram can't restyle the panel or load
 * anything. Ids get a per-diagram prefix so two diagrams' markers never
 * collide. Then the parts are staged for a one-time entrance: shapes rise in
 * one after another and open strokes (arrows, lines) draw themselves.
 */
function SafeSvg({ svg, title }: { svg: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const fragment = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['style', 'image', 'foreignObject', 'a'],
      RETURN_DOM_FRAGMENT: true,
    });
    const root = fragment.querySelector('svg');
    if (!root) {
      host.replaceChildren();
      return;
    }
    scopeIds(root, `d${prefix}-`);
    stageEntrance(root);
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', title);
    host.replaceChildren(root);
  }, [svg, title, prefix]);
  return <div className="vis-svg" ref={ref} />;
}

function scopeIds(root: SVGSVGElement, prefix: string): void {
  const ids = new Set<string>();
  root.querySelectorAll('[id]').forEach((el) => {
    ids.add(el.id);
    el.id = prefix + el.id;
  });
  if (ids.size === 0) return;
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const value = attr.value.replace(/url\(#([^)]+)\)/g, (m, id: string) => (ids.has(id) ? `url(#${prefix}${id})` : m));
      const next = (attr.name === 'href' || attr.name === 'xlink:href') && value.startsWith('#') && ids.has(value.slice(1)) ? `#${prefix}${value.slice(1)}` : value;
      if (next !== attr.value) el.setAttribute(attr.name, next);
    }
  });
}

const STROKES = new Set(['line', 'polyline', 'path']);

function stageEntrance(root: SVGSVGElement): void {
  let shape = 0;
  let stroke = 0;
  for (const el of root.children) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'defs' || tag === 'title' || tag === 'desc') continue;
    const open = STROKES.has(tag) && (tag !== 'path' || el.getAttribute('fill') === 'none');
    if (open) {
      el.setAttribute('pathLength', '1');
      el.classList.add('sv-draw');
      (el as SVGElement).style.setProperty('--d', `${320 + stroke++ * 70}ms`);
    } else {
      el.classList.add('sv-in');
      (el as SVGElement).style.setProperty('--d', `${shape++ * 70}ms`);
    }
  }
}

const SERIES_COLORS = ['var(--acc)', 'var(--ink)', 'var(--amber-dot)', 'var(--muted)'];

/** A bar or line chart drawn from the numbers alone. Bars start at zero; bars grow and lines draw once. */
function Chart({ spec, title }: { spec: ChartSpec; title: string }) {
  const W = 300;
  const H = 170;
  const left = 30;
  const right = 8;
  const top = 18;
  const bottom = 30;
  const values = spec.series.flatMap((s) => s.values);
  const max = Math.max(0, ...values);
  const min = spec.kind === 'bar' ? Math.min(0, ...values) : Math.min(...values);
  const span = max - min || 1;
  const y = (v: number) => top + (1 - (v - min) / span) * (H - top - bottom);
  const n = Math.max(1, spec.labels.length);
  const slot = (W - left - right) / n;
  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const showValues = spec.series.length === 1 && n <= 8;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      <line x1={left} x2={W - right} y1={y(Math.max(min, 0))} y2={y(Math.max(min, 0))} className="axis" />
      <text x={left - 4} y={y(max) + 3} textAnchor="end" className="tick">
        {fmt(max)}
      </text>
      {min !== 0 && (
        <text x={left - 4} y={y(min) + 3} textAnchor="end" className="tick">
          {fmt(min)}
        </text>
      )}
      {spec.kind === 'bar'
        ? spec.series.map((s, si) => {
            const w = Math.min(34, (slot * 0.7) / spec.series.length);
            return s.values.map((v, i) => {
              const x = left + i * slot + (slot - w * spec.series.length) / 2 + si * w;
              const y0 = y(Math.max(min, 0));
              return (
                <g key={`${si}-${i}`}>
                  <rect className="bar" style={{ '--d': `${i * 60 + si * 30}ms` } as CSSProperties} x={x} y={Math.min(y(v), y0)} width={Math.max(1, w - 2)} height={Math.abs(y0 - y(v))} rx={4} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
                  {showValues && (
                    <text className="val" style={{ '--d': `${250 + i * 60}ms` } as CSSProperties} x={x + (w - 2) / 2} y={y(v) - 4} textAnchor="middle">
                      {fmt(v)}
                    </text>
                  )}
                </g>
              );
            });
          })
        : spec.series.map((s, si) => {
            const points = s.values.map((v, i) => `${left + i * slot + slot / 2},${y(v)}`).join(' ');
            return (
              <g key={si}>
                <polyline className="line" style={{ '--d': `${si * 120}ms` } as CSSProperties} points={points} pathLength={1} fill="none" stroke={SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth={2} />
                {s.values.map((v, i) => (
                  <circle key={i} className="dot" style={{ '--d': `${300 + i * 50}ms` } as CSSProperties} cx={left + i * slot + slot / 2} cy={y(v)} r={2.5} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
                ))}
              </g>
            );
          })}
      {spec.labels.map((label, i) => (
        <text key={i} x={left + i * slot + slot / 2} y={H - bottom + 14} textAnchor="middle" className="tick">
          {label.length > 9 ? `${label.slice(0, 8)}…` : label}
        </text>
      ))}
      {spec.yLabel && (
        <text x={2} y={10} className="tick">
          {spec.yLabel}
        </text>
      )}
      {spec.xLabel && (
        <text x={W - right} y={H - 2} textAnchor="end" className="tick">
          {spec.xLabel}
        </text>
      )}
      {spec.series.length > 1 &&
        spec.series.map((s, si) => (
          <g key={s.name} transform={`translate(${left + si * 90}, ${H - 4})`}>
            <rect y={-7} width={8} height={8} rx={2} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
            <text x={12} className="tick">
              {s.name}
            </text>
          </g>
        ))}
    </svg>
  );
}

/**
 * An AI-made demo, run only inside the sandboxed widget page: a unique origin
 * with no extension access, storage, or network. The HTML is posted to the
 * frame once it says it's ready; it never enters the panel's own DOM.
 */
function Widget({ html, height, title, widgetUrl }: { html: string; height: number; title: string; widgetUrl: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = ref.current;
    return frame ? sendWidgetHtml(frame, html) : undefined;
  }, [html]);
  return <iframe ref={ref} className="widget" sandbox="allow-scripts" src={widgetUrl} title={title} style={{ height: Math.min(600, Math.max(120, height)) }} />;
}

// ---------------------------------------------------------------- Quiz

/** One question at a time; answers are checked here and never saved or sent. */
function QuizCard({ quiz }: { quiz: Quiz }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const total = quiz.questions.length;
  const done = index >= total && total > 0;
  const q = quiz.questions[index];

  const restart = () => {
    setIndex(0);
    setPicked(null);
    setChecked(false);
    setResults([]);
  };

  if (done) {
    const right = results.filter(Boolean).length;
    return (
      <section className="quiz enter" aria-label={`Quiz on ${quiz.concept}`}>
        <div className="qk">
          <Icon name="question" size="sm" />
          Check your understanding
        </div>
        {quiz.questions.map((question, i) => (
          <p className="qrow" key={i}>
            <span className={results[i] ? 'qn good' : 'qn bad'}>
              <Icon name={results[i] ? 'checkCircle' : 'xCircle'} size="sm" label={results[i] ? 'Right' : 'Not quite'} />
            </span>
            <span className="grow">{question.prompt}</span>
          </p>
        ))}
        <div className="qsum">
          <span className="grow">
            <b>
              {right} of {total} right.
            </b>{' '}
            Just practice. Nothing is saved or sent to your teacher.
          </span>
          <button type="button" className="link" onClick={restart}>
            Try again
          </button>
        </div>
      </section>
    );
  }
  if (!q) return null;

  const correct = picked === q.answerIndex;
  const check = () => {
    if (picked === null) return;
    setChecked(true);
    setResults((r) => [...r, correct]);
  };
  const next = () => {
    setIndex((i) => i + 1);
    setPicked(null);
    setChecked(false);
  };

  return (
    <section className="quiz enter" aria-label={`Quiz on ${quiz.concept}`}>
      <div className="qk">
        <Icon name="question" size="sm" />
        <span className="grow">Check your understanding</span>
        <span className="qcount">
          {index + 1} of {total}
        </span>
      </div>
      <p className="qp">{q.prompt}</p>
      <div role="radiogroup" aria-label={q.prompt}>
        {q.choices.map((choice, i) => {
          const state = checked ? (i === q.answerIndex ? 'right' : i === picked ? 'wrong' : '') : i === picked ? 'sel' : '';
          return (
            <button key={i} type="button" role="radio" aria-checked={picked === i} className={`choice ${state}`} disabled={checked} onClick={() => setPicked(i)}>
              {checked && i === q.answerIndex ? <Icon name="checkCircle" size="sm" /> : checked && i === picked ? <Icon name="xCircle" size="sm" /> : <span className="rad" />}
              {choice}
            </button>
          );
        })}
      </div>
      {checked && (
        <p className={correct ? 'qx ok' : 'qx bad'} role="status">
          {correct ? 'Right. ' : 'Not quite. '}
          {q.explanation}
        </p>
      )}
      <div className="qact">
        {checked ? (
          <button type="button" className="btn sm" onClick={next}>
            {index + 1 < total ? 'Next question' : 'See how you did'}
          </button>
        ) : (
          <button type="button" className="btn sm" disabled={picked === null} onClick={check}>
            Check
          </button>
        )}
      </div>
    </section>
  );
}
