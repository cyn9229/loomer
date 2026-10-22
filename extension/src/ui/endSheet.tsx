// The end-of-session sheet over the Working screen. End opens it, and the
// session keeps running until the student picks. It shows the planner's recap
// (facts only), then asks where the assignment stands: I turned it in, Done for
// today (with one next step to keep or edit, which becomes Home's Continue
// line), or Keep going. The X, Escape, and a tap outside are Keep going, so the
// sheet never traps the student.
import { useEffect, useId, useRef, useState } from 'react';
import { AiBlock } from './aiBlock';
import { FailedLine, WaitSlot } from './wait';
import { Icon } from './Icon';
import type { ActiveSession } from './session';
import { Sheet } from './sheet';

export type EndOutcome = 'turned-in' | 'for-today';
/** One step for next time. Once the student edits it, it is theirs, not the AI's. */
export type KeptStep = { text: string; aiGenerated: boolean };

type EndSheetProps = {
  session: ActiveSession;
  /** "this essay", for "Where does this essay stand?". */
  noun: string;
  /** Asks the worker for a next step (session:next-step); it arrives on session.nextStep. */
  requestNextStep: () => Promise<{ ok: boolean }>;
  /** Ends the session with the student's answer. Resolves to an error to show, or null when it worked. */
  close: (outcome: EndOutcome, nextStep?: KeptStep) => Promise<string | null>;
  onKeepGoing: () => void;
};

export function EndSheet({ session, noun, requestNextStep, close, onKeepGoing }: EndSheetProps) {
  const titleId = useId();
  const firstButton = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState<'ask' | 'next'>('ask');
  // The student's own wording, once they edit the step. Null: show the suggested step.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No step is coming: the ask failed, or a pending step expired (the worker drops it after 90 s).
  const [failed, setFailed] = useState(false);
  const [sawPending, setSawPending] = useState(false);
  const quiz = session.assignment.quiz;
  const suggested = session.nextStep?.status === 'ready' ? session.nextStep : null;
  const stepFailed = session.nextStep?.status === 'failed' ? session.nextStep.failed : null;
  const stepPending = session.nextStep?.status === 'pending' ? session.nextStep.pending : null;
  const none = failed || stepFailed !== null || (sawPending && session.nextStep === null);
  const waiting = stage === 'next' && !suggested && !none;

  useEffect(() => {
    if (session.nextStep?.status === 'pending') setSawPending(true);
  }, [session.nextStep]);

  // Land keyboard users on the first choice.
  useEffect(() => {
    firstButton.current?.focus();
  }, []);

  const finish = (outcome: EndOutcome, nextStep?: KeptStep) => {
    setBusy(true);
    setError(null);
    void close(outcome, nextStep).then((err) => {
      setBusy(false);
      setError(err);
    });
  };

  const doneForToday = () => {
    // A quiz has no next step to plan: "Not done yet" just ends the session.
    if (quiz) return finish('for-today');
    setStage('next');
    if (!session.nextStep) {
      void requestNextStep()
        .catch(() => ({ ok: false }))
        .then((reply) => {
          if (!reply.ok) setFailed(true);
        });
    }
  };

  const save = () => {
    const kept: KeptStep | null = draft !== null ? { text: draft.trim(), aiGenerated: false } : suggested ? { text: suggested.text, aiGenerated: suggested.aiGenerated } : null;
    finish('for-today', kept?.text ? kept : undefined);
  };

  return (
    <Sheet labelledBy={titleId} onClose={onKeepGoing} busy={busy} closeLabel="Keep going">
      <div className="end-top">
        <span className="end-title">{session.assignment.title}</span>
        <button type="button" className="icon-btn" aria-label="Keep going" title="Keep going" disabled={busy} onClick={onKeepGoing}>
          <Icon name="x" size="sm" />
        </button>
      </div>
      {/* Round 47, 3A: when the student studied on their picked sites, the recap is one sentence about that. */}
      <p id={titleId} className="end-recap">
        {session.recap.trail ?? session.recap.text}
      </p>
      {session.recap.trailNext && <p className="end-trail-next">{session.recap.trailNext}</p>}

      {stage === 'ask' ? (
        <>
          <p className="end-q">Where does {noun} stand?</p>
          <div className="end-btns">
            <button type="button" ref={firstButton} className="btn" disabled={busy} onClick={() => finish('turned-in')}>
              <Icon name="check" size="sm" />I turned it in
            </button>
            <button type="button" className="btn" disabled={busy} onClick={doneForToday}>
              <Icon name="sandglass" size="sm" />
              {quiz ? 'Not done yet' : 'Done for today'}
            </button>
          </div>
          <button type="button" className="end-keep" disabled={busy} onClick={onKeepGoing}>
            Keep going
          </button>
        </>
      ) : (
        <>
          <p className="end-q">Here’s where to start next time.</p>
          {stepFailed && draft === null && <FailedLine failed={stepFailed} />}
          {draft !== null || none ? (
            <textarea
              className="end-edit"
              autoFocus
              rows={2}
              value={draft ?? ''}
              placeholder="What will you do first next time?"
              aria-label="Next time"
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : waiting || !suggested ? (
            <>
              {stepPending ? <WaitSlot label="Next time" pending={stepPending} className="end-next" /> : <p className="end-loading">Loomer is picking where to start next time.</p>}
              <button type="button" className="link end-own" onClick={() => setDraft('')}>
                Write my own
              </button>
            </>
          ) : suggested.aiGenerated ? (
            <AiBlock className="end-next" label="Next time" flashKey={`next:${session.sessionId}:${suggested.text}`} right={<EditButton onClick={() => setDraft(suggested.text)} />}>
              <p className="end-next-t">{suggested.text}</p>
            </AiBlock>
          ) : (
            <section className="end-next plain" aria-label="Next time">
              <div className="ai-k plain">
                <Icon name="listChecks" size="xs" />
                Next time
                <span className="grow" />
                <EditButton onClick={() => setDraft(suggested.text)} />
              </div>
              <p className="end-next-t">{suggested.text}</p>
            </section>
          )}
          <button type="button" className="btn-primary" disabled={busy || (waiting && draft === null)} aria-busy={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save and close'}
          </button>
        </>
      )}
      {error && <p className="status-line error">{error}</p>}
    </Sheet>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="link" onClick={onClick}>
      Edit
    </button>
  );
}
