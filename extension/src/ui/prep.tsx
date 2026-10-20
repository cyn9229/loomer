// Test prep on a test's page (round 43, 1A). While Loomer finds the topics
// (setup), the page says so, or shows why it couldn't, with the editor: the
// topics found (remove or add), topics from notes (keep or remove), what's on
// the test (formats Canvas or the guide named are picked already), and Add
// your notes, which reads photos of paper notes. Once the plan is ready, the
// page leads with an honest readiness line (a count of topics the student got
// right on their own checks, never a grade), Start practice, the plan day by
// day back from the test, every topic with its standing (Edit opens the same
// editor), and Your mistakes.
import { useRef, useState } from 'react';
import { readAttachment } from '../chat/attachments';
import type { Attachment } from '../model/chat';
import { Icon, type IconName } from './Icon';
import type { PrepFormat, Standing, TestPrep } from '../model/prep';
import { TopicLine } from './practice';

type PrepActions = {
  /** Starts today's practice (prep:start). */
  onStart: () => void;
  /** Build my plan: set up prep now, or retry a setup that failed (prep:setup). */
  onBuild: () => void;
  /** Practice one earlier wrong answer (prep:start with the mistake). */
  onPracticeMistake: (mistakeId: string) => void;
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
  const today = prep.plan.find((d) => d.status === 'today');
  // Practice needs the test's formats: ask while nothing was found and the student hasn't answered.
  const askFormats = Object.keys(prep.formats.found).length === 0 && !prep.formats.asked;
  return (
    <section className="prep" aria-label="Test prep">
      <Readiness text={prep.readiness} counts={prep.counts} />
      {today && (
        <button type="button" className="btn-primary" disabled={actions.busy} aria-busy={actions.busy} onClick={actions.onStart}>
          {today.kind === 'practice-test' ? 'Start the practice test' : today.kind === 'warm-up' ? 'Start warm-up' : 'Start practice'}
          <Icon name="play" />
        </button>
      )}
      <div className="sec">
        <h2>Your plan</h2>
        <span className="aside">{prep.plan.length === 1 ? '1 day' : `${prep.plan.length} days`}</span>
      </div>
      <ol className="prep-days">
        {prep.plan.map((d) => (
          <li key={d.date} className={`prep-day ${d.status}`}>
            <b className="prep-dd">{new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })}</b>
            <span className="prep-dm" aria-hidden="true">
              {d.status === 'done' && <Icon name="check" />}
            </span>
            <span className="grow">
              <span className="prep-step">{d.step}</span>
              <span className="prep-sub">{d.sub}</span>
            </span>
          </li>
        ))}
      </ol>
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
            <TopicLine key={t.id} text={t.text} standing={t.standing} lastCheck={t.lastCheck} />
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
