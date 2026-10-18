// Help, inside the Working screen: help for the session's assignment, shaped by
// its kind of work. Writing is hint-first with draft follow-ups; practice,
// study and reading get their own ready questions and no draft step (practice
// and study offer "your own copy" in the Working header).
// When a session is new, up to two numbered steps come first (which Doc is your
// draft, and the one-time AI rule question). Then the proactive hint, the
// conversation, quick follow-ups, and a docked composer with the research
// suggestion above it. Loomer answers with hints and questions, never finished
// work; replies have no copy button. The composer stays disabled until help is
// available.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ChatMessage, HelpState } from '../model/session';
import { useAction, type PanelApi } from './api';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { LinkDocStep, Reference, type ActiveSession } from './session';
import { useElapsedSeconds } from './useNow';
import { askHint, typeCaption, typePrompts } from './workType';

const kindLabel: Record<ChatMessage['kind'], string | null> = {
  question: null,
  hint: 'Hint',
  explanation: null,
  example: 'Example on a different topic',
  redirect: 'Let’s try this instead',
  review: 'Feedback on your draft',
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
  /** The proactive hint, rendered by the panel. */
  hint: ReactNode;
  /** The research suggestion line, rendered by the panel. */
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

  // Writing needs its draft linked. Practice and study offer "your own copy" in the header instead; reading links nothing.
  const type = assignment.workType.type;
  const needsDoc = doc.status === 'not-linked' && type === 'writing';
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

      {help.messages.length === 0 && help.availability === 'available' && steps === 0 && !hint && <p className="caption">{typeCaption[type]}</p>}

      {hint && help.messages.length > 0 && <div className="rule" />}
      {help.messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}

      {thinking && <Thinking />}

      {canAsk && type !== 'writing' && (help.messages.length === 0 || last?.role === 'loomer') && (
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
          <button type="button" className="btn sm" onClick={() => ask.run(() => api.send({ type: 'help:review', assignmentId: assignment.assignmentId }))}>
            Check my draft
          </button>
        </div>
      )}
      {ask.error && <p className="status-line error pad">{ask.error}</p>}
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
              placeholder={help.availability === 'available' && !help.pending ? askHint[type] : composerPlaceholder(help)}
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
        <div className="step-s">We couldn’t find a rule in the instructions or syllabus.</div>
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
          <p className="hint-text">Turn it on in settings to get hints. Everything else still works.</p>
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

function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'student') return <p className="bubble">{message.text}</p>;
  const label = kindLabel[message.kind];
  return (
    <div className="msg">
      <LogoMark size={17} />
      <div className="grow">
        {label && <span className="msg-k">{label}</span>}
        <p className="msg-text">{message.text}</p>
        {message.references.map((r, i) => (
          <Reference key={i} quote={r.quote} from={r.from} />
        ))}
      </div>
    </div>
  );
}
