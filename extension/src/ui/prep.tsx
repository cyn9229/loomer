// Test prep on a test's page (round 43, 1A). While Loomer finds the topics
// (setup), the page says so, or shows why it couldn't, with the editor: the
// topics found (remove or add), topics from notes (keep or remove), what's on
// the test (formats Canvas or the guide named are picked already), and Add
// your notes, which reads photos of paper notes. Once the plan is ready, the
// page leads with an honest readiness line (a count of topics the student got
// right on their own checks, never a grade), Start practice, the plan day by
// day back from the test, every topic with its standing (Edit opens the same
// editor), and Your mistakes.
import { useId, useRef, useState } from 'react';
import { readAttachment } from '../chat/attachments';
import type { Attachment } from '../model/chat';
import { Icon, type IconName } from './Icon';
import type { PrepFormat, PrepSessionKind, Standing, TeachBlock, TestPrep } from '../model/prep';
import { Sheet } from './sheet';
import { TeachBlockView } from './teach';
import { TopicLine } from './practice';

type PrepActions = {
  /** Starts today's practice (prep:start). */
  onStart: () => void;
  /** Build my plan: set up prep now, or retry a setup that failed (prep:setup). */
  onBuild: () => void;
  /** Practice one earlier wrong answer (prep:start with the mistake). */
  onPracticeMistake: (mistakeId: string) => void;
  /** The time the student can give this test today, in minutes (prep:time). */
  onSetTime: (minutes: number) => void;
  /** Turns the reminder for a later-today session on or off (prep:remind). */
  onRemind: (sessionId: string, on: boolean) => void;
  onEditTopics: (edit: { remove?: string[]; add?: string[]; keep?: string[] }) => void;
  onSetFormats: (formats: PrepFormat[]) => void;
  /** Photos of paper notes, read on this computer (prep:notes). */
  onAddNotes: (photos: Attachment[]) => void;
  busy: boolean;
};

export const FORMATS: { key: PrepFormat; icon: IconName; text: string }[] = [
  { key: 'mcq', icon: 'listChecks', text: 'Multiple choice' },
  { key: 'frq', icon: 'writing', text: 'Free response' },
  { key: 'vocab', icon: 'copy', text: 'Vocabulary' },
  { key: 'short', icon: 'edit', text: 'Short answer' },
  { key: 'math', icon: 'sigma', text: 'Math' },
];
const FOUND_WORD = { canvas: 'Found on Canvas', guide: 'In the study guide', notes: 'In your notes' } as const;

/** The readiness line: one small cell per topic, then Loomer's sentence. */
export function Readiness({ text, counts }: { text: string; counts: TestPrep['counts'] }) {
  const cells: Standing[] = [...Array<Standing>(counts.solid).fill('solid'), ...Array<Standing>(counts.shaky).fill('shaky'), ...Array<Standing>(counts.unchecked).fill('unchecked')];
  return (
    <p className="prep-ready">
      <span className="prep-meter" aria-hidden="true">
        {cells.map((s, i) => (
          <i key={i} className={s} />
        ))}
      </span>
      <span>{text}</span>
    </p>
  );
}

/** The test's prep on its page: setup first, then readiness, the plan, topics, and mistakes. */
export function PrepSection({ prep, actions }: { prep: TestPrep; actions: PrepActions }) {
  const [editing, setEditing] = useState(false);
  if (prep.status === 'setup')
    return (
      <section className="prep setup" aria-label="Set up test prep">
        {prep.error ? (
          <p className="status-line error">{prep.error}</p>
        ) : (
          prep.topics.length === 0 && (
            <p className="prep-k" role="status">
              <Icon name="doc" size="sm" />
              Loomer is finding the topics on this test in the study guide.
            </p>
          )
        )}
        <PrepEditor prep={prep} actions={actions} />
        {(prep.error || prep.topics.length > 0) && (
          <button type="button" className="btn-primary" disabled={actions.busy || prep.topics.length === 0} aria-busy={actions.busy} onClick={actions.onBuild}>
            {prep.error ? 'Try again' : 'Build my plan'}
            <Icon name="arrowRight" />
          </button>
        )}
      </section>
    );
  // The session to start now: today's, unless it waits for later today.
  const now = prep.plan.find((p) => p.status === 'today' && p.when !== 'later-today');
  // Practice needs the test's formats: ask while nothing was found and the student hasn't answered.
  const askFormats = Object.keys(prep.formats.found).length === 0 && !prep.formats.asked;
  return (
    <section className="prep" aria-label="Test prep">
      <Readiness text={prep.readiness} counts={prep.counts} />
      {!prep.today.asked && <TimeAsk onSet={actions.onSetTime} busy={actions.busy} />}
      {now && (
        <button type="button" className="btn-primary" disabled={actions.busy} aria-busy={actions.busy} onClick={actions.onStart}>
          {SESSION[now.kind].button}
          <Icon name="play" />
        </button>
      )}
      <div className="sec">
        <h2>Your plan</h2>
        <span className="aside">{prep.fits ?? (prep.plan.length === 1 ? '1 session' : `${prep.plan.length} sessions`)}</span>
      </div>
      <ol className="prep-sessions">
        {prep.plan.map((p) => (
          <li key={p.id} className={`prep-session ${p.status}`}>
            <span className="prep-sd" aria-hidden="true">
              {p.status === 'done' && <Icon name="check" />}
            </span>
            <span className="grow">
              <span className="prep-when">
                <b>{p.label}</b>
                <i>{minutesWords(p.minutes)}</i>
              </span>
              <span className="prep-step">{p.step}</span>
              {p.sub && <span className="prep-sub">{p.sub}</span>}
              {p.back && (
                <span className="prep-back">
                  <Icon name="repeat" size="xs" />
                  {p.back}
                </span>
              )}
              {p.remindAt && p.status !== 'done' && (
                <button type="button" role="switch" aria-checked={p.reminder} className="prep-remind" disabled={actions.busy} onClick={() => actions.onRemind(p.id, !p.reminder)}>
                  <Icon name="bell" size="xs" />
                  Remind me at {new Date(p.remindAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  <span className="prep-toggle" aria-hidden="true" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      {prep.note && (
        <p className="prep-sleep">
          <Icon name="moon" size="sm" />
          {prep.note}
        </p>
      )}
      <div className="sec">
        <h2>Topics</h2>
        <span className="aside">{prep.topics.length}</span>
        <button type="button" className="link prep-edit" aria-expanded={editing || askFormats} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing || askFormats || prep.topics.some((t) => t.new) ? (
        <div className="prep-editing">
          <PrepEditor prep={prep} actions={actions} />
        </div>
      ) : (
        <div className="prep-topics">
          {prep.topics.map((t) => (
            <TopicLine key={t.id} text={t.text} standing={t.standing} lastCheck={t.lastCheck} mixup={t.mixup} />
          ))}
        </div>
      )}
      {prep.mistakes.length > 0 && (
        <>
          <div className="sec">
            <h2>Your mistakes</h2>
            <span className="aside">{prep.mistakes.length}</span>
          </div>
          <div className="prep-mistakes">
            {prep.mistakes.map((m) => (
              <div className="prep-mistake" key={m.id}>
                <span className="grow">
                  <b>{m.label}</b>
                  <span>
                    {m.topic} · {m.sub}
                  </span>
                </span>
                <button type="button" className="link" disabled={actions.busy} onClick={() => actions.onPracticeMistake(m.id)}>
                  Practice
                </button>
              </div>
            ))}
          </div>
          <p className="prep-note">
            <Icon name="calendar" size="sm" />
            The practice test the day before brings back a question like each one you missed.
          </p>
        </>
      )}
      {prep.blocks.length > 0 && <Reread blocks={prep.blocks} />}
    </section>
  );
}

/** The topics Loomer found, topics from notes, what's on the test, and Add your notes. */
function PrepEditor({ prep, actions }: { prep: TestPrep; actions: PrepActions }) {
  const [formats, setFormats] = useState<PrepFormat[]>(prep.formats.selected);
  const [adding, setAdding] = useState(false);
  const [topic, setTopic] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fromGuide = prep.topics.filter((t) => !t.new);
  const fromNotes = prep.topics.filter((t) => t.new);

  const addNotes = async (files: File[]) => {
    setReading(true);
    setError(null);
    const results = await Promise.all(files.map((f) => readAttachment(f)));
    setReading(false);
    const photos = results.flatMap((r) => (r.ok ? [r.attachment] : []));
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) setError(failed.error);
    if (photos.length > 0) actions.onAddNotes(photos);
  };
  const addTopic = () => {
    const t = topic.trim();
    if (!t) return;
    actions.onEditTopics({ add: [t] });
    setTopic('');
    setAdding(false);
  };

  return (
    <>
      <p className="prep-k">
        <Icon name="doc" size="sm" />
        {fromGuide.length > 0 ? `Loomer found ${fromGuide.length === 1 ? '1 topic' : `${fromGuide.length} topics`} for this test.` : 'Add the topics on this test, and Loomer will plan practice for them.'}
      </p>
      <div className="prep-chips">
        {fromGuide.map((t) => (
          <span className="prep-chip" key={t.id}>
            {t.text}
            <button type="button" aria-label={`Remove ${t.text}`} title="Remove" disabled={actions.busy} onClick={() => actions.onEditTopics({ remove: [t.id] })}>
              <Icon name="x" size="xs" />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            className="prep-add-in"
            autoFocus
            value={topic}
            placeholder="A topic on the test"
            aria-label="New topic"
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTopic();
              if (e.key === 'Escape') setAdding(false);
            }}
            onBlur={() => (topic.trim() ? addTopic() : setAdding(false))}
          />
        ) : (
          <button type="button" className="prep-chip add" onClick={() => setAdding(true)}>
            <Icon name="plus" size="xs" />
            Add a topic
          </button>
        )}
      </div>

      {fromNotes.length > 0 && (
        <>
          <p className="prep-k2">{prep.notes.found ?? 'From your notes'}</p>
          {fromNotes.map((t) => (
            <div className="prep-new" key={t.id}>
              <Icon name="plus" size="xs" />
              <span className="grow">{t.text}</span>
              <button type="button" className="link" disabled={actions.busy} onClick={() => actions.onEditTopics({ keep: [t.id] })}>
                Keep
              </button>
              <button type="button" className="icon-btn" aria-label={`Remove ${t.text}`} title="Remove" disabled={actions.busy} onClick={() => actions.onEditTopics({ remove: [t.id] })}>
                <Icon name="x" size="sm" />
              </button>
            </div>
          ))}
        </>
      )}

      <p className="prep-k2">{Object.keys(prep.formats.found).length === 0 && !prep.formats.asked ? 'Canvas doesn’t say what’s on this test, so pick everything that will be on it.' : 'What’s on this test?'}</p>
      <div className="prep-formats" role="group" aria-label="What’s on this test">
        {FORMATS.map((f) => {
          const on = formats.includes(f.key);
          const found = prep.formats.found[f.key];
          return (
            <button
              key={f.key}
              type="button"
              className={on ? 'prep-format on' : 'prep-format'}
              aria-pressed={on}
              onClick={() => {
                const next = on ? formats.filter((k) => k !== f.key) : [...formats, f.key];
                setFormats(next);
                actions.onSetFormats(next);
              }}
            >
              <Icon name={f.icon} size="sm" />
              <b>{f.text}</b>
              {on && found && <span>{FOUND_WORD[found]}</span>}
            </button>
          );
        })}
      </div>

      <button type="button" className="prep-notes" disabled={reading} onClick={() => input.current?.click()}>
        <Icon name="image" />
        <span className="grow">
          <b>{reading ? 'Reading your notes…' : prep.notes.photos > 0 ? `Your notes: ${prep.notes.photos === 1 ? '1 photo' : `${prep.notes.photos} photos`}` : 'Add your notes'}</b>
          <span>{prep.notes.photos > 0 ? 'Add more photos of paper notes.' : 'Photos of paper notes help Loomer find more key terms.'}</span>
        </span>
        <Icon name="chevronRight" size="xs" />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addNotes([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {error && <p className="status-line error">{error}</p>}
      <p className="prep-priv">
        <Icon name="lock" size="xs" />
        Your photos go to the AI once to find topics, and Loomer doesn’t keep them.
      </p>
    </>
  );
}

/** Each kind of session: its label on Home and the words on its Start button. */
export const SESSION: Record<PrepSessionKind, { icon: IconName; text: string; button: string }> = {
  diagnostic: { icon: 'target', text: 'Starting your test prep', button: 'Start the diagnostic' },
  focus: { icon: 'target', text: 'From your diagnostic', button: 'Start practice' },
  'mixed-check': { icon: 'clock', text: 'Later today', button: 'Start the mixed check' },
  'practice-test': { icon: 'calendar', text: 'Practice test', button: 'Start the practice test' },
  review: { icon: 'calendar', text: 'The day before', button: 'Start review' },
  'warm-up': { icon: 'sun', text: 'Test day', button: 'Start warm-up' },
  rescue: { icon: 'sun', text: 'Test today', button: 'Start the rescue' },
};

/** "About 15 min", or "5 min" for a short one. */
function minutesWords(minutes: number): string {
  return minutes >= 10 ? `About ${minutes} min` : `${minutes} min`;
}

const TIME_CHOICES = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: 'More', minutes: 90 },
] as const;

/** Asked once a day: how much time the student can give this test. Loomer fits the plan to it and never guesses. */
function TimeAsk({ onSet, busy }: { onSet: (minutes: number) => void; busy: boolean }) {
  return (
    <section className="prep-time" aria-label="Time for today">
      <p className="prep-time-k">How much time can you give this test today?</p>
      <div className="prep-time-c" role="group" aria-label="Time for today">
        {TIME_CHOICES.map((c) => (
          <button key={c.label} type="button" disabled={busy} onClick={() => onSet(c.minutes)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="prep-time-s">Loomer fits today’s plan to your answer, and never guesses how long you need.</p>
    </section>
  );
}

const BLOCK_ICON: Record<TeachBlock['kind'], IconName> = { compare: 'layers', timeline: 'list', explain: 'doc', 'frq-skill': 'edit', visual: 'image' };

/** Teaching blocks from practice, newest first, to reread before the test. Reread opens one in a sheet. */
function Reread({ blocks }: { blocks: TeachBlock[] }) {
  const [open, setOpen] = useState<TeachBlock | null>(null);
  const titleId = useId();
  return (
    <>
      <div className="sec">
        <h2>Reread before the test</h2>
        <span className="aside">{blocks.length}</span>
      </div>
      <div className="prep-mistakes">
        {blocks.map((b) => (
          <div className="prep-mistake" key={b.id}>
            <span className="subject">
              <Icon name={BLOCK_ICON[b.kind]} />
            </span>
            <span className="grow">
              <b>{b.title}</b>
              <span>{b.topic}</span>
            </span>
            <button type="button" className="link" onClick={() => setOpen(b)}>
              Reread
            </button>
          </div>
        ))}
      </div>
      {open && (
        <Sheet labelledBy={titleId} onClose={() => setOpen(null)}>
          <div className="af">
            <div className="af-head">
              <p id={titleId} className="af-title">
                {open.topic}
              </p>
              <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={() => setOpen(null)}>
                <Icon name="x" size="sm" />
              </button>
            </div>
            <TeachBlockView block={open} lead={false} />
          </div>
        </Sheet>
      )}
    </>
  );
}
