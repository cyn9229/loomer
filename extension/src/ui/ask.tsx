// Ask Loomer: chat anywhere, not tied to a work session. A thread menu at the
// top switches between General and one thread per assignment. Replies stream
// in as blocks (Markdown, tool lines, visuals, quizzes, assignment links). An
// assignment thread follows that assignment's AI rule: blocked shows the rule
// and offers General instead; an unknown rule asks the one-time question first.
import { lazy, memo, Suspense, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { GENERAL_THREAD, type AddDraft, type Attachment, type ChatModel, type ChatTurn, type SetAsideChat, type ThreadSummary } from '../model/chat';
import type { HelpAvailability } from '../model/session';
import type { DayRoom, WorkItem } from '../model/home';
import { AddDraftCard } from './addAssignment';
import { AttachButton, AttachChips, AttachNote, DropOverlay, SentFiles, markAttachNoteSeen, useAttachments, useFileDrop } from './attach';
import { useAction, type PanelApi } from './api';
import { PolicyStep, Thinking } from './chat';
import type { BlockProps } from './chatBlocks';
import { monthDay, observedAt } from './format';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { AiServiceDown, SubjectTile } from './parts';
import { PlanChangeCard } from './planChange';
import { Sheet } from './sheet';
import { useChatScroll } from './useChatScroll';
import { usePopover } from './usePopover';

// The reply renderer (markdown, math, charts, quick checks) is the heaviest part of the panel, so it
// loads when a chat first shows; the panel also fetches it in idle time after Home paints.
const Block = lazy(() => import('./chatBlocks').then((m) => ({ default: m.Block })));

type AskProps = {
  model: ChatModel | undefined;
  threadKey: string;
  onThread: (threadKey: string) => void;
  /** Assignments the student can ask about, in plan order. */
  threads: WorkItem[];
  now: Date;
  api: PanelApi;
  onOpenItem: (assignmentId: string) => void;
  /** AI is on but the local AI service didn't answer its last health check. */
  aiDown: boolean;
  /** Home's items and day room, for plan-change cards. */
  room: DayRoom[];
  /** A work session on a quiz or test is open: Ask Loomer is paused everywhere until it ends. */
  quizOpen: boolean;
  onEndQuiz: () => void;
  /** The "working on this?" line, shown above the help box. */
  nudge?: ReactNode;
  /** Opens the add sheet with an Ask Loomer card's draft, to change it before adding. */
  onEditDraft: (draftId: string, draft: AddDraft) => void;
  /** One line at the top: which chat just opened, or that the last one was set aside. */
  notice?: ReactNode;
  /** Screenshots from the right-click "Send screenshot to Ask Loomer", waiting for the composer (chatInboxItem). */
  inbox?: ChatInbox | null;
};

/** What chatInboxItem holds. */
export type ChatInbox = { attachments: Attachment[]; error: string | null; at: string };

export function AskView({ model, threadKey, onThread, threads, now, api, onOpenItem, aiDown, room, quizOpen, onEndQuiz, nudge, onEditDraft, notice, inbox }: AskProps) {
  const [draft, setDraft] = useState('');
  const ask = useAction();
  const stop = useAction();
  const turns = model?.turns ?? [];
  const last = turns.at(-1);
  const available = model?.availability === 'available' && !quizOpen;
  const canSend = available && !model.streaming && !ask.busy;
  const scroll = useChatScroll(threadKey, turns);
  const attach = useAttachments();
  const drop = useFileDrop(attach.addFiles, available);

  // Right-click screenshots wait in the inbox: take them into the composer once, then clear it.
  const takenInbox = useRef<string | null>(null);
  useEffect(() => {
    if (!inbox || inbox.at === takenInbox.current) return;
    takenInbox.current = inbox.at;
    if (inbox.attachments.length > 0) attach.addRead(inbox.attachments);
    if (inbox.error) attach.setError(inbox.error);
    void api.send({ type: 'chat:inbox-clear' });
  }, [inbox, api]);

  const send = (text: string) => {
    const trimmed = text.trim();
    const files = attach.files;
    if ((!trimmed && files.length === 0) || !canSend || attach.reading > 0) return;
    scroll.sent();
    ask.run(async () => {
      const reply = await api.send({ type: 'chat:send', threadKey, text: trimmed, ...(files.length > 0 ? { attachments: files } : {}) });
      if (reply.ok && files.length > 0) {
        attach.clear();
        markAttachNoteSeen();
      }
      return reply;
    });
    setDraft('');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  const assignment = model?.assignment ?? threads.find((t) => t.assignmentId === threadKey) ?? null;
  const error = ask.error ?? stop.error;

  return (
    <div className="chat ask" ref={scroll.root} {...drop.handlers}>
      {drop.over && <DropOverlay />}
      {notice}
      {quizOpen ? (
        <section className="state">
          <span className="subject lg gray">
            <Icon name="pauseCircle" />
          </span>
          <h2>Ask Loomer is paused</h2>
          <p>Loomer comes back when you end your quiz session.</p>
          <button type="button" className="btn sm" onClick={onEndQuiz}>
            Go to the quiz session
          </button>
        </section>
      ) : model && model.availability !== 'available' ? (
        <NotAvailable availability={model.availability} assignment={assignment} threadKey={threadKey} api={api} onGeneral={() => onThread(GENERAL_THREAD)} />
      ) : turns.length === 0 ? (
        <Starters assignment={assignment} onAsk={send} disabled={!canSend} />
      ) : null}

      {!quizOpen && model && model.availability !== 'blocked' && <ThreadTurns model={model} now={now} api={api} items={threads} room={room} onOpenItem={onOpenItem} onEditDraft={onEditDraft} />}
      {ask.busy && last?.role !== 'loomer' && <Thinking />}
      {error && <p className="status-line error pad">{error}</p>}
      <div ref={scroll.spacer} aria-hidden="true" />

      <div className="dock">
        {nudge}
        {aiDown && available && !model.streaming && <AiServiceDown send={api.send} />}
        {available && <AttachNote attach={attach} />}
        {model?.streaming ? (
          <div className="composer writing" role="status">
            <span className="grow">Loomer is writing…</span>
            <button type="button" className="stop-btn" disabled={stop.busy} onClick={() => stop.run(() => api.send({ type: 'chat:stop', threadKey }))}>
              <Icon name="stop" size="sm" />
              Stop
            </button>
          </div>
        ) : (
          <form className="composer stack" onSubmit={submit}>
            {available && <AttachChips attach={attach} />}
            <div className="composer-row">
              {available && <AttachButton attach={attach} disabled={!canSend} />}
              <label className="grow">
                <span className="visually-hidden">Ask Loomer</span>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send(draft);
                    }
                  }}
                  onPaste={(e) => {
                    // Pasted files and images attach; pasted text stays text.
                    const files = [...e.clipboardData.files];
                    if (files.length === 0 || !available) return;
                    e.preventDefault();
                    attach.addFiles(files);
                  }}
                  placeholder={
                    quizOpen ? 'Paused during your quiz' : attach.files.length > 0 && !draft ? 'Ask about your files' : placeholder(model?.availability, turns.length > 0, assignment)
                  }
                  disabled={!available}
                  rows={1}
                  maxLength={4000}
                />
              </label>
              <button type="submit" className="send-btn" aria-label="Send" disabled={!canSend || attach.reading > 0 || (!draft.trim() && attach.files.length === 0)}>
                <Icon name="arrowUp" size="sm" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function placeholder(availability: HelpAvailability | undefined, followUp: boolean, assignment: WorkItem | null): string {
  switch (availability) {
    case undefined:
    case 'available':
      return followUp ? 'Ask a follow-up' : assignment ? 'Ask about this assignment' : 'Ask about anything';
    case 'ai-off':
      return 'AI help is off';
    case 'blocked':
      return 'No AI on this one';
    case 'limited':
      return 'AI help is limited here';
    case 'needs-policy-answer':
      return 'Answer the question above first';
    case 'unresolved':
      return 'AI help is on hold';
    case 'quiz':
      return 'No AI help on a quiz or test';
  }
}

/** A short assignment name for the menu button: the part before a colon, if that is enough. */
export function shortTitle(title: string): string {
  const head = title.split(':')[0]!.trim();
  return head.length >= 8 && head.length < title.length ? head : title;
}

/**
 * The thread switcher, the title of Ask Loomer's top bar. General first, then
 * current work (listed even before a first message), then Earlier: past due,
 * done, turned in, or hidden work that has a chat, so nothing vanishes. A
 * search field at the top (cursor already in it) filters by assignment or
 * class, and a class filter narrows to one class; either shows one flat list.
 * Keys: Ctrl K (Cmd K) opens it, arrows move, Enter opens, Escape clears the
 * search and then closes. Start fresh and the chats set aside sit at the
 * bottom. Closes on pick, Escape, or a click outside.
 */
export function ThreadMenu({
  threadKey,
  threads,
  now,
  onThread,
  onStartFresh,
  setAsideCount,
  onShowSetAside,
}: {
  threadKey: string;
  /** ChatModel.threads. */
  threads: ThreadSummary[];
  now: Date;
  onThread: (key: string) => void;
  /** Sets this chat aside (chat:set-aside). Absent when there is nothing to set aside. */
  onStartFresh?: () => void;
  setAsideCount: number;
  onShowSetAside: () => void;
}) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [course, setCourse] = useState<string | null>(null);
  const [classesOpen, setClassesOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const general = threadKey === GENERAL_THREAD;
  const current = threads.find((t) => t.threadKey === threadKey);

  const ordered = (['general', 'current', 'earlier'] as const).flatMap((g) => threads.filter((t) => t.group === g));
  const q = query.trim().toLowerCase();
  const filtering = q !== '' || course !== null;
  const visible = ordered.filter(
    (t) => (course === null || t.courseName === course) && (q === '' || threadName(t).toLowerCase().includes(q) || (t.courseName ?? '').toLowerCase().includes(q)),
  );
  const classes = [...new Set(threads.flatMap((t) => (t.courseName ? [t.courseName] : [])))];
  const optionId = (t: ThreadSummary) => `${listId}-${t.threadKey}`;
  const active = visible[Math.min(hi, visible.length - 1)];

  const openMenu = () => {
    setQuery('');
    setCourse(null);
    setClassesOpen(false);
    setHi(Math.max(0, ordered.findIndex((t) => t.threadKey === threadKey)));
    setOpen(true);
  };
  const pick = (key: string) => {
    setOpen(false);
    onThread(key);
  };
  const close = (then: () => void) => () => {
    setOpen(false);
    then();
  };

  // Ctrl K (Cmd K on a Mac) opens the switcher from anywhere in Ask Loomer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        openMenu();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (open && active) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (visible.length > 0) setHi((i) => (Math.min(i, visible.length - 1) + (e.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) pick(active.threadKey);
    } else if (e.key === 'Escape' && (query || classesOpen)) {
      // The first Escape clears; the next one reaches usePopover and closes.
      e.stopPropagation();
      setQuery('');
      setClassesOpen(false);
      setHi(0);
    }
  };

  const row = (t: ThreadSummary) => (
    <ThreadRow key={t.threadKey} id={optionId(t)} thread={t} query={q} current={t.threadKey === threadKey} highlighted={t === active} now={now} onPick={() => pick(t.threadKey)} />
  );
  const groups = [
    { key: 'general', label: null, sub: null },
    { key: 'current', label: 'Current work', sub: null },
    { key: 'earlier', label: 'Earlier', sub: 'Past due, done, or hidden' },
  ] as const;

  return (
    <div className="threads" ref={ref}>
      <button type="button" className="threadbtn" aria-haspopup="listbox" aria-expanded={open} title="Your chats (Ctrl K)" onClick={() => (open ? setOpen(false) : openMenu())}>
        {general || !current ? <Icon name="sparkle" size="sm" /> : <SubjectTile courseName={current.courseName} />}
        <span className="ellipsis">{general ? 'General' : current ? shortTitle(current.title) : 'Assignment'}</span>
        <Icon name="chevronDown" size="xs" />
      </button>
      {open && (
        <div className="pop">
          <div className="pop-find">
            <label className="pop-search">
              <Icon name="search" size="sm" />
              <input
                ref={inputRef}
                autoFocus
                type="text"
                role="combobox"
                aria-label="Search chats"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={active ? optionId(active) : undefined}
                placeholder="Search chats"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHi(0);
                }}
                onKeyDown={onKeyDown}
              />
              {query && (
                <button
                  type="button"
                  className="pop-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                >
                  <Icon name="x" size="xs" />
                </button>
              )}
            </label>
            {classes.length > 1 && (
              <button type="button" className={course ? 'pop-class on' : 'pop-class'} aria-expanded={classesOpen} onClick={() => setClassesOpen((o) => !o)}>
                <span className="ellipsis">{course ?? 'All classes'}</span>
                <Icon name="chevronDown" size="xs" />
              </button>
            )}
            {classesOpen && (
              <div className="pop-classes" role="menu" aria-label="Filter by class">
                {[null, ...classes].map((c) => (
                  <button
                    key={c ?? 'all'}
                    type="button"
                    role="menuitemradio"
                    aria-checked={course === c}
                    onClick={() => {
                      setCourse(c);
                      setClassesOpen(false);
                      setHi(0);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="grow ellipsis">{c ?? 'All classes'}</span>
                    <span className="pop-n">{c === null ? threads.filter((t) => t.courseName).length : threads.filter((t) => t.courseName === c).length}</span>
                    {course === c && <Icon name="check" size="xs" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="pop-list" id={listId} role="listbox" aria-label="Chats">
            {filtering ? (
              visible.length > 0 ? (
                <>
                  <p className="pop-k">
                    {visible.length === 1 ? '1 chat' : `${visible.length} chats`}
                    {course && <span> in {course}</span>}
                  </p>
                  {visible.map(row)}
                </>
              ) : (
                <div className="pop-none">
                  <p className="pop-none-t">{q ? `No ${course ? `${course} ` : ''}chats match “${query.trim()}”.` : `No chats in ${course}.`}</p>
                  <p className="pop-none-s">Search by assignment or class, like {classes[0] ?? 'Biology'}. You can also ask about it in General.</p>
                  <button type="button" className="link" onClick={() => pick(GENERAL_THREAD)}>
                    <Icon name="sparkle" size="xs" />
                    Ask in General
                  </button>
                </div>
              )
            ) : (
              groups.map((g) => {
                const items = visible.filter((t) => t.group === g.key);
                return (
                  items.length > 0 && (
                    <div key={g.key} role="group" aria-label={g.label ?? 'General'}>
                      {g.label && (
                        <p className="pop-k">
                          {g.label}
                          {g.sub && <span> {g.sub}</span>}
                        </p>
                      )}
                      {items.map(row)}
                    </div>
                  )
                );
              })
            )}
          </div>
          {!filtering && onStartFresh && (
            <button type="button" className="pop-new" onClick={close(onStartFresh)}>
              <Icon name="plus" size="sm" />
              Start fresh
            </button>
          )}
          {!filtering && setAsideCount > 0 && (
            <button type="button" className="pop-new" onClick={close(onShowSetAside)}>
              <Icon name="undo" size="sm" />
              {setAsideCount === 1 ? '1 chat you set aside' : `${setAsideCount} chats you set aside`}
            </button>
          )}
          <p className="pop-keys" aria-hidden="true">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd>Move
            </span>
            <span>
              <kbd>Enter</kbd>Open
            </span>
            <span>
              <kbd>Esc</kbd>Close
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

/** What a chat is called in the switcher and in search. */
function threadName(t: ThreadSummary): string {
  return t.group === 'general' ? 'General' : t.title;
}

/** The first match of `query` in `text`, marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

/** One chat in the switcher: its assignment, class, last message, and when. */
function ThreadRow({
  id,
  thread,
  query,
  current,
  highlighted,
  now,
  onPick,
}: {
  id: string;
  thread: ThreadSummary;
  query: string;
  current: boolean;
  /** The row Enter opens, moved with the arrow keys. */
  highlighted: boolean;
  now: Date;
  onPick: () => void;
}) {
  const general = thread.group === 'general';
  return (
    <button type="button" id={id} role="option" aria-selected={highlighted} className={['th', current && 'on', highlighted && 'hi'].filter(Boolean).join(' ')} tabIndex={-1} onClick={onPick}>
      {general ? (
        <span className="subject gen">
          <Icon name="sparkle" />
        </span>
      ) : (
        <SubjectTile courseName={thread.courseName} />
      )}
      <span className="item-body">
        <span className="th-top">
          <span className="item-title">
            <Marked text={threadName(thread)} query={query} />
          </span>
          {thread.lastAt && <span className="th-when">{observedAt(thread.lastAt, now)}</span>}
        </span>
        {!general && (
          <span className="item-sub">
            <Marked text={thread.courseName ?? 'No class'} query={query} />
          </span>
        )}
        <span className="th-last">{thread.lastText ?? (general ? 'Concepts, your week, anything' : 'No messages yet')}</span>
      </span>
    </button>
  );
}

/**
 * The chats the student set aside with Start fresh, newest first, from every
 * thread. Bring back (chat:restore) puts the messages back in time order, so
 * nothing is replaced.
 */
export function SetAsideSheet({ chats, onRestore, onClose }: { chats: SetAsideChat[]; onRestore: (chat: SetAsideChat) => Promise<string | null>; onClose: () => void }) {
  const titleId = useId();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restore = (chat: SetAsideChat) => {
    setBusyId(chat.id);
    setError(null);
    void onRestore(chat).then((err) => {
      setBusyId(null);
      setError(err);
    });
  };
  return (
    <Sheet labelledBy={titleId} onClose={onClose} busy={busyId !== null}>
      <div className="af">
        <div className="af-head">
          <p id={titleId} className="af-title">
            Chats you set aside
          </p>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <p className="af-sub">Bringing one back puts its messages back in order, so nothing gets replaced.</p>
        {chats.length === 0 && <p className="af-sub">There are no set-aside chats right now.</p>}
        {chats.map((c) => (
          <div className="sa-row" key={c.id}>
            <span className="grow">
              <b>{c.title}</b>
              <span className="sa-meta">
                {dateSpan(c.startedAt, c.endedAt)} · {c.count === 1 ? '1 message' : `${c.count} messages`}
              </span>
              <span className="sa-prev">{c.preview}</span>
            </span>
            <button type="button" className="link" disabled={busyId !== null} aria-busy={busyId === c.id} onClick={() => restore(c)}>
              {busyId === c.id ? 'Bringing back…' : 'Bring back'}
            </button>
          </div>
        ))}
        {error && <p className="status-line error">{error}</p>}
      </div>
    </Sheet>
  );
}

/** "Oct 9", or "Oct 14 to Oct 16" when the chat spans days. */
function dateSpan(startedAt: string, endedAt: string): string {
  const a = monthDay(startedAt);
  const b = monthDay(endedAt);
  return a === b ? a : `${a} to ${b}`;
}

const starters = {
  general: ['What’s due this week?', 'Help me plan my week', 'How should I study for a test?'],
  assignment: ['What is this asking me to do?', 'Help me break it into steps', 'Quiz me on the main ideas'],
};

/** An empty thread: one line on what to ask, and three ready questions. */
function Starters({ assignment, onAsk, disabled }: { assignment: WorkItem | null; onAsk: (text: string) => void; disabled: boolean }) {
  return (
    <section className="starters" aria-label="Ideas to ask">
      <p className="caption" style={{ padding: 0 }}>
        {assignment ? 'Loomer explains and gives hints here, but won’t write it for you.' : 'Ask about a concept, your week, or anything for school.'}
      </p>
      {(assignment ? starters.assignment : starters.general).map((text) => (
        <button key={text} type="button" className="starter" disabled={disabled} onClick={() => onAsk(text)}>
          {text}
          <Icon name="arrowRight" size="xs" />
        </button>
      ))}
    </section>
  );
}

/** Why this thread can't take questions right now, and what still works. */
function NotAvailable({
  availability,
  assignment,
  threadKey,
  api,
  onGeneral,
}: {
  availability: Exclude<HelpAvailability, 'available'>;
  assignment: WorkItem | null;
  threadKey: string;
  api: PanelApi;
  onGeneral: () => void;
}) {
  if (availability === 'needs-policy-answer') return <PolicyStep assignmentId={threadKey} api={api} />;
  if (availability === 'ai-off') {
    return (
      <section className="state">
        <span className="subject lg gray">
          <Icon name="power" />
        </span>
        <h2>Loomer’s AI is off</h2>
        <p>Turn on AI help in settings to ask questions.</p>
        <button type="button" className="btn sm" onClick={api.openSettings}>
          Open settings
        </button>
      </section>
    );
  }
  const title =
    availability === 'quiz' ? 'No AI help on a quiz or test' : availability === 'blocked' ? 'No AI on this one' : availability === 'limited' ? 'Only some AI help on this one' : 'AI help is on hold';
  const text =
    availability === 'quiz'
      ? 'Study for it before you start. Ask about the topics in General.'
      : availability === 'unresolved'
        ? 'Loomer will help once the AI rule for this assignment is clear.'
        : 'Your teacher’s rule says to do this one on your own, so Loomer won’t help with it here.';
  return (
    <section className="state">
      <span className="subject lg amber">
        <Icon name="lock" />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {assignment?.policy.quote && (
        <p className="state-quote">
          “{assignment.policy.quote}”{assignment.policy.sourceLabel && <span>{assignment.policy.sourceLabel}</span>}
        </p>
      )}
      <button type="button" className="btn sm" onClick={onGeneral}>
        <Icon name="sparkle" size="sm" />
        Ask a general question instead
      </button>
    </section>
  );
}

type ThreadTurnsProps = {
  model: ChatModel;
  /** A slice of the thread (the session's Help shows the latest few); all of it by default. */
  turns?: ChatTurn[];
  now: Date;
  api: PanelApi;
  /** Home's items and day room, for plan-change cards. */
  items: WorkItem[];
  room: DayRoom[];
  onOpenItem: (assignmentId: string) => void;
  onEditDraft: (draftId: string, draft: AddDraft) => void;
};

/**
 * A thread's turns with every block wired: plan changes, quick checks, add
 * cards, and draft checks. Ask Loomer and the session's Help both use it, so
 * one assignment's chat looks the same in both places.
 */
export function ThreadTurns({ model, turns = model.turns, now, api, items, room, onOpenItem, onEditDraft }: ThreadTurnsProps) {
  return (
    <Suspense fallback={<p className="lazy-wait">Opening your chat…</p>}>
      {turns.map((turn) => (
        <Turn
          key={turn.id}
          turn={turn}
          widgetUrl={api.widgetUrl}
          onOpenItem={onOpenItem}
          renderPlanChange={(id) => {
            const change = model.planChanges[id];
            return change ? <PlanChangeCard change={change} items={items} room={room} now={now} send={api.send} /> : null;
          }}
          onQuizAnswer={(quizId, questionIndex, correct) => void api.send({ type: 'quiz:answer', quizId, questionIndex, correct })}
          renderAddDraft={(b) => (
            <AddDraftCard
              draftId={b.draftId}
              draft={b.draft}
              addedId={model.added[b.draftId]}
              now={now}
              send={api.send}
              onEdit={() => onEditDraft(b.draftId, b.draft)}
              onOpen={onOpenItem}
            />
          )}
        />
      ))}
    </Suspense>
  );
}

type TurnProps = {
  turn: ChatTurn;
  widgetUrl: string;
  onOpenItem: (id: string) => void;
  renderPlanChange: (id: string) => ReactNode;
  onQuizAnswer: (quizId: string, questionIndex: number, correct: boolean) => void;
  renderAddDraft: BlockProps['renderAddDraft'];
};

/**
 * A finished turn never changes, so it re-renders only when its status does,
 * and only the streaming turn re-renders as a reply arrives. Plan changes and
 * add cards follow live state, so a turn with one always re-renders.
 */
const Turn = memo(TurnView, (prev, next) => {
  const live = next.turn.status === 'streaming' || next.turn.blocks.some((b) => b.kind === 'plan-change' || b.kind === 'add-assignment');
  return !live && prev.turn.id === next.turn.id && prev.turn.status === next.turn.status && prev.widgetUrl === next.widgetUrl;
});

function TurnView({
  turn,
  widgetUrl,
  onOpenItem,
  renderPlanChange,
  onQuizAnswer,
  renderAddDraft,
}: TurnProps) {
  if (turn.role === 'student') {
    const text = turn.blocks.flatMap((b) => (b.kind === 'markdown' ? [b.text] : [])).join('\n');
    const files = turn.blocks.flatMap((b) => (b.kind === 'attachment' ? [b.file] : []));
    if (files.length === 0)
      return (
        <p className="bubble" data-turn={turn.id}>
          {text}
        </p>
      );
    return (
      <div className="me-turn" data-turn={turn.id}>
        <SentFiles files={files} />
        {text.trim() && <p className="bubble">{text}</p>}
      </div>
    );
  }
  const streaming = turn.status === 'streaming';
  return (
    <div className="msg reply" data-turn={turn.id}>
      <LogoMark size={17} />
      <div className="grow aib">
        {turn.blocks.map((block, i) => (
          <Block key={i} block={block} streaming={streaming} widgetUrl={widgetUrl} onOpenItem={onOpenItem} renderPlanChange={renderPlanChange} onQuizAnswer={onQuizAnswer} renderAddDraft={renderAddDraft} />
        ))}
        {streaming && turn.blocks.length === 0 && <Thinking inline />}
        {turn.status === 'stopped' && <p className="turn-note">Stopped</p>}
        {turn.status === 'error' && (
          <p className="turn-error" role="alert">
            <Icon name="alert" size="sm" />
            {turn.error ?? 'This reply got cut off, so try asking again.'}
          </p>
        )}
      </div>
    </div>
  );
}
