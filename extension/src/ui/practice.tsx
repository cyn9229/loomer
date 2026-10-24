// Test prep practice in its own view: one question at a time
// with nothing else on screen, in the test's own formats. Multiple choice and
// flashcards answer at once; short answers, free responses and Explain it back
// get feedback that names what is there and what is missing, quoting the
// student, never a grade. A wrong answer offers Try one like it. The end screen
// says what changed, and the result also lands in the test's chat. Practice is
// not a quiz session, so Ask Loomer stays on.
import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { AiMark } from './aiBlock';
import { SubjectTile } from './parts';
import { TeachStep } from './teach';
import type { Confidence, Outcome, Practice, PracticeAnswer, PracticeKind, PracticeQuestion, PracticeSkill, PracticeSummary, Standing } from '../model/prep';
import type { Pending } from '../model/wait';
import { WaitHold, WaitSlot } from './wait';

/** What the student gave: a choice, written text, or a flashcard mark. */
export type PracticeReply = { choice: number; confidence: Confidence } | { text: string } | { knew: boolean };

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
  /** Closes practice and opens the test's page: its mistakes, or after a diagnostic, today's plan. */
  onReviewMistakes: () => void;
};

/** Each question practices one skill: a fact, a cause or reason, or using it on a new case. */
const SKILL_WORD: Record<PracticeSkill, string> = { remember: 'Remember', understand: 'Understand', apply: 'Apply' };

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
  // After a miss, a teaching block can come first as its own step; Check it moves on to the check question.
  const teach = practice.teach;
  // While nothing is on screen, say what Loomer is writing: after a miss, the explanation comes next.
  const lastMiss = useRef(false);
  if (answer) lastMiss.current = isMiss(answer);
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
        <span className="pv-title ellipsis">
          {practice.mode === 'diagnostic' ? 'Diagnostic' : 'Practice'} · {practice.title}
        </span>
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
      ) : teach ? (
        <>
          <p className="pv-kind">
            <SubjectTile courseName={courseName} />
            <span className="grow ellipsis">{teach.topic}</span>
            <span className="pv-k2">Learn</span>
          </p>
          <TeachStep key={teach.id} block={teach} onNext={onNext} />
        </>
      ) : q ? (
        <Question key={q.id} practice={practice} courseName={courseName} q={q} answer={answer} onAnswer={onAnswer} onLike={onLike} onNext={onNext} />
      ) : practice.pending ? (
        // The question (or, after a miss, the lesson) holds its space; End stops the writing.
        <div className="pv-body">
          <WaitHold pending={practice.pending} shape={lastMiss.current ? 'table' : 'question'} onCancel={onEnd} />
        </div>
      ) : (
        <p className="pv-wait" role="status">
          {lastMiss.current ? 'Loomer is writing a short lesson.' : practice.index === 0 ? 'Loomer is writing your questions.' : 'Loomer is writing the next question.'}
        </p>
      )}
    </div>
  );
}

/** Misses that get a teaching block: a wrong choice or math answer, or a written answer with something missing. */
function isMiss(answer: PracticeAnswer): boolean {
  switch (answer.kind) {
    case 'mcq':
    case 'math':
      return !answer.right;
    case 'short':
    case 'explain':
      return answer.status === 'ready' && answer.missing.length > 0;
    case 'frq':
      return answer.status === 'ready' && answer.needs.some((n) => !n.met);
    case 'vocab':
      return false;
  }
}

function Question({ practice, courseName, q, answer, onAnswer, onLike, onNext }: { practice: Practice; courseName: string | null; q: PracticeQuestion; answer: PracticeAnswer | null; onAnswer: PracticeViewProps['onAnswer']; onLike: () => void; onNext: () => void }) {
  const last = practice.index + 1 >= practice.total;
  // The diagnostic only checks: teaching for its misses comes in the plan after it.
  const diagnostic = practice.mode === 'diagnostic';
  // Multiple choice: the tap stays here (and can change) until the student says how sure they are.
  const [picked, setPicked] = useState<number | null>(answer?.kind === 'mcq' ? answer.picked : null);
  const [checking, setChecking] = useState(false);
  const check = (confidence: Confidence) => {
    if (picked === null) return;
    setChecking(true);
    onAnswer({ choice: picked, confidence });
  };
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
        <span className="pv-k2" title={KIND_WORD[q.kind]}>
          {q.like ? 'One like it' : SKILL_WORD[q.skill]}
        </span>
      </p>
      <div className="pv-body">
        {q.kind === 'mcq' && <Choice q={q} answer={answer?.kind === 'mcq' ? answer : null} picked={picked} locked={checking} onPick={setPicked} />}
        {q.kind === 'vocab' && <Flashcard key={q.id} q={q} answered={answer?.kind === 'vocab'} onAnswer={onAnswer} />}
        {(q.kind === 'short' || q.kind === 'explain' || q.kind === 'frq' || q.kind === 'math') && <Written q={q} answer={answer} onAnswer={onAnswer} pending={practice.pending} />}
      </div>
      <div className="pv-foot">
        {q.kind === 'mcq' && !answer ? (
          <SureOrGuessing picked={picked} checking={checking} onCheck={check} />
        ) : (
          <Foot q={q} answer={answer} next={nextButton} nextLabel={nextLabel} onLike={diagnostic ? null : onLike} onNext={onNext} />
        )}
      </div>
    </>
  );
}

/** The footer for each state: nothing until answered (the question has its own button), then Next, plus Try one like it after a miss. */
/** Multiple choice before the result: tap an answer, then one more tap says how sure, which checks it. */
function SureOrGuessing({ picked, checking, onCheck }: { picked: number | null; checking: boolean; onCheck: (c: Confidence) => void }) {
  if (picked === null) return <p className="pv-tap">Tap an answer</p>;
  if (checking)
    return (
      <p className="pv-tap" role="status">
        Checking…
      </p>
    );
  return (
    <>
      <p className="pv-ask">How sure are you?</p>
      <div className="pv-two">
        <button type="button" className="btn" onClick={() => onCheck('guessing')}>
          <Icon name="question" size="sm" />
          Guessing
        </button>
        <button type="button" className="btn-primary" onClick={() => onCheck('sure')}>
          Sure
          <Icon name="check" />
        </button>
      </div>
    </>
  );
}

function Foot({ q, answer, next, nextLabel, onLike, onNext }: { q: PracticeQuestion; answer: PracticeAnswer | null; next: ReactNode; nextLabel: string; onLike: (() => void) | null; onNext: () => void }) {
  if (!answer || q.kind === 'vocab') return null;
  const missed = (answer.kind === 'mcq' || answer.kind === 'math') && !answer.right;
  if (missed && onLike)
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

/** The options. Before the result, a tap picks (and can change); after it, right and wrong are marked. */
function Choice({ q, answer, picked, locked, onPick }: { q: PracticeQuestion; answer: Extract<PracticeAnswer, { kind: 'mcq' }> | null; picked: number | null; locked: boolean; onPick: (i: number) => void }) {
  const shown = answer?.picked ?? picked;
  const correct = answer?.correct;
  return (
    <>
      <p className="pv-q">{q.prompt}</p>
      <div className="pv-opts" role="group" aria-label="Choices">
        {q.options.map((text, i) => {
          const state = correct !== undefined ? (i === correct ? 'right' : i === shown ? 'wrong' : '') : i === shown ? 'picked' : '';
          return (
            <button key={i} type="button" className={['pv-opt', state].filter(Boolean).join(' ')} disabled={Boolean(answer) || locked} aria-pressed={shown === i} onClick={() => onPick(i)}>
              {state === 'right' ? <Icon name="checkCircle" /> : state === 'wrong' ? <Icon name="xCircle" /> : <b>{'ABCDEFG'[i]}</b>}
              <span>{text}</span>
            </button>
          );
        })}
      </div>
      {answer && <ChoiceResult answer={answer} />}
    </>
  );
}

/** Right or wrong, and how sure: four outcomes, each with its own mark. A mix-up (wrong but sure) is the one to fix first. */
// A right-and-sure answer reads Strong; Ready is kept for the stricter test-readiness rule.
const OUTCOME_TITLE: Record<Outcome, string> = { solid: 'Strong', shaky: 'Right, but a guess', mixup: 'A mix-up to fix', gap: 'Not learned yet' };
export const OUTCOME_WORD: Record<Outcome, string> = { solid: 'Strong', shaky: 'Shaky', mixup: 'Mix-up', gap: 'Not learned yet' };

/** The mark for an outcome: a check, half full, a red "!", or striped. */
export function OutcomeMark({ outcome }: { outcome: Outcome }) {
  return (
    <span className={`omark ${outcome}`} aria-hidden="true">
      {outcome === 'solid' ? <Icon name="check" /> : outcome === 'mixup' ? '!' : outcome === 'shaky' ? <i /> : null}
    </span>
  );
}

/** The outcome's title and mark, the reason, then what happens now. */
function ChoiceResult({ answer }: { answer: Extract<PracticeAnswer, { kind: 'mcq' }> }) {
  return (
    <div className={`pv-res ${answer.outcome}`}>
      <OutcomeMark outcome={answer.outcome} />
      <span className="grow">
        <b>{OUTCOME_TITLE[answer.outcome]}</b>
        <span>{answer.why}</span>
        {answer.next && <span className="pv-res-next">{answer.next}</span>}
      </span>
    </div>
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
function Written({ q, answer, onAnswer, pending }: { q: PracticeQuestion; answer: PracticeAnswer | null; onAnswer: PracticeViewProps['onAnswer']; pending: Pending | null }) {
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
          <Feedback answer={answer} onRevise={() => setEditing(true)} pending={pending} />
        ) : pending ? (
          <WaitSlot label={feedbackLabel(kind)} pending={pending} shape="rows" className="inset" />
        ) : (
          <p className="pv-wait" role="status">
            {kind === 'math' ? 'Checking your answer.' : 'Loomer is checking your answer.'}
          </p>
        ))}
    </>
  );
}

/** The box a written answer's feedback fills. */
function feedbackLabel(kind: PracticeAnswer['kind'] | PracticeQuestion['kind']): string {
  return kind === 'frq' ? 'What a strong answer needs' : 'What Loomer noticed';
}

function Feedback({ answer, onRevise, pending }: { answer: PracticeAnswer; onRevise: () => void; pending: Pending | null }) {
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
      return pending ? (
        <WaitSlot label={feedbackLabel(answer.kind)} pending={pending} shape="rows" className="inset" />
      ) : (
        <p className="pv-wait" role="status">
          Loomer is checking your answer.
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
  const [allSolid, setAllSolid] = useState(false);
  // After a diagnostic: one row per topic, mix-ups and gaps first, solid topics folded into one line.
  const diagnosis = summary.diagnosis;
  const open = diagnosis?.filter((d) => d.outcome !== 'solid') ?? [];
  const solid = diagnosis?.filter((d) => d.outcome === 'solid') ?? [];
  const shownSolid = allSolid || open.length === 0 ? solid : solid.slice(0, 1);
  return (
    <>
      <div className="pv-body">
        <p className="pv-done-t">{summary.line}</p>
        <p className="pv-done-s">{summary.detail}</p>
        {diagnosis ? (
          <div className="diag">
            {[...open, ...shownSolid].map((d) => (
              <div className="diag-row" key={d.topicId}>
                <OutcomeMark outcome={d.outcome} />
                <span className="grow">
                  <b>
                    {d.topic} <span className={`diag-w ${d.outcome}`}>{OUTCOME_WORD[d.outcome]}</span>
                  </b>
                  <span>{d.line}</span>
                </span>
              </div>
            ))}
            {solid.length > shownSolid.length && (
              <button type="button" className="link diag-more" onClick={() => setAllSolid(true)}>
                {solid.length - shownSolid.length === 1 ? '1 more strong topic' : `${solid.length - shownSolid.length} more strong topics`}
              </button>
            )}
          </div>
        ) : (
          <div className="prep-topics flat">
            {summary.topics.map((t) => (
              <TopicLine key={t.text} text={t.text} standing={t.standing} lastCheck={t.lastCheck} />
            ))}
          </div>
        )}
        {!diagnosis && (
          <p className="prep-note">
            <Icon name="chat" size="sm" />
            Loomer added this to your {title} chat, so you can ask about any question later.
          </p>
        )}
      </div>
      <div className="pv-foot">
        {diagnosis ? (
          <button type="button" className="btn-primary" onClick={onReviewMistakes}>
            See today’s plan
            <Icon name="arrowRight" />
          </button>
        ) : (
          <>
            <button type="button" className="btn-primary" onClick={onHome}>
              Back to Home
            </button>
            {summary.mistakes > 0 && (
              <button type="button" className="center-link" onClick={onReviewMistakes}>
                {summary.mistakes === 1 ? 'Review 1 mistake' : `Review ${summary.mistakes} mistakes`}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** One topic with its standing mark (or the mix-up mark) and last check, shared with the test's page. */
/**
 * One topic. With `progress` (the test's page): a mix-up mark when there is one,
 * the name, and one thin bar, full only when the topic is ready. Without it
 * (a practice summary): the standing mark and the latest check's score.
 */
export function TopicLine({
  text,
  standing,
  lastCheck,
  mixup = false,
  progress,
  elsewhere = null,
}: {
  text: string;
  standing: Standing;
  lastCheck: { correct: number; total: number } | null;
  mixup?: boolean;
  progress?: number;
  /** Studied on another site: one line under the name, "Studied on Quizlet · next: one quick check". */
  elsewhere?: string | null;
}) {
  if (progress !== undefined)
    return (
      <div className="prep-topic">
        {mixup && <OutcomeMark outcome="mixup" />}
        <span className="grow topic-name">
          {text}
          {elsewhere && (
            <span className="topic-else">
              <Icon name="external" size="xs" />
              {elsewhere}
            </span>
          )}
        </span>
        <span className={progress >= 1 ? 'tbar full' : 'tbar'} role="img" aria-label={progress >= 1 ? 'Ready' : mixup ? 'A mix-up to fix' : 'Not ready yet'}>
          <i style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} />
        </span>
      </div>
    );
  return (
    <div className="prep-topic">
      {mixup ? (
        <OutcomeMark outcome="mixup" />
      ) : (
        <span className={`tmark ${standing}`} aria-hidden="true">
          {standing === 'solid' ? <Icon name="check" /> : <i />}
        </span>
      )}
      <span className="grow">
        {text}
        {mixup && <span className="diag-w mixup">Mix-up</span>}
      </span>
      <span className={`tscore ${standing}`}>{lastCheck ? `${lastCheck.correct} of ${lastCheck.total}` : 'Not checked'}</span>
    </div>
  );
}
