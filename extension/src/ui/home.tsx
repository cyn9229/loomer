// Home: one focal point, then quiet lines, then the plan.
// HomeView renders, in order: the running session's strip (with pause), the
// time-left question after a timed stop, the focus (the next step, or why there
// isn't one yet), notices (sync problem, keep going, older work), the plan
// (List by start day, or Week day by day, which also holds busy days and your
// changes), the sync footer, and the Ask bar. The next step is a short title,
// a subtitle with the specifics, one quiet line of why, the button, and one
// quiet line that opens the item's page, where the evidence lives (round 46, 1A). Views render only what the model
// says; they never invent progress, time estimates, or checks.
import { useState, type ReactNode } from 'react';
import type { EditableFields } from '../model/detail';
import type { HomeModel, NextAction, OlderReview, ResumeBriefing, WorkItem } from '../model/home';
import type { PrepStep } from '../model/prep';
import { shortTitle } from './ask';
import { START_WORDS } from './prepWords';
import { useAction, type PanelApi } from './api';
import { checkProblem, dueWhen, minutesText, observedAt } from './format';
import { Icon } from './Icon';
import { AiMark } from './aiBlock';
import { AiServiceDown, EvidenceList, PolicyNote, SubjectTile, SyncFoot } from './parts';
import { DayPicker, MovedNotice, canMoveStart } from './notToday';
import { NoTimeChoices, PlainWords, SlipQuestion, asksWhy, slipLabel } from './slip';
import { PlanSection, type PlanMode } from './planView';
import { SessionStrip, type ActiveSession, type SessionVerb } from './session';
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
  /** Asks Chrome for notifications; call first in a click handler, before any await. */
  requestNotifications: PanelApi['requestNotifications'];
  /** Pause, resume or end the running session (one tap; errors show at the top). */
  sessionVerb: (verb: SessionVerb) => void;
  sessionBusy: boolean;
  /** Opens the sheet to add work that isn't on Canvas. */
  addAssignment: () => void;
  /** Starts today's test prep practice, or one on a single mistake (prep:start); the practice view opens when it arrives. */
  startPractice: (assignmentId: string, mistakeId?: string) => void;
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
  // The assignment whose start the student just moved (Not today or Today is busy), and when.
  const [moved, setMoved] = useState<{ assignmentId: string; at: number } | null>(null);
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
  const movedItem = moved ? ([next?.item, ...model.rest].find((i) => i?.assignmentId === moved.assignmentId) ?? null) : null;

  const notices: ReactNode[] = [];
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
      {movedItem && moved && <MovedNotice item={movedItem} since={moved.at} changes={model.yourChanges} send={actions.send} onDone={() => setMoved(null)} />}
      <Focus model={model} now={now} actions={actions} onMoved={(assignmentId) => setMoved({ assignmentId, at: Date.now() })} />
      {notices.length > 0 && <div className="notices">{notices}</div>}
      <PlanSection
        items={next ? [next.item, ...model.rest] : model.rest}
        room={model.room}
        crowded={model.crowded}
        yourChanges={model.yourChanges}
        now={now}
        actions={actions}
        mode={planMode}
        onMode={onPlanMode}
      />
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
 * "How much time do you have?" above Start working, opened from Set a time.
 * Optional: picking nothing or Not sure starts without a limit. Loomer only
 * repeats this number back.
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

type FocusProps = {
  model: Exclude<HomeModel, { status: 'not-connected' }>;
  now: Date;
  actions: HomeActions;
  /** Not today moved this assignment's start. */
  onMoved: (assignmentId: string) => void;
};

function Focus({ model, now, actions, onMoved }: FocusProps) {
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
      return <NextStep next={model.next} resume={model.resume} now={now} actions={actions} onMoved={onMoved} />;
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
 * The next step (round 46, 1A): a short title, a subtitle with the specifics
 * (the topics, or what the work asks), one quiet line of why, and the
 * button. One quiet line under it names the assignment and opens its page,
 * where the evidence, readiness, and plan live. Below that, only actions:
 * Not today, Set a time, Start it now anyway, or Ask Loomer to pick again.
 */
function NextStep({ next, resume, now, actions, onMoved }: { next: NextAction; resume: ResumeBriefing | null; now: Date; actions: HomeActions; onMoved: (assignmentId: string) => void }) {
  const { item } = next;
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [timing, setTiming] = useState(false);
  const start = startControl(item, actions, minutes);
  const clear = useAction();
  const switchTo = useAction();
  // A resume briefing for this same assignment folds in. The step the student kept at the end of their
  // last session leads (it is next.action then); else that session's focus.
  const lastTime = resume?.assignment.assignmentId === item.assignmentId ? resume : null;
  const kept = next.insight.kind === 'continue';
  const headline = kept ? next.action : (lastTime?.focus ?? next.action);
  const label = lastTime && start.label === 'Start working' ? 'Keep going' : start.label;
  const pick = next.chosenByStudent ? next.loomerPick : null;
  const limited = item.policy.state === 'blocked' || item.policy.state === 'limited' || item.policy.state === 'unresolved';
  // Not today: any day with a later day left before the due date, unless the student is working on it now.
  const canMove = !start.current && canMoveStart(item, now);
  // After "What got in the way?": the answer shapes the buttons. A quick start is a short timed session.
  const answer = next.slip?.answer ?? null;
  const quick = start.current ? null : next.quickStart;
  const talkFirst = answer === 'not-sure' && !start.current;
  // Test prep: today's practice step leads with one Start button; readiness and the plan live on the test's page.
  const prep = next.prep;
  const prepStep = prep ? START_WORDS[prep.kind] : null;
  // Between today's sessions: the next one waits for later, with an optional reminder.
  const waiting = prep?.waiting ?? null;
  // A time limit is a second decision, so it opens only from Set a time.
  const canTime = !start.current && !quick && !talkFirst && !prep;
  const links: ReactNode[] = [];
  if (prep && waiting)
    links.push(
      <button key="now" type="button" className="center-link" onClick={() => actions.startPractice(prep.assignmentId)}>
        Start it now anyway
      </button>,
    );
  if (canMove && !prep)
    links.push(
      <button key="move" type="button" className="center-link" onClick={() => setPicking(true)}>
        {answer === 'not-feeling-it' ? 'Pick a day instead' : 'Not today'}
      </button>,
    );
  if (canTime && !timing)
    links.push(
      <button key="time" type="button" className="center-link" onClick={() => setTiming(true)}>
        Set a time
      </button>,
    );
  if (next.chosenByStudent)
    links.push(
      <button key="pick" type="button" className="center-link" disabled={clear.busy} onClick={() => clear.run(() => actions.send({ type: 'choice:clear' }))}>
        {clear.busy ? 'Asking…' : 'Ask Loomer to pick again'}
      </button>,
    );
  return (
    <section className="focus" aria-label="Next step">
      {/* Up to two lines: Loomer's steps fit in about 40 characters; a step the student typed can run longer, so past two lines it ends in an ellipsis and the full text is the tooltip. */}
      <h1 className="h1 next-t" title={headline}>
        {/* The AI mark belongs to the step itself, so only when the headline is next.action and the AI wrote it. */}
        {next.aiGenerated && headline === next.action && <AiMark />}
        {headline}
      </h1>
      {next.detail && (
        <p className="step-detail" title={next.detail}>
          {next.detail}
        </p>
      )}
      <p className="step-why">{next.why}</p>
      {asksWhy(next.slip) && <SlipQuestion slip={next.slip} send={actions.send} />}
      {answer === 'not-sure' && <PlainWords next={next} />}
      {answer === 'no-time' && canMove && !picking && <NoTimeChoices next={next} now={now} send={actions.send} onPickDay={() => setPicking(true)} onMoved={onMoved} />}
      {limited && <PolicyNote state={item.policy.state} quote={item.policy.quote} source={item.policy.sourceLabel} />}
      {timing && canTime && <TimeQuestion value={minutes} onChange={setMinutes} />}
      {prep && waiting ? (
        <WaitingReminder prep={prep} waiting={waiting} actions={actions} />
      ) : prep && prepStep ? (
        <button type="button" className="btn-primary" onClick={() => actions.startPractice(prep.assignmentId)} disabled={actions.startingId !== null}>
          {prepStep}
          <Icon name="play" />
        </button>
      ) : talkFirst ? (
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
      <button type="button" className="step-meta" onClick={() => actions.openItem(item.assignmentId)}>
        <SubjectTile courseName={item.courseName} />
        <span className="grow ellipsis">
          {shortTitle(item.title)} · {item.due ? `due ${dueWhen(item.due.at, now)}` : 'no due date'}
        </span>
        <Icon name="chevronRight" size="sm" />
      </button>
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
        links.length > 0 && (
          <p className="next-links">
            {links.flatMap((link, i) =>
              i === 0
                ? [link]
                : [
                    <span key={`dot${i}`} className="next-dot" aria-hidden="true">
                      ·
                    </span>,
                    link,
                  ],
            )}
          </p>
        )
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

/** Home between test prep sessions: the next one opens later today, with an optional reminder (prep:remind). */
function WaitingReminder({ prep, waiting, actions }: { prep: PrepStep; waiting: NonNullable<PrepStep['waiting']>; actions: HomeActions }) {
  const remind = useAction();
  const at = new Date(waiting.remindAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const toggle = () => {
    const on = !waiting.reminder;
    // Ask for notifications inside the click, before any await, or Chrome won't show its prompt.
    const allowed = on ? actions.requestNotifications() : Promise.resolve(true);
    remind.run(async () =>
      (await allowed)
        ? actions.send({ type: 'prep:remind', assignmentId: prep.assignmentId, sessionId: waiting.sessionId, on })
        : { ok: false, error: 'Chrome didn’t allow notifications, so Loomer can’t remind you.' },
    );
  };
  return (
    <>
      <button type="button" role="switch" aria-checked={waiting.reminder} className="wait-remind" disabled={remind.busy} onClick={toggle}>
        <Icon name="bell" />
        <span className="grow">
          <b>Remind me at {at}</b>
        </span>
        <span className="prep-toggle" aria-hidden="true" />
      </button>
      {remind.error && <p className="status-line error">{remind.error}</p>}
    </>
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
