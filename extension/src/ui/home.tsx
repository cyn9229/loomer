// Home tab. HomeHero is the band's main message for each HomeModel status (the
// next step, first sync, all caught up, ...); HomeBody is the sheet below it
// (older-work review, why this, your work). Views render only what the model
// says; they never invent progress, time estimates, or checks.
import { useState } from 'react';
import type { HomeModel, NextAction, OlderReview, ResumeBriefing, WorkItem } from '../model/home';
import { useAction, type PanelApi } from './api';
import { calendarDaysUntil, checkProblem, dueWhen, observedAt } from './format';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { ClassTag, EvidenceList, PolicyBlock, WorkRow } from './parts';
import { useElapsedSeconds } from './useNow';

export type HomeActions = {
  openSettings: () => void;
  openItem: (id: string) => void;
  /** Starts a work session; replaces any other session. */
  startSession: (assignmentId: string) => void;
  /** Goes to the running session (Chat tab). */
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
};

/** Start or Continue for one assignment, depending on the current session. */
export function startControl(item: WorkItem, actions: HomeActions) {
  const current = actions.sessionAssignmentId === item.assignmentId;
  return {
    label: current ? 'Keep going' : 'Start session',
    onClick: () => (current ? actions.continueSession() : actions.startSession(item.assignmentId)),
    disabled: actions.startingId !== null,
    busy: actions.startingId === item.assignmentId,
  };
}

type HeroProps = {
  model: HomeModel;
  /** Folded into the hero when it is for the same assignment as the next step. */
  resume: ResumeBriefing | null;
  now: Date;
  actions: HomeActions;
  whyOpen: boolean;
  onWhy: () => void;
};

/** The band's message: what to do next, or why there is no next step yet. */
export function HomeHero({ model, resume, now, actions, whyOpen, onWhy }: HeroProps) {
  switch (model.status) {
    case 'not-connected':
      return (
        <>
          <div className="hero-mark">
            <LogoMark size={52} light />
          </div>
          <h1 className="hero-title">Less managing. More learning.</h1>
          <p className="hero-sub">Connect Canvas and Loomer finds what to work on next.</p>
          <div className="hero-act">
            <button type="button" className="hero-btn" onClick={actions.openSettings}>
              Connect Canvas
              <Icon name="arrowRight" />
            </button>
          </div>
        </>
      );
    case 'checking':
      return model.progress.total > 0 ? (
        <>
          <h1 className="hero-title md">Reading your assignments…</h1>
          <p className="hero-sub" aria-live="polite">
            {model.progress.checked} of {model.progress.total} done. Your next step shows up when we finish.
          </p>
          <div
            className="hero-progress"
            role="progressbar"
            aria-label="Assignments read"
            aria-valuemin={0}
            aria-valuemax={model.progress.total}
            aria-valuenow={model.progress.checked}
          >
            <span style={{ transform: `scaleX(${Math.min(1, model.progress.checked / model.progress.total)})` }} />
          </div>
        </>
      ) : (
        <FindingHero />
      );
    case 'cannot-compare':
      return (
        <>
          <h1 className="hero-title md">Pick one yourself for now</h1>
          <p className="hero-sub">Something we couldn’t read might change what comes first.</p>
        </>
      );
    case 'empty':
      return (
        <>
          <h1 className="hero-title md">You’re all caught up</h1>
          <p className="hero-sub">Nothing due soon. New work shows up after the next sync.</p>
        </>
      );
    case 'ready':
      return <NextHero next={model.next} resume={resume} now={now} actions={actions} whyOpen={whyOpen} onWhy={onWhy} />;
  }
}

/** First sync, before any assignment is known. Counts seconds so the wait is visible. */
function FindingHero() {
  const seconds = useElapsedSeconds(true);
  return (
    <>
      <h1 className="hero-title md">Looking for your assignments…</h1>
      <p className="hero-sub" aria-live="off">
        Reading your Canvas classes{seconds > 0 ? ` · ${seconds} s` : ''}
      </p>
    </>
  );
}

/** Steps the headline down for long actions so it never needs an ellipsis. */
function titleSize(text: string): string {
  return text.length > 90 ? 'hero-title xlong' : text.length > 55 ? 'hero-title long' : 'hero-title';
}

function NextHero({
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
  // A resume briefing for this same assignment folds into the hero as one line.
  const lastTime = resume?.assignment.assignmentId === item.assignmentId ? resume : null;
  const label = lastTime && start.label === 'Start session' ? 'Keep going' : start.label;
  const pick = next.chosenByStudent ? next.loomerPick : null;
  return (
    <>
      <div className="kick">
        <span>{next.chosenByStudent ? 'Your pick' : 'Up next'}</span>
        <span className="grow" />
        <span className="band-pill">{item.due ? `Due ${dueWhen(item.due.at, now)}` : 'No due date'}</span>
      </div>
      <h1 className={titleSize(next.action)}>{next.action}</h1>
      <button type="button" className="hero-item clamp" onClick={() => actions.openItem(item.assignmentId)}>
        {item.title}
        {item.courseName && <span className="hero-course"> · {item.courseName}</span>}
      </button>
      {lastTime && lastTime.facts.length > 0 && <p className="hero-sub ellipsis">Last time: {lastTime.facts.slice(0, 2).join(' · ')}</p>}
      <div className="hero-act">
        <button type="button" className="hero-btn" onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
          {start.busy ? 'Starting…' : label}
          <Icon name="arrowRight" />
        </button>
        {next.chosenByStudent ? (
          <button type="button" className="hero-link" disabled={clear.busy} onClick={() => clear.run(() => actions.send({ type: 'choice:clear' }))}>
            {clear.busy ? 'Asking…' : 'Ask Loomer again'}
          </button>
        ) : (
          <button type="button" className="hero-link" aria-expanded={whyOpen} onClick={onWhy}>
            {whyOpen ? 'Hide why' : 'Why this?'}
          </button>
        )}
      </div>
      {pick && (
        <p className="hero-alt">
          <span className="clamp">
            Loomer would start with <b>{pick.item.title}</b>
          </span>
          <button
            type="button"
            className="hero-link"
            title={pick.reason}
            disabled={switchTo.busy}
            aria-busy={switchTo.busy}
            onClick={() => switchTo.run(() => actions.send({ type: 'choice:set', assignmentId: pick.item.assignmentId }))}
          >
            {switchTo.busy ? 'Switching…' : 'Switch'}
          </button>
        </p>
      )}
      {(clear.error ?? switchTo.error) && <p className="hero-sub">{clear.error ?? switchTo.error}</p>}
    </>
  );
}

type BodyProps = {
  model: Exclude<HomeModel, { status: 'not-connected' }>;
  now: Date;
  actions: HomeActions;
  whyOpen: boolean;
};

/** The sheet under the band: anything needing an answer first, then your work. */
export function HomeBody({ model, now, actions, whyOpen }: BodyProps) {
  const problem = model.lastCheck && model.lastCheck.outcome !== 'ok' && model.lastCheck.outcome !== 'partial' ? checkProblem(model.lastCheck.outcome) : null;
  return (
    <>
      {problem && model.lastCheck && (
        <div className="mini amber" role="status">
          <Icon name="alert" />
          <span>
            {problem} Showing what we saw {observedAt(model.lastCheck.at, now)}.
          </span>
        </div>
      )}
      {model.olderReview && model.olderReview.items.length > 0 && <OlderReviewBlock review={model.olderReview} now={now} actions={actions} />}
      {model.status === 'ready' && <NextDetails next={model.next} now={now} whyOpen={whyOpen} />}
      {model.status === 'checking' && model.pending.length > 0 && (
        <div className="block">
          <div className="block-k">Still reading</div>
          {model.pending.map((p) => (
            <div className="row-line" key={p.title}>
              <span className="grow">
                <span className="row-title clamp">{p.title}</span>
                <span className="row-sub">{p.detail}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {model.status === 'cannot-compare' && model.limitations.length > 0 && (
        <div className="block amber">
          <div className="block-k">
            <Icon name="alert" />
            What we couldn’t check
          </div>
          <EvidenceList evidence={model.limitations} now={now} />
        </div>
      )}
      <WorkList items={model.rest} now={now} actions={actions} />
    </>
  );
}

/** Why this step, and the teacher's AI rule. */
function NextDetails({ next, now, whyOpen }: { next: NextAction; now: Date; whyOpen: boolean }) {
  const { item } = next;
  return (
    <>
      {(item.policy.state === 'blocked' || item.policy.state === 'limited' || item.policy.state === 'unresolved') && (
        <PolicyBlock state={item.policy.state} quote={item.policy.quote} source={item.policy.sourceLabel} />
      )}
      {whyOpen && (
        <div className="block violet" aria-label="Why this?">
          <div className="block-k">
            <Icon name="sparkle" />
            Why this
          </div>
          <p className="block-text">{next.reason}</p>
          <EvidenceList evidence={next.evidence} now={now} />
        </div>
      )}
    </>
  );
}

/**
 * One quiet review of older past-due work. Each item gets three answers; "Done
 * for now" marks the whole review seen (older:reviewed) so it only comes back
 * on new evidence.
 */
function OlderReviewBlock({ review, now, actions }: { review: NonNullable<OlderReview>; now: Date; actions: HomeActions }) {
  const done = useAction();
  const n = review.items.length;
  return (
    <details className="block fold-block" aria-label="Older work">
      <summary>
        <Icon name="clock" />
        <span className="grow">{n === 1 ? '1 older item needs a look' : `${n} older items need a look`}</span>
        <Icon name="chevronRight" size="sm" />
      </summary>
      <p className="row-sub">Canvas still lists these. Tell us where they stand.</p>
      {review.items.map(({ item, reason }) => (
        <OlderItem key={item.assignmentId} item={item} reason={reason} now={now} actions={actions} />
      ))}
      <div className="block-act">
        <button
          type="button"
          className="link"
          disabled={done.busy}
          aria-busy={done.busy}
          onClick={() => done.run(() => actions.send({ type: 'older:reviewed', assignmentIds: review.items.map((i) => i.item.assignmentId) }))}
        >
          {done.busy ? 'Saving…' : 'Done for now'}
        </button>
      </div>
      {done.error && <p className="status-line error">{done.error}</p>}
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
  const correct = (correction: 'kept-active' | 'done-offline') => () =>
    actions.send({ type: 'context:set', assignmentId: item.assignmentId, correction });
  return (
    <div className="old">
      <div className="row-k">
        <ClassTag item={item} />
        <span className="grow" />
        <span className="when">{item.due ? dueWhen(item.due.at, now) : 'No due date'}</span>
      </div>
      <p className="row-title clamp">{item.title}</p>
      <p className="row-sub">{reason}</p>
      <div className="three">
        <button type="button" disabled={act.busy} aria-busy={verb === 'keep'} onClick={() => run('keep', correct('kept-active'))}>
          Still doing it
        </button>
        <button type="button" disabled={act.busy} aria-busy={verb === 'done'} onClick={() => run('done', correct('done-offline'))}>
          Did it offline
        </button>
        <button
          type="button"
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

type Filter = WorkItem['bucket'] | 'hidden';

const filters: { id: Filter; label: string }[] = [
  { id: 'soon', label: 'Soon' },
  { id: 'later', label: 'Later' },
  { id: 'no-date', label: 'No date' },
  { id: 'past', label: 'Past' },
  { id: 'hidden', label: 'Hidden' },
];

/**
 * Your work: a week strip for orientation, then one bucket at a time. No date
 * and Past stay one tap away, because a missing date does not mean unimportant.
 */
function WorkList({ items, now, actions }: { items: WorkItem[]; now: Date; actions: HomeActions }) {
  const [chosen, setChosen] = useState<Filter | null>(null);
  if (items.length === 0) return null;

  const visible = items.filter((i) => !i.hidden);
  const inFilter = (f: Filter) => (f === 'hidden' ? items.filter((i) => i.hidden) : visible.filter((i) => i.bucket === f));
  const counts = new Map(filters.map((f) => [f.id, inFilter(f.id).length]));
  const current = chosen ?? filters.find((f) => (counts.get(f.id) ?? 0) > 0)?.id ?? 'soon';
  const rows = inFilter(current).sort((a, b) => (current === 'past' ? dueTime(b) - dueTime(a) : dueTime(a) - dueTime(b)));

  return (
    <section aria-label="Your work">
      <div className="sec">
        <h2>Your work</h2>
        <span className="n">{visible.length}</span>
      </div>
      <WeekStrip items={visible} now={now} />
      <div className="filter" role="group" aria-label="Show">
        {filters
          .filter((f) => f.id === current || (counts.get(f.id) ?? 0) > 0)
          .map((f) => (
            <button key={f.id} type="button" aria-pressed={current === f.id} onClick={() => setChosen(f.id)}>
              {f.label} <b>{counts.get(f.id)}</b>
            </button>
          ))}
      </div>
      <div className="list">
        {rows.length === 0 && <p className="empty-line">Nothing here.</p>}
        {current === 'hidden'
          ? rows.map((item) => (
              <div className="row-line" key={item.assignmentId}>
                <span className="grow">
                  <span className="row-title clamp">{item.title}</span>
                  <span className="row-sub">{item.courseName ?? 'No class'}</span>
                </span>
                <button
                  type="button"
                  className="btn sm"
                  disabled={actions.hidingId === item.assignmentId}
                  aria-busy={actions.hidingId === item.assignmentId}
                  onClick={() => actions.setHidden(item.assignmentId, false)}
                >
                  Restore
                </button>
              </div>
            ))
          : rows.map((item) => <WorkRow key={item.assignmentId} item={item} now={now} onOpen={actions.openItem} />)}
      </div>
    </section>
  );
}

/** Today and the next six days, with a dot per item due (up to three). Orientation only. */
function WeekStrip({ items, now }: { items: WorkItem[]; now: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
  const due = new Map<number, number>();
  for (const item of items) {
    if (!item.due) continue;
    const offset = calendarDaysUntil(new Date(item.due.at), now);
    if (offset >= 0 && offset < 7) due.set(offset, (due.get(offset) ?? 0) + 1);
  }
  return (
    <div className="strip" style={{ margin: '8px 0' }} aria-hidden="true">
      {days.map((d, i) => (
        <span key={i} className={i === 0 ? 'day today' : 'day'}>
          {d.toLocaleDateString(undefined, { weekday: 'narrow' })}
          <b>{d.getDate()}</b>
          <s>
            {Array.from({ length: Math.min(3, due.get(i) ?? 0) }, (_, j) => (
              <i key={j} />
            ))}
          </s>
        </span>
      ))}
    </div>
  );
}

function dueTime(item: WorkItem): number {
  return item.due ? new Date(item.due.at).getTime() : Number.MAX_SAFE_INTEGER;
}

