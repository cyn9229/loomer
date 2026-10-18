// Home: one focal point, then quiet lines, then the plan.
// HomeView renders, in order: today's brief (once a day), the focus (the next
// step, or why there isn't one yet), "Why this" when asked, one-line notices
// (busy days, sync problem, current session, keep going, older work), the plan
// (List by start day, or Week day by day), the sync footer, and the Ask bar.
// Views render only what the model says; they never invent progress, time
// estimates, or checks.
import { useState, type ReactNode } from 'react';
import type { DailyBrief, HomeModel, NextAction, OlderReview, ResumeBriefing, WorkItem } from '../model/home';
import { useAction, type PanelApi } from './api';
import { checkProblem, dueWhen, observedAt } from './format';
import { Icon } from './Icon';
import { AiServiceDown, EvidenceList, PolicyNote, SubjectTile, SyncFoot } from './parts';
import { PlanSection, startWords, type PlanMode } from './planView';
import type { ActiveSession } from './session';
import { useElapsedSeconds } from './useNow';

export type HomeActions = {
  openSettings: () => void;
  openItem: (id: string) => void;
  /** Starts a work session; replaces any other session. */
  startSession: (assignmentId: string) => void;
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
  /** Opens Ask Loomer on a thread: "general" or an assignment id. */
  openAsk: (threadKey: string) => void;
};

/** Start or Keep going for one assignment, depending on the current session. */
export function startControl(item: WorkItem, actions: HomeActions) {
  const current = actions.sessionAssignmentId === item.assignmentId;
  return {
    label: current ? 'Keep going' : 'Start working',
    onClick: () => (current ? actions.continueSession() : actions.startSession(item.assignmentId)),
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
};

export function HomeView({ model, now, actions, active, hintWaiting, onRefresh, refreshing, planMode, onPlanMode, aiDown }: HomeProps) {
  const [whyOpen, setWhyOpen] = useState(false);
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
          Loomer only reads. It never turns anything in or changes Canvas.
        </p>
      </section>
    );
  }

  const next = model.status === 'ready' ? model.next : null;
  const nextId = next?.item.assignmentId ?? null;
  const problem = model.lastCheck && model.lastCheck.outcome !== 'ok' && model.lastCheck.outcome !== 'partial' ? checkProblem(model.lastCheck.outcome) : null;
  const resume = model.resume && !active ? model.resume : null;

  const notices: ReactNode[] = [];
  if (model.crowded)
    notices.push(
      <p className="notice busy" role="note" key="crowded">
        <Icon name="alert" />
        <span className="grow">{model.crowded.text}</span>
      </p>,
    );
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
  if (active && active.assignment.assignmentId !== nextId)
    notices.push(
      <button type="button" className="notice" onClick={actions.continueSession} key="working">
        <span className={active.status === 'paused' ? 'dot' : 'dot green'} />
        <span className="grow">
          {active.status === 'paused' ? 'Paused: ' : 'Working on '}
          <b>{active.assignment.title}</b>
          {hintWaiting && <span className="notice-sub">1 hint ready</span>}
        </span>
        <Icon name="chevronRight" />
      </button>,
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
      {model.brief && <Brief brief={model.brief} now={now} send={actions.send} />}
      <Focus model={model} now={now} actions={actions} whyOpen={whyOpen} onWhy={() => setWhyOpen((o) => !o)} />
      {next && whyOpen && (
        <section className="why" aria-label="Why this one">
          <p className="evidence-text" style={{ paddingBottom: 4 }}>
            {next.reason}
          </p>
          <EvidenceList evidence={next.evidence} now={now} />
        </section>
      )}
      {notices.length > 0 && <div className="notices">{notices}</div>}
      <PlanSection items={next ? [next.item, ...model.rest] : model.rest} now={now} actions={actions} mode={planMode} onMode={onPlanMode} />
      <SyncFoot lastCheck={model.lastCheck} now={now} onRefresh={onRefresh} refreshing={refreshing} />
      <AskBar onOpen={() => actions.openAsk('general')} aiDown={aiDown} send={actions.send} />
    </>
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

/** The way into Ask Loomer, pinned to the bottom of Home. Says up front when the AI service is down. */
function AskBar({ onOpen, aiDown, send }: { onOpen: () => void; aiDown: boolean; send: PanelApi['send'] }) {
  return (
    <div className="askbar-wrap">
      {aiDown && <AiServiceDown send={send} />}
      <button type="button" className="askbar" onClick={onOpen}>
        <Icon name="sparkle" />
        Ask Loomer anything
      </button>
    </div>
  );
}

/** Steps the headline down for long actions so it never needs an ellipsis. */
function titleClass(text: string): string {
  return text.length > 90 ? 'h1 xlong' : text.length > 55 ? 'h1 long' : 'h1';
}

type FocusProps = { model: Exclude<HomeModel, { status: 'not-connected' }>; now: Date; actions: HomeActions; whyOpen: boolean; onWhy: () => void };

function Focus({ model, now, actions, whyOpen, onWhy }: FocusProps) {
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
          <p className="focus-text">Something we couldn’t read might change what comes first.</p>
        </section>
      );
    case 'empty':
      return (
        <section className="focus">
          <div className="eyebrow muted">Next step</div>
          <h1 className="h1">You’re all caught up</h1>
          <p className="focus-text">Nothing due soon. New work shows up after the next sync.</p>
        </section>
      );
    case 'ready':
      return <NextStep next={model.next} resume={model.resume} now={now} actions={actions} whyOpen={whyOpen} onWhy={onWhy} />;
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

function NextStep({
  next,
  resume,
  now,
  actions,
  whyOpen,
  onWhy,
}: {
  next: NextAction;
  resume: ResumeBriefing | null;
  now: Date;
  actions: HomeActions;
  whyOpen: boolean;
  onWhy: () => void;
}) {
  const { item } = next;
  const start = startControl(item, actions);
  const clear = useAction();
  const switchTo = useAction();
  // A resume briefing for this same assignment folds in as one "Last time" line.
  const lastTime = resume?.assignment.assignmentId === item.assignmentId ? resume : null;
  const label = lastTime && start.label === 'Start working' ? 'Keep going' : start.label;
  const pick = next.chosenByStudent ? next.loomerPick : null;
  const limited = item.policy.state === 'blocked' || item.policy.state === 'limited' || item.policy.state === 'unresolved';
  const when = startWords(item, now);
  return (
    <section className="focus" aria-label="Next step">
      <div className="eyebrow">
        {next.chosenByStudent ? 'Your pick' : 'Next step'}
        {when && <> · {when}</>}
      </div>
      <h1 className={titleClass(next.action)}>{next.action}</h1>
      <div className="ctx">
        <SubjectTile courseName={item.courseName} size="lg" />
        <span className="grow">
          <button type="button" className="focus-sub" onClick={() => actions.openItem(item.assignmentId)}>
            {item.title}
          </button>
          <span className="focus-meta">
            {item.courseName ?? 'No class'} · {item.due ? <>due <b>{dueWhen(item.due.at, now)}</b></> : 'no due date'}
          </span>
        </span>
      </div>
      {next.change && (
        <p className="changed">
          <Icon name="refresh" size="xs" />
          {next.change}
        </p>
      )}
      {lastTime && lastTime.facts.length > 0 && <p className="focus-line ellipsis">Last time: {lastTime.facts.slice(0, 2).join(' · ')}</p>}
      {limited && <PolicyNote state={item.policy.state} quote={item.policy.quote} source={item.policy.sourceLabel} />}
      <button type="button" className="btn-primary" onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
        {start.busy ? 'Starting…' : label}
        <Icon name="arrowRight" />
      </button>
      {next.chosenByStudent ? (
        <button type="button" className="center-link" disabled={clear.busy} onClick={() => clear.run(() => actions.send({ type: 'choice:clear' }))}>
          {clear.busy ? 'Asking…' : 'Ask Loomer to pick again'}
        </button>
      ) : (
        <button type="button" className="center-link" aria-expanded={whyOpen} onClick={onWhy}>
          {whyOpen ? 'Hide why' : 'Why this one?'}
        </button>
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
          Canvas still lists these. Tell Loomer where they stand.
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
          Did it offline
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
