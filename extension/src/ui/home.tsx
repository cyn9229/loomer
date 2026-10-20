// Home: one focal point, then quiet lines, then the plan.
// HomeView renders, in order: the running session's strip (with pause), the
// time-left question after a timed stop, today's brief (once a day), the focus
// (the next step, or why there isn't one yet), "Why this" when asked, notices
// (busy days, your changes, sync problem, keep going, older work), the plan
// (List by start day, or Week day by day), the sync footer, and the Ask bar.
// Views render only what the model says; they never invent progress, time
// estimates, or checks.
import { useState, type ReactNode } from 'react';
import type { EditableFields } from '../model/detail';
import type { DailyBrief, HomeModel, InsightKind, NextAction, OlderReview, ResumeBriefing, WorkItem } from '../model/home';
import { useAction, type PanelApi } from './api';
import { checkProblem, dueWhen, minutesText, observedAt } from './format';
import { Icon, type IconName } from './Icon';
import { AiMark } from './aiBlock';
import { AiServiceDown, EvidenceList, PolicyNote, SubjectTile, SyncFoot } from './parts';
import { YourChanges } from './planChange';
import { DayPicker, MovedNotice, canMoveStart } from './notToday';
import { NoTimeChoices, PlainWords, SlipQuestion, asksWhy, slipLabel } from './slip';
import { PlanSection, startWords, type PlanMode } from './planView';
import { SessionStrip, type ActiveSession, type SessionVerb } from './session';
import { typeLabel } from './workType';
import { useElapsedSeconds } from './useNow';

export type HomeActions = {
  openSettings: () => void;
  openItem: (id: string) => void;
  /** Starts a work session; replaces any other session. `minutes` is the time the student said they have. */
  startSession: (assignmentId: string, minutes?: number) => void;
  /** Goes to the running session's Working screen. */
  continueSession: () => void;
  /** Assignment of the running or paused session, if any. */
  sessionAssignmentId: string | null;
  /** Assignment whose session:start is in flight. */
  startingId: string | null;
  /** Hides an item from lists and ranking, or restores it. */
  setHidden: (assignmentId: string, hidden: boolean) => void;
  /** Assignment whose item:hide is in flight. */
  hidingId: string | null;
  send: PanelApi['send'];
  /** Opens Ask Loomer on a thread ("general" or an assignment id); with none, on the chat the student used last. */
  openAsk: (threadKey?: string) => void;
  /** Asks Chrome for site access; call first in a click handler, before any await. */
  requestOrigins: PanelApi['requestOrigins'];
  /** Pause, resume or end the running session (one tap; errors show at the top). */
  sessionVerb: (verb: SessionVerb) => void;
  sessionBusy: boolean;
  /** Opens the sheet to add work that isn't on Canvas. */
  addAssignment: () => void;
  /** Opens the same sheet to edit work the student added. */
  editAssignment: (assignmentId: string, fields: EditableFields) => void;
};

/** Start or Keep going for one assignment, depending on the current session. */
export function startControl(item: WorkItem, actions: HomeActions, minutes?: number) {
  const current = actions.sessionAssignmentId === item.assignmentId;
  return {
    current,
    label: current ? 'Keep going' : 'Start working',
    onClick: () => (current ? actions.continueSession() : actions.startSession(item.assignmentId, minutes)),
    disabled: actions.startingId !== null,
    busy: actions.startingId === item.assignmentId,
  };
}

type HomeProps = {
  model: HomeModel;
  now: Date;
  actions: HomeActions;
  active: ActiveSession | null;
  /** Shown on the "Working on" line when a hint is waiting. */
  hintWaiting: boolean;
  onRefresh?: () => void;
  refreshing: boolean;
  /** The plan's List | Week choice, kept by the panel across screens. */
  planMode: PlanMode;
  onPlanMode: (mode: PlanMode) => void;
  /** AI is on but the local AI service didn't answer its last health check. */
  aiDown: boolean;
  /** The student ended a session "Done for today" on an item with a guess: ask roughly how much is left. */
  askLeft: WorkItem | null;
  onAskLeftDone: () => void;
  /** The student just said "I turned it in": say so once, with Undo. `mine`: hand-added, so Canvas never confirms it. */
  turnedIn: { assignmentId: string; noun: string; mine: boolean } | null;
  onTurnedInDone: () => void;
  /** The "working on this?" line, shown above the Ask bar. */
  nudge: ReactNode;
};

export function HomeView({ model, now, actions, active, hintWaiting, onRefresh, refreshing, planMode, onPlanMode, aiDown, askLeft, onAskLeftDone, turnedIn, onTurnedInDone, nudge }: HomeProps) {
  const [whyOpen, setWhyOpen] = useState(false);
  // The assignment whose start the student just moved with Not today.
  const [moved, setMoved] = useState<string | null>(null);
  if (model.status === 'not-connected') {
    return (
      <section className="focus">
        <div className="eyebrow">Welcome</div>
        <h1 className="h1">Less managing. More learning.</h1>
        <p className="focus-text">Connect your school’s Canvas and Loomer finds what to work on next.</p>
        <button type="button" className="btn-primary" onClick={actions.openSettings}>
          Connect Canvas
          <Icon name="arrowRight" />
        </button>
        <p className="note" style={{ padding: '14px 0 0' }}>
          <Icon name="lock" />
          Loomer only reads Canvas and never turns anything in or changes it.
        </p>
      </section>
    );
  }

  const next = model.status === 'ready' ? model.next : null;
  const nextId = next?.item.assignmentId ?? null;
  const problem = model.lastCheck && model.lastCheck.outcome !== 'ok' && model.lastCheck.outcome !== 'partial' ? checkProblem(model.lastCheck.outcome) : null;
  const resume = model.resume && !active ? model.resume : null;
  const movedItem = moved ? ([next?.item, ...model.rest].find((i) => i?.assignmentId === moved) ?? null) : null;

  const notices: ReactNode[] = [];
  if (model.crowded)
    notices.push(
      <p className="notice busy" role="note" key="crowded">
        <Icon name="alert" />
        <span className="grow">{model.crowded.text}</span>
      </p>,
    );
  if (model.yourChanges.length > 0) notices.push(<YourChanges key="changes" changes={model.yourChanges} now={now} send={actions.send} />);
  if (problem && model.lastCheck)
    notices.push(
      <div className="notice" role="status" key="problem">
        <span className="dot" />
        <span className="grow">
          {problem}
          <span className="notice-sub">Showing what we saw {observedAt(model.lastCheck.at, now)}.</span>
        </span>
      </div>,
    );
  if (resume && resume.assignment.assignmentId !== nextId) notices.push(<ResumeNotice key="resume" resume={resume} now={now} actions={actions} />);
  if (model.olderReview && model.olderReview.items.length > 0) notices.push(<OlderNotice key="older" review={model.olderReview} now={now} actions={actions} />);
  if (model.status === 'checking' && model.pending.length > 0)
    notices.push(
      <details className="notice-fold" key="pending">
        <summary className="notice">
          <span className="dot accent" />
          <span className="grow">Still reading {model.pending.length === 1 ? '1 assignment' : `${model.pending.length} assignments`}</span>
          <Icon name="chevronRight" />
        </summary>
        <div className="notice-body">
          {model.pending.map((p) => (
            <p className="item-sub" key={p.title} style={{ padding: '3px 0' }}>
              <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{p.title}</b> · {p.detail}
            </p>
          ))}
        </div>
      </details>,
    );
  if (model.status === 'cannot-compare' && model.limitations.length > 0)
    notices.push(
      <details className="notice-fold" key="limits">
        <summary className="notice">
          <span className="dot" />
          <span className="grow">What we couldn’t check</span>
          <Icon name="chevronRight" />
        </summary>
        <div className="notice-body">
          <EvidenceList evidence={model.limitations} now={now} />
        </div>
      </details>,
    );

  return (
    <>
      {active && <SessionStrip session={active} now={now} hintWaiting={hintWaiting} onOpen={actions.continueSession} run={actions.sessionVerb} busy={actions.sessionBusy} />}
      {askLeft && <LeftQuestion item={askLeft} send={actions.send} onDone={onAskLeftDone} />}
      {turnedIn && <TurnedInNotice turnedIn={turnedIn} send={actions.send} onDone={onTurnedInDone} />}
      {movedItem && <MovedNotice item={movedItem} changes={model.yourChanges} send={actions.send} onDone={() => setMoved(null)} />}
      {model.brief && <Brief brief={model.brief} now={now} send={actions.send} />}
      <Focus model={model} now={now} actions={actions} whyOpen={whyOpen} onWhy={() => setWhyOpen((o) => !o)} onMoved={setMoved} />
      {next && whyOpen && (
        <section className="why" aria-label="Why this one, in detail">
          <EvidenceList evidence={next.evidence} now={now} />
        </section>
      )}
      {notices.length > 0 && <div className="notices">{notices}</div>}
      <PlanSection items={next ? [next.item, ...model.rest] : model.rest} room={model.room} now={now} actions={actions} mode={planMode} onMode={onPlanMode} />
      <SyncFoot lastCheck={model.lastCheck} now={now} onRefresh={onRefresh} refreshing={refreshing} />
      <AskBar onOpen={() => actions.openAsk()} aiDown={aiDown} quizOpen={Boolean(active?.assignment.quiz)} send={actions.send} nudge={nudge} />
    </>
  );
}

const TIME_CHOICES = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: 'Not sure', minutes: undefined },
] as const;

/**
 * "How much time do you have?" above Start working. Optional: picking nothing
 * or Not sure starts without a limit. Loomer only repeats this number back.
 */
function TimeQuestion({ value, onChange }: { value: number | undefined; onChange: (minutes: number | undefined) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="timeq">
      <p className="timeq-k">How much time do you have?</p>
      <div className="tseg" role="group" aria-label="How much time do you have?">
        {TIME_CHOICES.map((c) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={picked === c.label}
            onClick={() => {
              setPicked(c.label);
              onChange(c.minutes);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      {value !== undefined && <p className="timeq-s">Loomer will pick a step that fits your time.</p>}
    </div>
  );
}

const LEFT_CHOICES = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
] as const;

/** After a timed session stops: the student's rough guess of what's left (plan:set guess). */
function LeftQuestion({ item, send, onDone }: { item: WorkItem; send: PanelApi['send']; onDone: () => void }) {
  const save = useAction();
  return (
    <section className="tup" aria-label="How much is left">
      <p className="tup-k">
        <Icon name="clock" size="sm" />
        Roughly how much is left?
      </p>
      <p className="tup-p">
        {item.guessMinutes !== null && <>Your guess was about {minutesText(item.guessMinutes)}. </>}
        Just your guess, so Loomer can plan your next start on {item.title}.
      </p>
      <div className="tseg">
        {LEFT_CHOICES.map((c) => (
          <button
            key={c.label}
            type="button"
            disabled={save.busy}
            onClick={() =>
              save.run(async () => {
                const reply = await send({ type: 'plan:set', changes: [{ kind: 'guess', assignment_id: item.assignmentId, minutes: c.minutes }] });
                if (reply.ok) onDone();
                return reply;
              })
            }
          >
            {c.label}
          </button>
        ))}
      </div>
      <button type="button" className="link muted" style={{ marginTop: 8 }} onClick={onDone}>
        Skip
      </button>
      {save.error && <p className="status-line error">{save.error}</p>}
    </section>
  );
}

/** One line about today, on the first open of the day, until dismissed (brief:dismiss). */
function Brief({ brief, now, send }: { brief: NonNullable<DailyBrief>; now: Date; send: PanelApi['send'] }) {
  const dismiss = useAction();
  return (
    <div className="brief" role="status">
      <Icon name="sun" />
      <p className="grow">
        <b>{now.toLocaleDateString(undefined, { weekday: 'long' })}.</b> {brief.text}
        {dismiss.error && <span className="notice-sub danger-text">{dismiss.error}</span>}
      </p>
      <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" disabled={dismiss.busy} onClick={() => dismiss.run(() => send({ type: 'brief:dismiss' }))}>
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}

/**
 * The way into Ask Loomer, pinned to the bottom of Home. Says up front when the
 * AI service is down, and that Ask Loomer is paused while a quiz session is open.
 */
function AskBar({ onOpen, aiDown, quizOpen, send, nudge }: { onOpen: () => void; aiDown: boolean; quizOpen: boolean; send: PanelApi['send']; nudge: ReactNode }) {
  return (
    <div className="askbar-wrap">
      {nudge}
      {aiDown && !quizOpen && <AiServiceDown send={send} />}
      {quizOpen ? (
        <p className="askbar off" role="status">
          <Icon name="pauseCircle" />
          Ask Loomer is paused during your quiz
        </p>
      ) : (
        <button type="button" className="askbar" onClick={onOpen}>
          <Icon name="sparkle" />
          Ask Loomer anything
        </button>
      )}
    </div>
  );
}

/** Steps the headline down for long actions so it never needs an ellipsis. */
function titleClass(text: string): string {
  return text.length > 90 ? 'h1 xlong' : text.length > 55 ? 'h1 long' : 'h1';
}

type FocusProps = {
  model: Exclude<HomeModel, { status: 'not-connected' }>;
  now: Date;
  actions: HomeActions;
  whyOpen: boolean;
  onWhy: () => void;
  /** Not today moved this assignment's start. */
  onMoved: (assignmentId: string) => void;
};

function Focus({ model, now, actions, whyOpen, onWhy, onMoved }: FocusProps) {
  switch (model.status) {
    case 'checking':
      return model.progress.total > 0 ? (
        <section className="focus">
          <div className="eyebrow muted">Getting set up</div>
          <h1 className="h1">Reading your assignments</h1>
          <p className="focus-text" aria-live="polite">
            {model.progress.checked} of {model.progress.total} done. Your next step shows up when we finish.
          </p>
          <div className="progress" role="progressbar" aria-label="Assignments read" aria-valuemin={0} aria-valuemax={model.progress.total} aria-valuenow={model.progress.checked}>
            <span style={{ transform: `scaleX(${Math.min(1, model.progress.checked / model.progress.total)})` }} />
          </div>
        </section>
      ) : (
        <Finding />
      );
    case 'cannot-compare':
      return (
        <section className="focus">
          <div className="eyebrow muted">Next step</div>
          <h1 className="h1">Pick one yourself for now</h1>
          <p className="focus-text">Loomer couldn’t read everything, so the order might change.</p>
        </section>
      );
    case 'empty':
      return (
        <section className="focus">
          <div className="eyebrow muted">Next step</div>
          <h1 className="h1">You’re all caught up</h1>
          <p className="focus-text">Nothing is due soon, and new work shows up after the next Canvas check.</p>
        </section>
      );
    case 'ready':
      return <NextStep next={model.next} resume={model.resume} now={now} actions={actions} whyOpen={whyOpen} onWhy={onWhy} onMoved={onMoved} />;
  }
}

/** First sync, before any assignment is known. Counts seconds so the wait is visible. */
function Finding() {
  const seconds = useElapsedSeconds(true);
  return (
    <section className="focus">
      <div className="eyebrow muted">Getting set up</div>
      <h1 className="h1">Looking for your assignments</h1>
      <p className="focus-text" aria-live="off">
        Reading your Canvas classes{seconds > 0 ? ` · ${seconds} s` : ''}
      </p>
    </section>
  );
}

/**
 * The small label over the line under the next step: what kind of find
 * Loomer leads with. A countdown (nothing new) has no label.
 */
const insightLabel: Record<Exclude<InsightKind, 'countdown' | 'slipped'>, { icon: IconName; text: string }> = {
  change: { icon: 'refresh', text: 'Changed since you last looked' },
  continue: { icon: 'flag', text: 'Where you left off' },
  'hidden-deadline': { icon: 'doc', text: 'Found in the instructions' },
  'busy-day': { icon: 'calendar', text: 'Planned around your week' },
  'weak-topic': { icon: 'target', text: 'From your quick checks' },
};

/** The label says what kind of find it is; only a find the AI made gets the AI mark. A skipped start labels itself (slipLabel). */
function WhyLine({ next, now }: { next: NextAction; now: Date }) {
  const insight = next.insight;
  const label = insight.kind === 'countdown' ? null : insight.kind === 'slipped' ? slipLabel(next, now) : insightLabel[insight.kind];
  return (
    <div className="why-line">
      {label && (
        <p className={insight.aiFound ? 'why-k ai' : 'why-k'}>
          {insight.aiFound ? <AiMark /> : <Icon name={label.icon} size="xs" />}
          {label.text}
        </p>
      )}
      <p className="why-text">{insight.text}</p>
    </div>
  );
}

function NextStep({
  next,
  resume,
  now,
  actions,
  whyOpen,
  onWhy,
  onMoved,
}: {
  next: NextAction;
  resume: ResumeBriefing | null;
  now: Date;
  actions: HomeActions;
  whyOpen: boolean;
  onWhy: () => void;
  onMoved: (assignmentId: string) => void;
}) {
  const { item } = next;
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const start = startControl(item, actions, minutes);
  const clear = useAction();
  const switchTo = useAction();
  // A resume briefing for this same assignment folds in, and one "Last time" line follows. The step the
  // student kept at the end of their last session leads (it is next.action then); else that session's focus.
  const lastTime = resume?.assignment.assignmentId === item.assignmentId ? resume : null;
  const kept = next.insight.kind === 'continue';
  const headline = kept ? next.action : (lastTime?.focus ?? next.action);
  const continuing = kept || Boolean(lastTime?.focus);
  const lastFacts = lastTime ? [lastTime.handledHints > 0 && `${lastTime.handledHints} ${lastTime.handledHints === 1 ? 'hint' : 'hints'} handled`, ...lastTime.facts].filter(Boolean) : [];
  const label = lastTime && start.label === 'Start working' ? 'Keep going' : start.label;
  const pick = next.chosenByStudent ? next.loomerPick : null;
  const limited = item.policy.state === 'blocked' || item.policy.state === 'limited' || item.policy.state === 'unresolved';
  const when = startWords(item, now);
  // Not today: any day with a later day left before the due date, unless the student is working on it now.
  const canMove = !start.current && canMoveStart(item, now);
  // After "What got in the way?": the answer shapes the buttons. A quick start is a short timed session.
  const answer = next.slip?.answer ?? null;
  const quick = start.current ? null : next.quickStart;
  const talkFirst = answer === 'not-sure' && !start.current;
  return (
    <section className="focus" aria-label="Next step">
      <div className="eyebrow">
        {/* The AI mark belongs to the step itself, so only when the headline is next.action and the AI wrote it. */}
        {next.aiGenerated && headline === next.action && <AiMark />}
        {continuing ? (
          'Continue'
        ) : (
          <>
            {next.chosenByStudent ? 'Your pick' : 'Next step'}
            {quick ? <> · about {quick.minutes} minutes</> : when && <> · {when}</>}
          </>
        )}
      </div>
      <h1 className={titleClass(headline)}>{headline}</h1>
      <WhyLine next={next} now={now} />
      {asksWhy(next.slip) && <SlipQuestion slip={next.slip} send={actions.send} />}
      {answer === 'not-sure' && <PlainWords next={next} />}
      {answer === 'no-time' && !picking && <NoTimeChoices next={next} now={now} send={actions.send} onPickDay={() => setPicking(true)} onMoved={onMoved} />}
      <div className="ctx">
        <SubjectTile courseName={item.courseName} size="lg" />
        <span className="grow">
          <button type="button" className="focus-sub" onClick={() => actions.openItem(item.assignmentId)}>
            {item.title}
          </button>
          <span className="focus-meta">
            {item.courseName ?? 'No class'} · {typeLabel(item).word} · {item.due ? <>due <b>{dueWhen(item.due.at, now)}</b></> : 'no due date'}
          </span>
        </span>
      </div>
      {lastFacts.length > 0 && (
        <p className="focus-line ellipsis last-time">
          {lastTime && lastTime.handledHints > 0 && <Icon name="check" size="xs" />}
          Last time: {lastFacts.slice(0, 2).join(' · ')}
        </p>
      )}
      {limited && <PolicyNote state={item.policy.state} quote={item.policy.quote} source={item.policy.sourceLabel} />}
      {!start.current && !quick && !talkFirst && <TimeQuestion value={minutes} onChange={setMinutes} />}
      {talkFirst ? (
        <>
          <button type="button" className="btn-primary" onClick={() => actions.openAsk(item.assignmentId)}>
            Talk it through
            <Icon name="chat" />
          </button>
          <button type="button" className="btn wide" onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
            {start.busy ? 'Starting…' : 'Start working'}
          </button>
        </>
      ) : quick ? (
        <button type="button" className="btn-primary" onClick={() => actions.startSession(item.assignmentId, quick.minutes)} disabled={start.disabled} aria-busy={start.busy}>
          {start.busy ? 'Starting…' : `Start a ${quick.minutes}-minute session`}
          <Icon name="stopwatch" />
        </button>
      ) : (
        <button type="button" className="btn-primary" onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
          {start.busy ? 'Starting…' : label}
          <Icon name="arrowRight" />
        </button>
      )}
      {picking ? (
        <DayPicker
          item={item}
          now={now}
          send={actions.send}
          onMoved={(id) => {
            setPicking(false);
            onMoved(id);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <p className="next-links">
          {canMove && (
            <>
              <button type="button" className="center-link" onClick={() => setPicking(true)}>
                {answer === 'not-feeling-it' ? 'Pick a day instead' : 'Not today'}
              </button>
              <span className="next-dot" aria-hidden="true">
                ·
              </span>
            </>
          )}
          {next.chosenByStudent ? (
            <button type="button" className="center-link" disabled={clear.busy} onClick={() => clear.run(() => actions.send({ type: 'choice:clear' }))}>
              {clear.busy ? 'Asking…' : 'Ask Loomer to pick again'}
            </button>
          ) : (
            <button type="button" className="center-link" aria-expanded={whyOpen} onClick={onWhy}>
              {whyOpen ? 'Hide how Loomer picked this' : 'How Loomer picked this'}
            </button>
          )}
        </p>
      )}
      {pick && (
        <p className="focus-line" style={{ textAlign: 'center' }}>
          Loomer would start with <b>{pick.item.title}</b>.{' '}
          <button
            type="button"
            className="link"
            title={pick.reason}
            disabled={switchTo.busy}
            aria-busy={switchTo.busy}
            onClick={() => switchTo.run(() => actions.send({ type: 'choice:set', assignmentId: pick.item.assignmentId }))}
          >
            {switchTo.busy ? 'Switching…' : 'Switch'}
          </button>
        </p>
      )}
      {(clear.error ?? switchTo.error) && <p className="status-line error pad">{clear.error ?? switchTo.error}</p>}
    </section>
  );
}

/** "Keep going" on another assignment, from the last session's briefing. */
/**
 * After "I turned it in" at the end of a session: the assignment is off the
 * plan, and Loomer confirms once Canvas shows the submission (hand-added work
 * has no Canvas submission to wait for). Undo clears the correction
 * (context:set null), which puts it back.
 */
function TurnedInNotice({ turnedIn, send, onDone }: { turnedIn: { assignmentId: string; noun: string; mine: boolean }; send: HomeActions['send']; onDone: () => void }) {
  const undo = useAction();
  return (
    <div className="notice">
      <Icon name="checkCircle" />
      <span className="grow">
        {turnedIn.mine
          ? `You marked ${turnedIn.noun} done, so it’s off your plan.`
          : `You turned in ${turnedIn.noun}, so Loomer took it off your plan and will check Canvas for your submission.`}
        {undo.error && <span className="notice-sub danger-text">{undo.error}</span>}
      </span>
      <button
        type="button"
        className="link"
        disabled={undo.busy}
        aria-busy={undo.busy}
        onClick={() =>
          undo.run(async () => {
            const reply = await send({ type: 'context:set', assignmentId: turnedIn.assignmentId, correction: null });
            if (reply.ok) onDone();
            return reply;
          })
        }
      >
        Undo
      </button>
      <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={onDone}>
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}

function ResumeNotice({ resume, now, actions }: { resume: ResumeBriefing; now: Date; actions: HomeActions }) {
  const dismiss = useAction();
  const { assignment } = resume;
  return (
    <div className="notice">
      <Icon name="clock" />
      <button type="button" className="grow" onClick={() => actions.startSession(assignment.assignmentId)} disabled={actions.startingId !== null}>
        Keep going on <b>{assignment.title}</b>
        <span className="notice-sub">{resume.facts[0] ?? `Last worked on ${observedAt(resume.at, now)}`}</span>
        {dismiss.error && <span className="notice-sub danger-text">{dismiss.error}</span>}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss"
        title="Dismiss"
        disabled={dismiss.busy}
        onClick={() => dismiss.run(() => actions.send({ type: 'resume:dismiss', assignmentId: assignment.assignmentId }))}
      >
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}

/**
 * One quiet review of older past-due work, as a line that opens in place. Each
 * item gets three answers; "Done for now" marks the review seen (older:reviewed)
 * so it only comes back on new evidence.
 */
function OlderNotice({ review, now, actions }: { review: NonNullable<OlderReview>; now: Date; actions: HomeActions }) {
  const done = useAction();
  const n = review.items.length;
  return (
    <details className="notice-fold">
      <summary className="notice">
        <span className="dot" />
        <span className="grow">{n === 1 ? '1 older assignment needs a look' : `${n} older assignments need a look`}</span>
        <Icon name="chevronRight" />
      </summary>
      <div className="notice-body">
        <p className="item-sub" style={{ paddingBottom: 4 }}>
          {n === 1 ? 'Canvas still lists it, so tell Loomer if you finished it.' : 'Canvas still lists these, so tell Loomer if you finished them.'}
        </p>
        {review.items.map(({ item, reason }) => (
          <OlderItem key={item.assignmentId} item={item} reason={reason} now={now} actions={actions} />
        ))}
        <button
          type="button"
          className="link"
          style={{ marginTop: 10 }}
          disabled={done.busy}
          aria-busy={done.busy}
          onClick={() => done.run(() => actions.send({ type: 'older:reviewed', assignmentIds: review.items.map((i) => i.item.assignmentId) }))}
        >
          {done.busy ? 'Saving…' : 'Done for now'}
        </button>
        {done.error && <p className="status-line error">{done.error}</p>}
      </div>
    </details>
  );
}

function OlderItem({ item, reason, now, actions }: { item: WorkItem; reason: string; now: Date; actions: HomeActions }) {
  const act = useAction();
  const [verb, setVerb] = useState<string | null>(null);
  const run = (label: string, work: () => ReturnType<PanelApi['send']>) => {
    setVerb(label);
    act.run(() => work().finally(() => setVerb(null)));
  };
  const correct = (correction: 'kept-active' | 'done-offline') => () => actions.send({ type: 'context:set', assignmentId: item.assignmentId, correction });
  return (
    <div className="older">
      <span className="item-title">{item.title}</span>
      <span className="item-sub">
        {item.courseName ?? 'No class'} · {item.due ? dueWhen(item.due.at, now) : 'no due date'} · {reason}
      </span>
      <div className="btn-row">
        <button type="button" className="btn sm" disabled={act.busy} aria-busy={verb === 'keep'} onClick={() => run('keep', correct('kept-active'))}>
          Still doing it
        </button>
        <button type="button" className="btn sm" disabled={act.busy} aria-busy={verb === 'done'} onClick={() => run('done', correct('done-offline'))}>
          Did it on paper
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={act.busy}
          aria-busy={verb === 'hide'}
          onClick={() => run('hide', () => actions.send({ type: 'item:hide', assignmentId: item.assignmentId, hidden: true }))}
        >
          Hide
        </button>
      </div>
      {act.error && <p className="status-line error">{act.error}</p>}
    </div>
  );
}
