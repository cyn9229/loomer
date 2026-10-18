// Ask Loomer: chat anywhere, not tied to a work session. A thread menu at the
// top switches between General and one thread per assignment. Replies stream
// in as blocks (Markdown, tool lines, visuals, quizzes, assignment links). An
// assignment thread follows that assignment's AI rule: blocked shows the rule
// and offers General instead; an unknown rule asks the one-time question first.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { GENERAL_THREAD, type ChatModel, type ChatTurn } from '../model/chat';
import type { HelpAvailability } from '../model/session';
import type { DayRoom, WorkItem } from '../model/home';
import { useAction, type PanelApi } from './api';
import { PolicyStep, Thinking } from './chat';
import { Block } from './chatBlocks';
import { dueWhen } from './format';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { AiServiceDown, SubjectTile } from './parts';
import { PlanChangeCard } from './planChange';
import { usePopover } from './usePopover';

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
};

export function AskView({ model, threadKey, onThread, threads, now, api, onOpenItem, aiDown, room, quizOpen, onEndQuiz }: AskProps) {
  const [draft, setDraft] = useState('');
  const ask = useAction();
  const stop = useAction();
  const clear = useAction();
  const endRef = useRef<HTMLDivElement>(null);
  const turns = model?.turns ?? [];
  const last = turns.at(-1);
  const available = model?.availability === 'available' && !quizOpen;
  const canSend = available && !model.streaming && !ask.busy;

  // A new turn scrolls into view; a growing reply follows only while the student is at the bottom.
  // Braces matter: Chrome's scrollIntoView now returns a Promise, and an effect must not return one.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns.length]);
  const growth = last ? last.blocks.length * 100_000 + last.blocks.reduce((n, b) => n + (b.kind === 'markdown' ? b.text.length : 1), 0) : 0;
  useLayoutEffect(() => {
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160) endRef.current?.scrollIntoView({ block: 'end' });
  }, [growth]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !canSend) return;
    ask.run(() => api.send({ type: 'chat:send', threadKey, text: trimmed }));
    setDraft('');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  const assignment = model?.assignment ?? threads.find((t) => t.assignmentId === threadKey) ?? null;
  const error = ask.error ?? stop.error ?? clear.error;

  return (
    <div className="chat ask">
      <div className="chathead">
        <ThreadMenu threadKey={threadKey} assignment={assignment} threads={threads} now={now} onThread={onThread} />
        <span className="grow" />
        {turns.length > 0 && !model?.streaming && (
          <button type="button" className="quiet-btn" disabled={clear.busy} onClick={() => clear.run(() => api.send({ type: 'chat:clear', threadKey }))}>
            <Icon name="plus" size="xs" />
            New
          </button>
        )}
      </div>

      {quizOpen ? (
        <section className="state">
          <span className="subject lg gray">
            <Icon name="pauseCircle" />
          </span>
          <h2>Ask Loomer is paused</h2>
          <p>You have a quiz or test open. Loomer comes back when you end that session.</p>
          <button type="button" className="btn sm" onClick={onEndQuiz}>
            Go to the quiz session
          </button>
        </section>
      ) : model && model.availability !== 'available' ? (
        <NotAvailable availability={model.availability} assignment={assignment} threadKey={threadKey} api={api} onGeneral={() => onThread(GENERAL_THREAD)} />
      ) : turns.length === 0 ? (
        <Starters assignment={assignment} onAsk={send} disabled={!canSend} />
      ) : null}

      {!quizOpen &&
        model?.availability !== 'blocked' &&
        turns.map((turn) => (
          <Turn
            key={turn.id}
            turn={turn}
            widgetUrl={api.widgetUrl}
            onOpenItem={onOpenItem}
            renderPlanChange={(id) => {
              const change = model?.planChanges[id];
              return change ? <PlanChangeCard change={change} items={threads} room={room} now={now} send={api.send} /> : null;
            }}
          />
        ))}
      {ask.busy && last?.role !== 'loomer' && <Thinking />}
      {error && <p className="status-line error pad">{error}</p>}
      <div ref={endRef} />

      <div className="dock">
        {aiDown && available && !model.streaming && <AiServiceDown send={api.send} />}
        {model?.streaming ? (
          <div className="composer writing" role="status">
            <span className="grow">Loomer is writing…</span>
            <button type="button" className="stop-btn" disabled={stop.busy} onClick={() => stop.run(() => api.send({ type: 'chat:stop', threadKey }))}>
              <Icon name="stop" size="sm" />
              Stop
            </button>
          </div>
        ) : (
          <form className="composer" onSubmit={submit}>
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
                placeholder={quizOpen ? 'Paused during your quiz' : placeholder(model?.availability, turns.length > 0, assignment)}
                disabled={!available}
                rows={1}
                maxLength={4000}
              />
            </label>
            <button type="submit" className="send-btn" aria-label="Send" disabled={!canSend || !draft.trim()}>
              <Icon name="arrowUp" size="sm" />
            </button>
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
function shortTitle(title: string): string {
  const head = title.split(':')[0]!.trim();
  return head.length >= 8 && head.length < title.length ? head : title;
}

/** The thread switcher: General, then each assignment. Closes on pick, Escape, or a click outside. */
function ThreadMenu({ threadKey, assignment, threads, now, onThread }: { threadKey: string; assignment: WorkItem | null; threads: WorkItem[]; now: Date; onThread: (key: string) => void }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const pick = (key: string) => {
    setOpen(false);
    onThread(key);
  };
  const general = threadKey === GENERAL_THREAD;
  return (
    <div className="threads" ref={ref}>
      <button type="button" className="threadbtn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {general || !assignment ? <Icon name="sparkle" size="sm" /> : <SubjectTile courseName={assignment.courseName} />}
        <span className="ellipsis">{general ? 'General' : assignment ? shortTitle(assignment.title) : 'Assignment'}</span>
        <Icon name="chevronDown" size="xs" />
      </button>
      {open && (
        <div className="pop" role="listbox" aria-label="Ask about">
          <button type="button" role="option" aria-selected={general} className="th" onClick={() => pick(GENERAL_THREAD)}>
            <span className="subject gen">
              <Icon name="sparkle" />
            </span>
            <span className="item-body">
              <span className="item-title">General</span>
              <span className="item-sub">Concepts, your week, anything</span>
            </span>
            {general && <Icon name="check" size="sm" />}
          </button>
          {threads.length > 0 && <p className="pop-k">About an assignment</p>}
          <div className="pop-list">
            {threads.map((t) => (
              <button type="button" role="option" aria-selected={t.assignmentId === threadKey} className="th" key={t.assignmentId} onClick={() => pick(t.assignmentId)}>
                <SubjectTile courseName={t.courseName} />
                <span className="item-body">
                  <span className="item-title">{t.title}</span>
                  <span className="item-sub">
                    {t.courseName ?? 'No class'}
                    {t.due && ` · due ${dueWhen(t.due.at, now)}`}
                  </span>
                </span>
                {t.assignmentId === threadKey && <Icon name="check" size="sm" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
        {assignment ? 'Ask about this one. Loomer explains and gives hints, but won’t write it for you.' : 'Ask about a concept, your week, or anything for school.'}
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
        <p>Turn on AI help in settings to ask questions. Your plan, sources and checklists still work.</p>
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

function Turn({ turn, widgetUrl, onOpenItem, renderPlanChange }: { turn: ChatTurn; widgetUrl: string; onOpenItem: (id: string) => void; renderPlanChange: (id: string) => ReactNode }) {
  if (turn.role === 'student') {
    const text = turn.blocks.map((b) => (b.kind === 'markdown' ? b.text : '')).join('\n');
    return <p className="bubble">{text}</p>;
  }
  const streaming = turn.status === 'streaming';
  return (
    <div className="msg reply">
      <LogoMark size={17} />
      <div className="grow aib">
        {turn.blocks.map((block, i) => (
          <Block key={i} block={block} streaming={streaming} widgetUrl={widgetUrl} onOpenItem={onOpenItem} renderPlanChange={renderPlanChange} />
        ))}
        {streaming && turn.blocks.length === 0 && <Thinking inline />}
        {turn.status === 'stopped' && <p className="turn-note">Stopped</p>}
        {turn.status === 'error' && (
          <p className="turn-error" role="alert">
            <Icon name="alert" size="sm" />
            {turn.error ?? 'This reply got cut off. Try asking again.'}
          </p>
        )}
      </div>
    </div>
  );
}
