// Chat tab: hint-first help for the session's assignment. When a session is new,
// up to two numbered steps come first (which Doc is your draft, and the one-time
// AI rule question). Then the proactive hint, the conversation, quick follow-up
// chips, and a docked composer with the research suggestion above it. Loomer
// answers with hints and questions, never finished work; replies have no copy button.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ChatMessage, HelpState } from '../model/session';
import { useAction, type PanelApi } from './api';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { LinkDocStep, Reference, type ActiveSession } from './session';
import { useElapsedSeconds } from './useNow';

const kindLabel: Record<ChatMessage['kind'], string> = {
  question: 'Loomer',
  hint: 'Hint',
  explanation: 'Explanation',
  example: 'Example on a different topic',
  redirect: 'Let’s try this instead',
  review: 'Feedback',
  notice: 'Heads up',
};

export function ChatView({
  session,
  api,
  draft,
  setDraft,
  hint,
  suggestion,
}: {
  session: ActiveSession;
  api: PanelApi;
  draft: string;
  setDraft: (text: string) => void;
  /** The proactive hint card or row, rendered by the panel. */
  hint: ReactNode;
  /** The research suggestion row, rendered by the panel. */
  suggestion: ReactNode;
}) {
  const { help, assignment, doc } = session;
  const ask = useAction();
  const endRef = useRef<HTMLDivElement>(null);
  const canAsk = help.availability === 'available' && !help.pending && !ask.busy;
  const thinking = help.pending || ask.busy;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [help.messages.length, thinking]);

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

  const needsDoc = doc.status === 'not-linked';
  const needsPolicy = help.availability === 'needs-policy-answer';
  const steps = Number(needsDoc) + Number(needsPolicy);
  const last = help.messages.at(-1);

  return (
    <div className="chat">
      {needsDoc && <LinkDocStep n={steps > 1 ? 1 : undefined} assignmentId={assignment.assignmentId} candidates={doc.candidates} api={api} />}
      {needsPolicy && <PolicyStep n={steps > 1 ? 2 : undefined} assignmentId={assignment.assignmentId} api={api} />}
      {steps > 0 && (
        <p className="note">
          <Icon name="lock" />
          Loomer only reads your Doc while you’re working on it.
        </p>
      )}

      {hint}
      <Unavailable help={help} api={api} />

      {help.messages.length === 0 && help.availability === 'available' && steps === 0 && (
        <p className="caption">Stuck? Ask about this assignment. Loomer starts with a small hint and never writes it for you.</p>
      )}

      {help.messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}

      {thinking && <Thinking />}

      {canAsk && last?.role === 'loomer' && (
        <div className="chips">
          <button type="button" className="chip" onClick={() => send('Can you explain more?')}>
            Explain more
          </button>
          <button type="button" className="chip" onClick={() => send('Give me a smaller step')}>
            Smaller step
          </button>
          <button type="button" className="chip" onClick={() => ask.run(() => api.send({ type: 'help:review', assignmentId: assignment.assignmentId }))}>
            Check my draft
          </button>
        </div>
      )}
      {ask.error && <p className="status-line error">{ask.error}</p>}
      <div ref={endRef} />

      <div className="dock">
        {suggestion}
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
    </div>
  );
}

/** Shown while a reply is in flight: a plain seconds counter, no spinner. */
function Thinking() {
  const seconds = useElapsedSeconds(true);
  return (
    <p className="thinking" role="status">
      Loomer is thinking…<span aria-hidden="true">{seconds > 0 ? ` ${seconds} s` : ''}</span>
    </p>
  );
}

function composerPlaceholder(help: HelpState): string {
  switch (help.availability) {
    case 'available':
      return help.pending ? 'Waiting for Loomer…' : 'Ask for a hint';
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
  }
}

/** The one-time question when no AI rule was found. */
function PolicyStep({ n, assignmentId, api }: { n?: number; assignmentId: string; api: PanelApi }) {
  const answer = useAction();
  const [saving, setSaving] = useState<string | null>(null);
  const choices = [
    ['teacher-allows-help', 'Yes, it’s allowed'],
    ['teacher-forbids-ai', 'No AI on this one'],
    ['not-sure', 'Not sure'],
  ] as const;
  return (
    <section className="step" aria-label="AI rule question">
      {n !== undefined && <span className="num">{n}</span>}
      <div className="grow">
        <div className="step-t">Does your teacher allow AI help on this one?</div>
        <div className="step-s">We couldn’t find a rule in the instructions or syllabus.</div>
        <div className="choices">
          {choices.map(([value, label]) => (
            <button
              key={value}
              type="button"
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
        <div className="block">
          <div className="block-k">
            <Icon name="sparkle" />
            AI help is off
          </div>
          <p className="block-text">Turn it on in settings to get hints. Everything else still works.</p>
          <div className="block-act">
            <button type="button" className="btn sm on-tint" onClick={api.openSettings}>
              Open settings
            </button>
          </div>
        </div>
      );
    case 'blocked':
    case 'limited':
    case 'unresolved':
      return (
        <div className={help.availability === 'unresolved' ? 'block violet' : 'block amber'} role="note">
          <div className="block-k">
            <Icon name="lock" />
            {help.availability === 'blocked' ? 'No AI on this one' : help.availability === 'limited' ? 'Only some AI help on this one' : 'AI help is on hold'}
          </div>
          <p className="block-text">
            {help.availability === 'unresolved'
              ? 'Loomer will help once the AI rule is clear.'
              : 'Your teacher set this rule, so Loomer won’t help with the writing here.'}
          </p>
          {help.policyQuote && <span className="quote">“{help.policyQuote}”</span>}
          {help.policySource && (
            <span className="source">
              <Icon name="doc" size="xs" />
              {help.policySource}
            </span>
          )}
          <p className="row-sub" style={{ marginTop: 8 }}>
            You can still save sources and keep your work together here.
          </p>
        </div>
      );
  }
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'student') return <p className="bubble">{message.text}</p>;
  return (
    <div className="msg">
      <div className="msg-k">
        <LogoMark size={13} />
        {kindLabel[message.kind]}
      </div>
      <p className="msg-text">{message.text}</p>
      {message.references.map((r, i) => (
        <Reference key={i} quote={r.quote} from={r.from} />
      ))}
    </div>
  );
}
