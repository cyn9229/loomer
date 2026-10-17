// Chat tab: hint-first help for the session's assignment. The student asks; Loomer
// answers with hints and questions, never finished work. No copy button on
// replies. When the AI policy is unknown, one compact question comes first.
import { useEffect, useRef, type FormEvent } from 'react';
import type { ChatMessage, HelpState } from '../model/session';
import { useAction, type PanelApi } from './api';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { Card } from './parts';
import { Reference, type ActiveSession } from './session';

const kindLabel: Record<ChatMessage['kind'], string | null> = {
  question: null,
  hint: 'Hint',
  explanation: 'Explanation',
  example: 'Example on a different topic',
  redirect: 'Let’s try this instead',
  review: 'Review',
  notice: 'Notice',
};

const followUps = ['Can you explain more?', 'Give me a smaller step'];

export function ChatView({
  session,
  api,
  draft,
  setDraft,
}: {
  session: ActiveSession;
  api: PanelApi;
  draft: string;
  setDraft: (text: string) => void;
}) {
  const { help, assignment } = session;
  const ask = useAction();
  const endRef = useRef<HTMLDivElement>(null);
  const canAsk = help.availability === 'available' && !help.pending && !ask.busy;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [help.messages.length, help.pending]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    ask.run(() => api.send({ type: 'help:ask', assignmentId: assignment.assignmentId, text: trimmed }));
    setDraft('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  const last = help.messages.at(-1);
  return (
    <div className="chat">
      <div className="chat-context">
        <Icon name="doc" size="sm" />
        <span className="grow">{assignment.title}</span>
      </div>

      <Availability help={help} assignmentId={assignment.assignmentId} api={api} />

      {help.messages.length === 0 && help.availability === 'available' && (
        <p className="caption">Ask about this assignment. Loomer starts with a small hint and never writes your work.</p>
      )}

      {help.messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}

      {help.pending && (
        <div className="msg-loomer">
          <LogoMark size={26} />
          <p className="caption" style={{ textAlign: 'left' }} role="status">
            Loomer is writing a reply
          </p>
        </div>
      )}

      {canAsk && last?.role === 'loomer' && (
        <div className="chips">
          {followUps.map((f) => (
            <button key={f} type="button" className="chip-btn" onClick={() => send(f)}>
              {f}
            </button>
          ))}
          <button
            type="button"
            className="chip-btn"
            onClick={() => ask.run(() => api.send({ type: 'help:review', assignmentId: assignment.assignmentId }))}
          >
            Review my draft
          </button>
        </div>
      )}
      {ask.error && <p className="status-line error">{ask.error}</p>}
      <div ref={endRef} />

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
            placeholder={composerPlaceholder(help)}
            disabled={help.availability !== 'available'}
            rows={1}
            maxLength={2000}
          />
        </label>
        <button type="submit" className="send-btn" aria-label="Send" disabled={!canAsk || !draft.trim()}>
          <Icon name="arrowUp" size="sm" />
        </button>
      </form>
    </div>
  );
}

function composerPlaceholder(help: HelpState): string {
  switch (help.availability) {
    case 'available':
      return help.pending ? 'Waiting for Loomer' : 'Ask for a hint';
    case 'needs-policy-answer':
      return 'Answer the question above first';
    case 'ai-off':
      return 'AI help is off';
    case 'blocked':
      return 'AI help is off for this assignment';
    case 'limited':
      return 'AI help is limited for this assignment';
    case 'unresolved':
      return 'AI help is paused for this assignment';
  }
}

/** Why help is unavailable, or the one-time policy question. */
function Availability({ help, assignmentId, api }: { help: HelpState; assignmentId: string; api: PanelApi }) {
  const answer = useAction();
  switch (help.availability) {
    case 'available':
      return null;
    case 'needs-policy-answer':
      return (
        <Card label="AI policy question">
          <p className="card-title">Does your teacher allow AI help on this assignment?</p>
          <p className="lede" style={{ marginTop: 4 }}>
            Loomer could not find a rule in the instructions or syllabus. It asks once.
          </p>
          <div className="btn-row" style={{ marginTop: 12 }}>
            {(
              [
                ['teacher-allows-help', 'Yes'],
                ['teacher-forbids-ai', 'No'],
                ['not-sure', 'Not sure'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="btn sm"
                disabled={answer.busy}
                onClick={() => answer.run(() => api.send({ type: 'policy:answer', key: assignmentId, value }))}
              >
                {label}
              </button>
            ))}
          </div>
          {answer.error && <p className="status-line error">{answer.error}</p>}
        </Card>
      );
    case 'ai-off':
      return (
        <div className="callout accent">
          <span className="tile">
            <Icon name="sparkle" size="sm" />
          </span>
          <div className="callout-body">
            <strong className="callout-title">AI help is off.</strong>
            You can turn it on in settings. Your session keeps working without it.
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn sm" onClick={api.openSettings}>
                Open settings
              </button>
            </div>
          </div>
        </div>
      );
    case 'blocked':
    case 'limited':
    case 'unresolved':
      return (
        <div className={help.availability === 'unresolved' ? 'callout accent' : 'callout amber'} role="note">
          <span className={help.availability === 'unresolved' ? 'tile' : 'tile amber'}>
            <Icon name="shield" size="sm" />
          </span>
          <div className="callout-body">
            <strong className="callout-title">
              {help.availability === 'blocked'
                ? 'AI help is off for this assignment.'
                : help.availability === 'limited'
                  ? 'AI help is limited for this assignment.'
                  : 'AI help is paused until the AI policy is clear.'}
            </strong>
            {help.policyQuote && <span className="quote">“{help.policyQuote}”</span>}
            {help.policySource && (
              <span className="source">
                <Icon name="doc" size="xs" />
                {help.policySource}
              </span>
            )}
            <p style={{ marginTop: 6 }}>Your session, draft link, and saved pages still work.</p>
          </div>
        </div>
      );
  }
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'student') {
    return <p className="bubble">{message.text}</p>;
  }
  const label = kindLabel[message.kind];
  return (
    <div className="msg-loomer">
      <LogoMark size={26} />
      <div className="card msg-card">
        {label && <span className="evidence-kind">{label}</span>}
        <p className="msg-text">{message.text}</p>
        {message.references.map((r, i) => (
          <Reference key={i} quote={r.quote} from={r.from} />
        ))}
      </div>
    </div>
  );
}
