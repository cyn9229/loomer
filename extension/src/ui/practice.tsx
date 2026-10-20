// Test prep practice in its own view (round 43, 6A): one question at a time
// with nothing else on screen, in the test's own formats. Multiple choice and
// flashcards answer at once; short answers, free responses and Explain it back
// get feedback that names what is there and what is missing, quoting the
// student, never a grade. A wrong answer offers Try one like it. The end screen
// says what changed, and the result also lands in the test's chat. Practice is
// not a quiz session, so Ask Loomer stays on.
import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { AiMark } from './aiBlock';
import { SubjectTile } from './parts';
import type { Practice, PracticeAnswer, PracticeKind, PracticeQuestion, PracticeSummary, Standing } from '../model/prep';

/** What the student gave: a choice, written text, or a flashcard mark. */
export type PracticeReply = { choice: number } | { text: string } | { knew: boolean };

type PracticeViewProps = {
  practice: Practice;
  /** The test's class, for the subject square. */
  courseName: string | null;
  onAnswer: (reply: PracticeReply) => void;
  /** Try one like it: a new question on the same idea, right away. */
  onLike: () => void;
  onNext: () => void;
  /** End or Close: leaves practice (what was answered is kept). */
  onEnd: () => void;
  onReviewMistakes: () => void;
};

const KIND_WORD: Record<PracticeKind, string> = {
  mcq: 'Multiple choice',
  short: 'Short answer',
  frq: 'Free response',
  vocab: 'Vocabulary',
  math: 'Math',
  explain: 'Explain it back',
};

export function PracticeView({ practice, courseName, onAnswer, onLike, onNext, onEnd, onReviewMistakes }: PracticeViewProps) {
  const { question: q, answer, done } = practice;
  // index is 0-based: the bar fills as questions are answered.
  const answered = practice.index + (answer ? 1 : 0);
  const progress = done ? 1 : Math.min(1, answered / Math.max(1, practice.total));
  return (
    <div className="pv">
      <header className="pv-top">
        <button type="button" className="pv-end" onClick={onEnd}>
          <Icon name="x" size="sm" />
          {done ? 'Close' : 'End'}
        </button>
        <span className="pv-title ellipsis">Practice · {practice.title}</span>
        <span className="pv-n">{done ? 'Done' : `${Math.min(practice.index + 1, practice.total)} of ${practice.total}`}</span>
      </header>
      <div className="pv-bar" role="progressbar" aria-label="Practice progress" aria-valuemin={0} aria-valuemax={practice.total} aria-valuenow={done ? practice.total : answered}>
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      {done ? (
        <PracticeDone summary={done} title={practice.title} onHome={onEnd} onReviewMistakes={onReviewMistakes} />
      ) : practice.error ? (
        <div className="pv-body">
          <p className="status-line error">{practice.error}</p>
          <button type="button" className="btn wide" onClick={onEnd}>
            Back to Home
          </button>
        </div>
      ) : q ? (
        <Question key={q.id} practice={practice} courseName={courseName} q={q} answer={answer} onAnswer={onAnswer} onLike={onLike} onNext={onNext} />
      ) : (
        <p className="pv-wait" role="status">
          {practice.index === 0 ? 'Loomer is writing questions…' : 'Loomer is writing the next question…'}
        </p>
      )}
    </div>
  );
}

function Question({ practice, courseName, q, answer, onAnswer, onLike, onNext }: { practice: Practice; courseName: string | null; q: PracticeQuestion; answer: PracticeAnswer | null; onAnswer: PracticeViewProps['onAnswer']; onLike: () => void; onNext: () => void }) {
  const last = practice.index + 1 >= practice.total;
  const nextLabel = last ? 'Finish' : 'Next';
  const nextButton = (
    <button type="button" className="btn-primary" onClick={onNext}>
      {nextLabel}
      <Icon name="arrowRight" />
    </button>
  );
  return (
    <>
      <p className="pv-kind">
        <SubjectTile courseName={courseName} />
        <span className="grow ellipsis">{q.topic}</span>
        <span className="pv-k2">{q.like ? 'One like it' : KIND_WORD[q.kind]}</span>
      </p>
      <div className="pv-body">
        {q.kind === 'mcq' && <Choice q={q} answer={answer?.kind === 'mcq' ? answer : null} onAnswer={onAnswer} />}
        {q.kind === 'vocab' && <Flashcard key={q.id} q={q} answered={answer?.kind === 'vocab'} onAnswer={onAnswer} />}
        {(q.kind === 'short' || q.kind === 'explain' || q.kind === 'frq' || q.kind === 'math') && <Written q={q} answer={answer} onAnswer={onAnswer} />}
      </div>
      <div className="pv-foot">
        <Foot q={q} answer={answer} next={nextButton} nextLabel={nextLabel} onLike={onLike} onNext={onNext} />
      </div>
    </>
  );
}

/** The footer for each state: nothing until answered (the question has its own button), then Next, plus Try one like it after a miss. */
function Foot({ q, answer, next, nextLabel, onLike, onNext }: { q: PracticeQuestion; answer: PracticeAnswer | null; next: ReactNode; nextLabel: string; onLike: () => void; onNext: () => void }) {
  if (!answer || q.kind === 'vocab') return q.kind === 'mcq' && !answer ? <p className="pv-tap">Tap an answer</p> : null;
  const missed = (answer.kind === 'mcq' || answer.kind === 'math') && !answer.right;
  if (missed)
    return (
      <div className="pv-two">
        <button type="button" className="btn" onClick={onNext}>
          {nextLabel}
        </button>
        <button type="button" className="btn-primary" onClick={onLike}>
          Try one like it
          <Icon name="repeat" />
        </button>
      </div>
    );
  if ((answer.kind === 'short' || answer.kind === 'explain' || answer.kind === 'frq') && answer.status === 'pending') return null;
  return <>{next}</>;
}

function Choice({ q, answer, onAnswer }: { q: PracticeQuestion; answer: Extract<PracticeAnswer, { kind: 'mcq' }> | null; onAnswer: PracticeViewProps['onAnswer'] }) {
  // The worker grades it; until the answer arrives, the tapped choice shows as picked.
  const [picked, setPicked] = useState<number | null>(answer?.picked ?? null);
  const shown = answer?.picked ?? picked;
  const correct = answer?.correct;
  return (
    <>
      <p className="pv-q">{q.prompt}</p>
      <div className="pv-opts" role="group" aria-label="Choices">
        {q.options.map((text, i) => {
          const state = correct !== undefined ? (i === correct ? 'right' : i === shown ? 'wrong' : '') : i === shown ? 'picked' : '';
          return (
            <button
              key={i}
              type="button"
              className={['pv-opt', state].filter(Boolean).join(' ')}
              disabled={shown !== null}
              aria-pressed={shown === i}
              onClick={() => {
                setPicked(i);
                onAnswer({ choice: i });
              }}
            >
              {state === 'right' ? <Icon name="checkCircle" /> : state === 'wrong' ? <Icon name="xCircle" /> : <b>{'ABCDEFG'[i]}</b>}
              <span>{text}</span>
            </button>
          );
        })}
      </div>
      {answer && (
        <p className={answer.right ? 'pv-why ok' : 'pv-why no'}>
          <Icon name={answer.right ? 'checkCircle' : 'xCircle'} />
          <span>{answer.why}</span>
        </p>
      )}
    </>
  );
}

function Flashcard({ q, answered, onAnswer }: { q: PracticeQuestion; answered: boolean; onAnswer: PracticeViewProps['onAnswer'] }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <>
      <button type="button" className={flipped ? 'pv-card flipped' : 'pv-card'} aria-label={flipped ? `${q.term}: ${q.definition}` : `${q.term}, flip to see what it means`} onClick={() => setFlipped(true)}>
        <span className="pv-term">{q.term}</span>
        {flipped ? (
          <span className="pv-def">{q.definition}</span>
        ) : (
          <span className="pv-flip">
            <Icon name="refresh" size="sm" />
            Say what it means, then flip
          </span>
        )}
      </button>
      <div className="pv-two flash">
        {flipped ? (
          <>
            <button type="button" className="btn" disabled={answered} onClick={() => onAnswer({ knew: false })}>
              <Icon name="repeat" size="sm" />
              Not yet
            </button>
            <button type="button" className="btn-primary" disabled={answered} onClick={() => onAnswer({ knew: true })}>
              Got it
              <Icon name="check" />
            </button>
          </>
        ) : (
          <button type="button" className="btn wide" onClick={() => setFlipped(true)}>
            <Icon name="refresh" size="sm" />
            Flip
          </button>
        )}
      </div>
    </>
  );
}

const PLACEHOLDER: Record<'short' | 'explain' | 'frq' | 'math', string> = {
  short: 'Answer in one or two sentences',
  explain: 'Explain it in your own words',
  frq: 'Write an outline or your full answer',
  math: 'Your answer, like x = 3',
};

/** Short answer, Explain it back, free response, and math: write, check, then see the feedback. */
function Written({ q, answer, onAnswer }: { q: PracticeQuestion; answer: PracticeAnswer | null; onAnswer: PracticeViewProps['onAnswer'] }) {
  const kind = q.kind as 'short' | 'explain' | 'frq' | 'math';
  // What the student wrote: kept by the worker on the answer, so it survives a reload.
  const kept = answer && answer.kind !== 'mcq' && answer.kind !== 'vocab' ? answer.text : null;
  const [text, setText] = useState(kept ?? '');
  const [sent, setSent] = useState<string | null>(kept);
  // Revise or Try yours again reopens the box with the last answer in it. An answer already checked opens on its feedback.
  const [editing, setEditing] = useState(answer === null);
  const showBox = editing;
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setSent(t);
    setEditing(false);
    onAnswer({ text: t });
  };
  const words = (sent ?? '').split(/\s+/).filter(Boolean).length;
  return (
    <>
      <p className="pv-q">{q.prompt}</p>
      {showBox ? (
        <>
          {kind === 'math' ? (
            <input className="pv-in" value={text} placeholder={PLACEHOLDER.math} aria-label="Your answer" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          ) : (
            <textarea className={kind === 'frq' ? 'pv-in tall' : 'pv-in'} value={text} placeholder={PLACEHOLDER[kind]} aria-label="Your answer" rows={kind === 'frq' ? 8 : 3} onChange={(e) => setText(e.target.value)} />
          )}
          <button type="button" className="btn-primary" disabled={!text.trim()} onClick={submit}>
            {kind === 'frq' ? 'Check my answer' : 'Check'}
          </button>
        </>
      ) : !sent ? null : kind === 'frq' ? (
        <details className="pv-yours">
          <summary>Your answer · {words === 1 ? '1 word' : `${words} words`}</summary>
          <p>{sent}</p>
        </details>
      ) : (
        <p className={answer?.kind === 'math' && !answer.right ? 'pv-ans bad' : 'pv-ans'}>{sent}</p>
      )}
      {!showBox &&
        (answer ? (
          <Feedback answer={answer} onRevise={() => setEditing(true)} />
        ) : (
          <p className="pv-wait" role="status">
            {kind === 'math' ? 'Checking…' : 'Loomer is reading your answer…'}
          </p>
        ))}
    </>
  );
}

function Feedback({ answer, onRevise }: { answer: PracticeAnswer; onRevise: () => void }) {
  if (answer.kind === 'math')
    return (
      <>
        <p className={answer.right ? 'pv-why ok' : 'pv-why no'}>
          <Icon name={answer.right ? 'checkCircle' : 'xCircle'} />
          <span>{answer.why}</span>
        </p>
        {answer.worked && (
          <div className="pv-steps">
            <p className="pv-steps-k">{answer.worked.problem}</p>
            <ol>
              {answer.worked.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        )}
        {!answer.right && (
          <button type="button" className="btn wide" onClick={onRevise}>
            Try yours again
          </button>
        )}
      </>
    );
  if (answer.kind === 'short' || answer.kind === 'explain' || answer.kind === 'frq') {
    if (answer.status === 'pending')
      return (
        <p className="pv-wait" role="status">
          Loomer is reading your answer…
        </p>
      );
    const revise = answer.kind === 'frq' ? 'Revise my answer' : answer.kind === 'explain' ? 'Explain it again' : 'Add to my answer';
    return (
      <section className="pv-fb" aria-label={answer.kind === 'frq' ? 'What a strong answer needs' : 'What Loomer noticed'}>
        <p className="pv-fb-k">
          <AiMark />
          {answer.kind === 'frq' ? 'What a strong answer needs' : 'What Loomer noticed'}
        </p>
        {answer.kind === 'frq'
          ? answer.needs.map((n) => <Need key={n.need} met={n.met} title={n.need} note={n.met ? (n.note ? `“${n.note}”` : '') : n.note} />)
          : [
              ...answer.met.map((m) => <Need key={`m-${m.need}`} met title={m.need} note={`“${m.quote}”`} />),
              ...answer.missing.map((m) => <Need key={`x-${m.need}`} met={false} title={m.need} note={m.hint} />),
            ]}
        <button type="button" className="btn wide" onClick={onRevise}>
          {revise}
        </button>
      </section>
    );
  }
  return null;
}

function Need({ met, title, note }: { met: boolean; title: string; note: string }) {
  return (
    <div className={met ? 'pv-need met' : 'pv-need miss'}>
      <Icon name={met ? 'checkCircle' : 'plus'} size="sm" />
      <span className="grow">
        <b>
          {title} <span>{met ? 'Met' : 'Missing'}</span>
        </b>
        {note && <span className="pv-need-n">{note}</span>}
      </span>
    </div>
  );
}

/** After the last question: what changed, honestly, and that the result is in the test's chat. */
function PracticeDone({ summary, title, onHome, onReviewMistakes }: { summary: PracticeSummary; title: string; onHome: () => void; onReviewMistakes: () => void }) {
  return (
    <>
      <div className="pv-body">
        <p className="pv-done-t">{summary.line}</p>
        <p className="pv-done-s">{summary.detail}</p>
        <div className="prep-topics flat">
          {summary.topics.map((t) => (
            <TopicLine key={t.text} text={t.text} standing={t.standing} lastCheck={t.lastCheck} />
          ))}
        </div>
        <p className="prep-note">
          <Icon name="chat" size="sm" />
          Loomer added this to your {title} chat, so you can ask about any question later.
        </p>
      </div>
      <div className="pv-foot">
        <button type="button" className="btn-primary" onClick={onHome}>
          Back to Home
        </button>
        {summary.mistakes > 0 && (
          <button type="button" className="center-link" onClick={onReviewMistakes}>
            {summary.mistakes === 1 ? 'Review 1 mistake' : `Review ${summary.mistakes} mistakes`}
          </button>
        )}
      </div>
    </>
  );
}

/** One topic with its standing mark and last check, shared with the test's page. */
export function TopicLine({ text, standing, lastCheck }: { text: string; standing: Standing; lastCheck: { correct: number; total: number } | null }) {
  return (
    <div className="prep-topic">
      <span className={`tmark ${standing}`} aria-hidden="true">
        {standing === 'solid' ? <Icon name="check" /> : <i />}
      </span>
      <span className="grow">{text}</span>
      <span className={`tscore ${standing}`}>{lastCheck ? `${lastCheck.correct} of ${lastCheck.total}` : 'Not checked'}</span>
    </div>
  );
}
