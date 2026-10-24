// Test prep on a test's page. While Loomer finds the topics
// (setup), the page says so, or shows why it couldn't, with the editor: the
// topics found (remove or add), topics from notes (keep or remove), what's on
// the test (formats Canvas or the guide named are picked already), and Add
// your notes, which reads photos of paper notes. Once the plan is ready, the
// page leads with "4 of 8 ready" over one thin bar (topics the student's own
// checks made ready for the test, never a grade), Start practice, and the plan
// as one row per session (its title, and the topics or formats under it). Topics, mistakes, and rereads fold to one row each
//; opened, each topic is one thin bar from its progress, and a
// mix-up keeps its mark. The skill ladder behind progress never shows.
import { useId, useRef, useState, type ReactNode } from 'react';
import { readAttachment } from '../chat/attachments';
import type { Attachment } from '../model/chat';
import { Icon, type IconName } from './Icon';
import type { PrepFormat, PrepSession, TeachBlock, TestPrep } from '../model/prep';
import { Sheet } from './sheet';
import { TeachBlockView } from './teach';
import { TopicLine } from './practice';
import { START_WORDS } from './prepWords';
import { WaitLine, WaitOutline, WaitSteps } from './wait';

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

/** "4 of 8 ready" over one thin bar of the ready share, full only when every topic is ready. */
export function ReadyBar({ counts }: { counts: TestPrep['counts'] }) {
  const total = counts.solid + counts.shaky + counts.unchecked;
  return (
    <div className="prep-ready">
      <b>
        {counts.solid} of {total} ready
      </b>
      <span className="tbar wide" role="progressbar" aria-label="Topics ready" aria-valuemin={0} aria-valuemax={total} aria-valuenow={counts.solid}>
        <i style={{ transform: `scaleX(${total > 0 ? counts.solid / total : 0})` }} />
      </span>
    </div>
  );
}

/** One row that opens in place: a name, a short count, and a chevron. */
function Fold({ name, count, open, onToggle, children }: { name: string; count: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="prep-fold" aria-label={name}>
      <button type="button" className="prep-fold-row" aria-expanded={open} onClick={onToggle}>
        <b>{name}</b>
        <span className="grow">{count}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size="sm" />
      </button>
      {open && <div className="prep-fold-body">{children}</div>}
    </section>
  );
}

/** A session's when, in a word or two: Done, Now, Next, 7 PM, or its day. */
function whenWord(p: PrepSession): string {
  if (p.status === 'done') return 'Done';
  if (p.status === 'missed') return 'Missed';
  if (p.when === 'now') return 'Now';
  if (p.when === 'next') return 'Next';
  if (p.remindAt) return new Date(p.remindAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return p.label;
}

/** The test's prep on its page: setup first, then readiness, the plan, topics, and mistakes. */
export function PrepSection({ prep, actions }: { prep: TestPrep; actions: PrepActions }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<'topics' | 'mistakes' | 'reread' | null>(null);
  if (prep.status === 'setup')
    return (
      <section className="prep setup" aria-label="Set up test prep">
        {prep.error ? (
          <p className="status-line error">{prep.error}</p>
        ) : prep.pending ? (
          // Setup shows its real steps; reading notes photos is one line.
          <div className="prep-wait">
            {prep.pending.steps ? <WaitSteps pending={prep.pending} /> : <WaitLine pending={prep.pending} />}
            {prep.topics.length === 0 && <WaitOutline shape="rows" />}
          </div>
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
  // Editing, a format question, or topics just found in notes keep Topics open: each needs the student.
  const needsEditor = editing || askFormats || prep.topics.some((t) => t.new);
  const topicsOpen = open === 'topics' || needsEditor;
  const needWork = prep.topics.filter((t) => t.standing !== 'solid').length;
  // Mix-ups first, then what still needs work, then ready topics.
  const topics = [...prep.topics].sort((a, b) => Number(b.mixup) - Number(a.mixup) || Number(a.standing === 'solid') - Number(b.standing === 'solid'));
  const toggle = (fold: 'topics' | 'mistakes' | 'reread') => setOpen((o) => (o === fold ? null : fold));
  return (
    <section className="prep" aria-label="Test prep">
      <ReadyBar counts={prep.counts} />
      {prep.pending && (
        <div className="prep-wait">
          <WaitLine pending={prep.pending} />
        </div>
      )}
      {!prep.today.asked && <TimeAsk onSet={actions.onSetTime} busy={actions.busy} />}
      {now && (
        <button type="button" className="btn-primary" disabled={actions.busy} aria-busy={actions.busy} onClick={actions.onStart}>
          {START_WORDS[now.kind]}
          <Icon name="play" />
        </button>
      )}
      <div className="sec">
        <h2>Your plan</h2>
        <span className="aside">{prep.fits ?? (prep.plan.length === 1 ? '1 session' : `${prep.plan.length} sessions`)}</span>
      </div>
      <ol className="prep-lines">
        {prep.plan.map((p) => {
          const at = p.remindAt ? new Date(p.remindAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;
          return (
            <li key={p.id} className={`prep-line ${p.status}${p === now ? ' now' : ''}`}>
              <span className="prep-sd" aria-hidden="true">
                {p.status === 'done' && <Icon name="check" />}
              </span>
              <span className="grow">
                <span className="prep-lt">{p.step}</span>
                {p.detail && <span className="prep-ld">{p.detail}</span>}
              </span>
              <span className="prep-lw">{whenWord(p)}</span>
              {at && p.status !== 'done' && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.reminder}
                  className="prep-bell"
                  aria-label={`Remind me at ${at}`}
                  title={p.reminder ? `Reminder on for ${at}` : `Remind me at ${at}`}
                  disabled={actions.busy}
                  onClick={() => actions.onRemind(p.id, !p.reminder)}
                >
                  <Icon name="bell" size="xs" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <Fold
        name="Topics"
        count={needWork === 0 ? 'All ready' : `${needWork} need work`}
        open={topicsOpen}
        onToggle={() => {
          if (topicsOpen) setEditing(false);
          toggle('topics');
        }}
      >
        {needsEditor ? (
          <div className="prep-editing">
            <PrepEditor prep={prep} actions={actions} />
          </div>
        ) : (
          <div className="prep-topics flat">
            {topics.map((t) => (
              <TopicLine key={t.id} text={t.text} standing={t.standing} lastCheck={t.lastCheck} mixup={t.mixup} progress={t.progress} elsewhere={t.elsewhere?.text ?? null} />
            ))}
          </div>
        )}
        <button type="button" className="link prep-edit" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit topics'}
        </button>
      </Fold>
      {prep.mistakes.length > 0 && (
        <Fold name="Mistakes" count={String(prep.mistakes.length)} open={open === 'mistakes'} onToggle={() => toggle('mistakes')}>
          <div className="prep-mistakes flat">
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
        </Fold>
      )}
      {prep.blocks.length > 0 && (
        <Fold name="Reread" count={String(prep.blocks.length)} open={open === 'reread'} onToggle={() => toggle('reread')}>
          <Reread blocks={prep.blocks} />
        </Fold>
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
      <div className="prep-mistakes flat">
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
