// Help, inside the Working screen: the assignment's one conversation, the same
// thread Ask Loomer shows for it (chat:send with the assignment as threadKey),
// in a compact form with the latest few messages and Open in Ask Loomer. Shaped
// by its kind of work: writing is hint-first with draft follow-ups (Check my
// draft writes a draft check into the thread); practice, study and reading get
// their own ready questions. When a session is new, up to two numbered steps
// come first (which Doc is your draft, and the one-time AI rule question). Then
// the proactive hint, the conversation, quick follow-ups, and a docked
// composer with the research suggestion above it. The composer stays disabled
// until help is available.
import { useState, type FormEvent, type ReactNode } from 'react';
import type { AddDraft, ChatModel } from '../model/chat';
import type { DayRoom, WorkItem } from '../model/home';
import type { HelpState } from '../model/session';
import { useAction, type PanelApi } from './api';
import { ThreadTurns } from './ask';
import { Icon } from './Icon';
import { LinkDocStep, type ActiveSession } from './session';
import { useChatScroll } from './useChatScroll';
import { useElapsedSeconds } from './useNow';
import { askHint, typeCaption, typePrompts } from './workType';

/** How many of the latest turns the compact view shows before "N earlier messages". */
const RECENT = 4;

type ChatViewProps = {
  session: ActiveSession;
  /** The assignment's thread (useChat with its assignment id). */
  chat: ChatModel | undefined;
  api: PanelApi;
  now: Date;
  draft: string;
  setDraft: (text: string) => void;
  /** The study trail (round 47): the ask, the site picker, and what Loomer noticed, rendered by the panel. */
  trail: ReactNode;
  /** The proactive hint, rendered by the panel. */
  hint: ReactNode;
  /** The research suggestion line, rendered by the panel. */
  suggestion: ReactNode;
  /** Home's items and day room, for plan-change cards in the thread. */
  items: WorkItem[];
  room: DayRoom[];
  onOpenItem: (assignmentId: string) => void;
  onEditDraft: (draftId: string, draft: AddDraft) => void;
  /** Opens this thread in Ask Loomer. */
  onOpenAsk: () => void;
};

export function ChatView({ session, chat, api, now, draft, setDraft, trail, hint, suggestion, items, room, onOpenItem, onEditDraft, onOpenAsk }: ChatViewProps) {
  const { help, assignment, doc } = session;
  const threadKey = assignment.assignmentId;
  const ask = useAction();
  const stop = useAction();
  const [showAll, setShowAll] = useState(false);
  const turns = chat?.turns ?? [];
  const last = turns.at(-1);
  const busy = Boolean(chat?.streaming) || help.reviewPending || ask.busy;
  const canAsk = help.availability === 'available' && !busy;
  const shown = showAll ? turns : turns.slice(-RECENT);
  const earlier = turns.length - shown.length;

  const scroll = useChatScroll(threadKey, turns);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    scroll.sent();
    ask.run(() => api.send({ type: 'chat:send', threadKey, text: trimmed }));
    setDraft('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  // Writing needs its draft linked. Practice and study offer "your own copy" in the header instead; reading links nothing.
  const type = assignment.workType.type;
  const needsDoc = doc.status === 'not-linked' && type === 'writing';
  const needsPolicy = help.availability === 'needs-policy-answer';
  const steps = Number(needsDoc) + Number(needsPolicy);

  return (
    <div className="chat" ref={scroll.root}>
      {needsDoc && <LinkDocStep n={steps > 1 ? 1 : undefined} assignmentId={assignment.assignmentId} candidates={doc.candidates} api={api} />}
      {needsPolicy && <PolicyStep n={steps > 1 ? 2 : undefined} assignmentId={assignment.assignmentId} api={api} />}
      {steps > 0 && (
        <p className="note">
          <Icon name="lock" />
          Loomer only reads your Doc while you’re working on it.
        </p>
      )}

      {trail}
      {hint}
      <Unavailable help={help} api={api} />

      {turns.length === 0 && help.availability === 'available' && steps === 0 && !hint && <p className="caption">{typeCaption[type]}</p>}

      {turns.length > 0 && (
        <>
          {hint && <div className="rule" />}
          <div className="emb-head">
            <span className="grow">
              <Icon name="chat" size="xs" />
              Your chat about {session.recap.noun}
            </span>
            <button type="button" className="link" onClick={onOpenAsk}>
              <Icon name="external" size="xs" />
              Open in Ask Loomer
            </button>
          </div>
          {earlier > 0 && (
            <button type="button" className="emb-earlier" onClick={() => setShowAll(true)}>
              <Icon name="clock" size="xs" />
              {earlier === 1 ? '1 earlier message' : `${earlier} earlier messages`}
            </button>
          )}
          {chat && <ThreadTurns model={chat} turns={shown} now={now} api={api} items={items} room={room} onOpenItem={onOpenItem} onEditDraft={onEditDraft} />}
        </>
      )}

      {ask.busy && last?.role !== 'loomer' && <Thinking />}

      {canAsk && type !== 'writing' && (turns.length === 0 || last?.role === 'loomer') && (
        <div className="qr">
          {typePrompts[type].map((text) => (
            <button key={text} type="button" className="btn sm" onClick={() => send(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
      {canAsk && type === 'writing' && last?.role === 'loomer' && (
        <div className="qr">
          <button type="button" className="btn sm" onClick={() => send('Can you explain more?')}>
            Explain more
          </button>
          <button type="button" className="btn sm" onClick={() => send('Give me a smaller step')}>
            Smaller step
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              scroll.sent();
              ask.run(() => api.send({ type: 'help:review', assignmentId: assignment.assignmentId }));
            }}
          >
            Check my draft
          </button>
        </div>
      )}
      {(ask.error ?? stop.error) && <p className="status-line error pad">{ask.error ?? stop.error}</p>}
      <div ref={scroll.spacer} aria-hidden="true" />

      <div className="dock">
        {suggestion}
        {chat?.streaming ? (
          <div className="composer writing" role="status">
            <span className="grow">Loomer is writing a reply.</span>
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
                    if (canAsk) send(draft);
                  }
                }}
                placeholder={help.availability === 'available' ? (busy ? 'Waiting for Loomer…' : askHint[type]) : composerPlaceholder(help)}
                disabled={help.availability !== 'available'}
                rows={1}
                maxLength={2000}
              />
            </label>
            <button type="submit" className="send-btn" aria-label="Send" disabled={!canAsk || !draft.trim()}>
              <Icon name="arrowUp" size="sm" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Shown while a reply is in flight: a plain seconds counter, no spinner. `inline` sits inside a reply. */
export function Thinking({ inline }: { inline?: boolean }) {
  const seconds = useElapsedSeconds(true);
  return (
    <p className={inline ? 'thinking inline' : 'thinking'} role="status">
      Loomer is thinking…<span aria-hidden="true">{seconds > 0 ? ` ${seconds} s` : ''}</span>
    </p>
  );
}

function composerPlaceholder(help: HelpState): string {
  switch (help.availability) {
    case 'available':
      return 'Ask for a hint';
    case 'needs-policy-answer':
      return 'Answer the question above first';
    case 'ai-off':
      return 'AI help is off';
    case 'blocked':
      return 'No AI on this one';
    case 'limited':
      return 'AI help is limited here';
    case 'unresolved':
      return 'AI help is on hold';
    case 'quiz':
      return 'No AI help on a quiz or test';
  }
}

/** The one-time question when no AI rule was found. */
export function PolicyStep({ n, assignmentId, api }: { n?: number; assignmentId: string; api: PanelApi }) {
  const answer = useAction();
  const [saving, setSaving] = useState<string | null>(null);
  const choices = [
    ['teacher-allows-help', 'Yes, it’s allowed'],
    ['teacher-forbids-ai', 'No AI on this one'],
    ['not-sure', 'Not sure'],
  ] as const;
  return (
    <section className="step" aria-label="AI rule question">
      <span className="num">{n ?? '?'}</span>
      <div className="grow">
        <div className="step-t">Does your teacher allow AI help on this one?</div>
        <div className="step-s">Loomer couldn’t find a rule in the instructions or syllabus.</div>
        <div className="choices">
          {choices.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="btn"
              disabled={answer.busy}
              aria-busy={saving === value}
              onClick={() => {
                setSaving(value);
                answer.run(() => api.send({ type: 'policy:answer', key: assignmentId, value }).finally(() => setSaving(null)));
              }}
            >
              {saving === value ? 'Saving…' : label}
            </button>
          ))}
        </div>
        {answer.error && <p className="status-line error" style={{ marginTop: 6 }}>{answer.error}</p>}
      </div>
    </section>
  );
}

/** Why help isn't available here. The session, draft link, and sources still work. */
function Unavailable({ help, api }: { help: HelpState; api: PanelApi }) {
  switch (help.availability) {
    case 'available':
    case 'needs-policy-answer':
      return null;
    case 'ai-off':
      return (
        <section className="hint" aria-label="AI help is off">
          <div className="hint-k" style={{ color: 'var(--muted)' }}>
            <Icon name="sparkle" />
            AI help is off
          </div>
          <p className="hint-text">Turn on AI help in settings to get hints.</p>
          <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={api.openSettings}>
            Open settings
          </button>
        </section>
      );
    case 'blocked':
    case 'limited':
    case 'unresolved':
      return (
        <section className="hint" role="note" aria-label="AI rule">
          <div className="hint-k" style={{ color: 'var(--amber)' }}>
            <Icon name="lock" />
            {help.availability === 'blocked' ? 'No AI on this one' : help.availability === 'limited' ? 'Only some AI help on this one' : 'AI help is on hold'}
          </div>
          <p className="hint-text">
            {help.availability === 'unresolved' ? 'Loomer will help once the AI rule is clear.' : 'Loomer won’t help with the writing here, because of this rule.'}
          </p>
          {help.policyQuote && (
            <p className="reference">
              “{help.policyQuote}” {help.policySource && <span style={{ color: 'var(--muted)' }}>{help.policySource}</span>}
            </p>
          )}
          <p className="note" style={{ padding: '12px 0 0' }}>
            You can still save sources and keep your work together here.
          </p>
        </section>
      );
  }
}
