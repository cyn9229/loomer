// Home tab views, one per HomeModel status, plus the assignment detail (pick 6A).
// Picks: 1A for checking, 2B for the next action. Views render only what the
// model says; they never invent progress, time estimates, or checks.
import { useState, type ReactNode } from 'react';
import { useElapsedSeconds } from './useNow';
import type { HomeModel, NextAction, WorkItem } from '../model/home';
import { groupByClass } from './group';
import type { PanelApi } from './api';
import { DeleteAssignmentData } from './privacy';
import { deadlineLabel, requirementsLabel, shortDate } from './format';
import { Icon } from './Icon';
import {
  AssignmentTile,
  Card,
  DueText,
  EvidenceList,
  itemFlags,
  Pill,
  PolicyNotice,
  ProgressBar,
  RequirementState,
  WorkRow,
} from './parts';

export type HomeActions = {
  openSettings: () => void;
  openItem: (id: string) => void;
  /** Starts a work session; replaces any other session. */
  startSession: (assignmentId: string) => void;
  /** Goes to the running session (Sources tab). */
  continueSession: () => void;
  /** Assignment of the running or paused session, if any. */
  sessionAssignmentId: string | null;
  /** Assignment whose session:start is in flight. */
  startingId: string | null;
  /** Assignment whose item:hide is in flight. */
  hidingId: string | null;
  /** Hides an item from lists and ranking, or restores it. */
  setHidden: (assignmentId: string, hidden: boolean) => void;
  /** Raw message sender for privacy actions (delete data). */
  send?: PanelApi['send'];
};

/** Start or Continue for one assignment, depending on the current session. */
export function startControl(item: WorkItem, actions: HomeActions) {
  const current = actions.sessionAssignmentId === item.assignmentId;
  return {
    label: current ? ('Continue' as const) : ('Start' as const),
    onClick: () => (current ? actions.continueSession() : actions.startSession(item.assignmentId)),
    disabled: actions.startingId !== null,
    busy: actions.startingId === item.assignmentId,
  };
}

type ViewProps<S extends HomeModel['status']> = {
  model: Extract<HomeModel, { status: S }>;
  now: Date;
  actions: HomeActions;
};

export function NotConnectedView({ actions }: { actions: HomeActions }) {
  return (
    <Card>
      <div className="asg">
        <span className="tile lg">
          <Icon name="link" />
        </span>
        <div className="asg-body">
          <h2 className="asg-title">Connect your Canvas</h2>
          <p className="asg-meta">Loomer reads your assignments after you approve your school’s Canvas.</p>
        </div>
      </div>
      <button type="button" className="cta block" style={{ marginTop: 16 }} onClick={actions.openSettings}>
        Open settings
        <Icon name="arrowRight" />
      </button>
      <p className="caption" style={{ marginTop: 10 }}>
        No passwords or school API keys.
      </p>
    </Card>
  );
}

/** Pick 1A: one row per assignment with its requirement state, then known work. */
export function CheckingView({ model, now, actions }: ViewProps<'checking'>) {
  if (model.rest.length === 0 && model.pending.length === 0) return <FindingAssignments />;
  const matched = new Set(model.rest.map((i) => i.title));
  const orphanPending = model.pending.filter((p) => !matched.has(p.title));
  return (
    <>
      <Card label="Reading requirements">
        <p className="card-label">
          <span className="card-title">Reading requirements</span>
          {model.progress.total > 0 && (
            <span className="aside" aria-live="polite">
              {model.progress.checked} of {model.progress.total}
            </span>
          )}
        </p>
        {model.progress.total > 0 && (
          <ProgressBar value={model.progress.checked} max={model.progress.total} label="Requirements read" />
        )}
        {model.rest.filter((i) => !i.hidden).map((item) => {
          const pending = model.pending.find((p) => p.title === item.title);
          return (
            <div className="row" key={item.assignmentId}>
              <RequirementState state={item.requirements} />
              <span className="row-body">
                <span className="row-title">{item.title}</span>
                <span className="row-sub">
                  {pending?.detail ?? requirementsLabel[item.requirements]}
                  {item.courseName && ` · ${item.courseName}`}
                </span>
              </span>
              {item.requirements === 'unreadable' && item.url ? (
                <a className="btn sm" href={item.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              ) : item.replay ? (
                <Pill tone="replay">Replay</Pill>
              ) : null}
            </div>
          );
        })}
        {orphanPending.map((p) => (
          <div className="row" key={p.title}>
            <RequirementState state="checking" />
            <span className="row-body">
              <span className="row-title">{p.title}</span>
              <span className="row-sub">{p.detail}</span>
            </span>
          </div>
        ))}
        <div className="callout accent" style={{ marginTop: 14 }}>
          <span className="tile">
            <Icon name="info" size="sm" />
          </span>
          <p className="callout-body">No top pick until these finish. You can open any assignment now.</p>
        </div>
      </Card>
      <WorkList title="Known work" items={model.rest} now={now} onOpen={actions.openItem} actions={actions} />
    </>
  );
}

/** First check, before any assignment is known. Counts seconds so the wait is visible. */
function FindingAssignments() {
  const seconds = useElapsedSeconds(true);
  return (
    <Card>
      <div className="asg">
        <RequirementState state="checking" />
        <div className="asg-body">
          <h2 className="card-title">Looking for your assignments</h2>
          <p className="asg-meta" aria-live="off">
            Reading your Canvas courses{seconds > 0 ? ` · ${seconds} s` : ''}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function CannotCompareView({ model, now, actions }: ViewProps<'cannot-compare'>) {
  return (
    <>
      <Card>
        <div className="asg">
          <AssignmentTile tone="amber" />
          <div className="asg-body">
            <h2 className="asg-title">Can’t compare reliably yet</h2>
            <p className="asg-meta">Something Loomer could not read could change what comes first.</p>
          </div>
        </div>
        <EvidenceList evidence={model.limitations} now={now} />
      </Card>
      <WorkList title="Pick one yourself" items={model.rest} now={now} onOpen={actions.openItem} actions={actions} />
    </>
  );
}

/** Pick 2B: action headline, chips, two buttons, then "Why this?". */
export function ReadyView({ model, now, actions }: ViewProps<'ready'>) {
  return (
    <>
      <NextActionCard next={model.next} now={now} actions={actions} />
      <Card label="Why this?">
        <details className="disclosure" open>
          <summary>
            Why this?
            <Icon name="chevronUp" size="sm" />
          </summary>
          <EvidenceList evidence={model.next.evidence} now={now} />
        </details>
      </Card>
      <WorkList id="other-work" title="Other work" items={model.rest} now={now} onOpen={actions.openItem} actions={actions} />
    </>
  );
}

function NextActionCard({ next, now, actions }: { next: NextAction; now: Date; actions: HomeActions }) {
  const { item } = next;
  const start = startControl(item, actions);
  const rel = item.due ? deadlineLabel(item.due.at, now) : null;
  return (
    <Card label="Next action">
      {next.aiGenerated ? (
        <p className="card-label accent">
          <Icon name="sparkle" size="sm" />
          Recommended next
        </p>
      ) : (
        <p className="card-label">Your next step</p>
      )}
      <div className="asg">
        <AssignmentTile small />
        <h2 className="asg-title lg">{next.action}</h2>
      </div>
      <p className="asg-meta" style={{ margin: '10px 0 0' }}>
        {item.title}
        {item.courseName && ` · ${item.courseName}`}
      </p>
      <div className="chips" style={{ marginTop: 12 }}>
        <Pill icon="calendar">{item.due ? `Due ${shortDate(item.due.at)}` : 'No due date'}</Pill>
        {rel && <Pill tone={rel.soon ? 'red' : 'accent'}>{rel.text}</Pill>}
        <Pill tone="accent">{item.effort.label}</Pill>
        {itemFlags(item)}
      </div>
      <p className="lede" style={{ marginTop: 12 }}>
        {next.reason}
      </p>
      {item.policy.state !== 'permitted' && item.policy.state !== 'none-found' && (
        <div style={{ marginTop: 12 }}>
          <PolicyNotice item={item} />
        </div>
      )}
      <button type="button" className="cta block" style={{ marginTop: 16 }} onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
        {start.busy ? 'Starting session…' : start.label === 'Continue' ? 'Continue session' : 'Start session'}
        <Icon name="arrowRight" />
      </button>
      <div className="btn-row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
        <OpenInCanvasLink item={item} />
        <a className="link" href="#other-work">
          Pick another
        </a>
      </div>
    </Card>
  );
}

export function EmptyView({ model, now, actions }: ViewProps<'empty'>) {
  return (
    <>
      <Card>
        <div className="asg">
          <span className="tile lg green">
            <Icon name="check" />
          </span>
          <div className="asg-body">
            <h2 className="asg-title">Nothing open right now</h2>
            <p className="asg-meta">Loomer found no open assignments to plan. New ones appear after the next check.</p>
          </div>
        </div>
      </Card>
      {model.rest.length > 0 && <WorkList title="Other known work" items={model.rest} now={now} onOpen={actions.openItem} actions={actions} />}
    </>
  );
}

/**
 * Known work, grouped by class with a class filter. Inside a class: Due soon,
 * Later, then folded "No due date (N)" and "Past due (N)", which stay one tap
 * away because a missing date does not mean unimportant. Hidden items sit in a
 * folded group at the end with Restore.
 */
function WorkList({
  id,
  title,
  items,
  now,
  onOpen,
  actions,
}: {
  id?: string;
  title: string;
  items: WorkItem[];
  now: Date;
  onOpen: (id: string) => void;
  /** When given, rows get Start or Continue and Hide. */
  actions?: HomeActions;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  if (items.length === 0) return null;
  const classes = groupByClass(items);
  const shown = filter ? classes.filter((c) => c.courseKey === filter) : classes;
  const hidden = items.filter((i) => i.hidden && (!filter || i.courseKey === filter));
  const visibleCount = classes.reduce((n, c) => n + c.count, 0);

  const row = (item: WorkItem) => (
    <WorkRow
      key={item.assignmentId}
      item={item}
      now={now}
      onOpen={onOpen}
      start={actions ? startControl(item, actions) : undefined}
      onHide={actions ? () => actions.setHidden(item.assignmentId, true) : undefined}
      hiding={actions?.hidingId === item.assignmentId}
      inClassGroup
    />
  );

  return (
    <section className="card" id={id} tabIndex={id ? -1 : undefined} aria-label={title}>
      <p className="card-label">
        <span className="card-title">{title}</span>
        <span className="aside">
          {visibleCount} {visibleCount === 1 ? 'item' : 'items'}
        </span>
      </p>
      {classes.length > 1 && (
        <div className="filter-chips" role="group" aria-label="Filter by class">
          <button type="button" className="filter-chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
            All classes
          </button>
          {classes.map((c) => (
            <button
              key={c.courseKey}
              type="button"
              className="filter-chip"
              aria-pressed={filter === c.courseKey}
              onClick={() => setFilter(c.courseKey)}
            >
              {c.label} <span>{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {shown.map((c) => (
        <div className="class-group" key={c.courseKey}>
          {(classes.length > 1 || filter) && (
            <p className="class-title">
              {c.label}
              <span>{c.count}</span>
            </p>
          )}
          {c.soon.length > 0 && <Sub label="Due soon">{c.soon.map(row)}</Sub>}
          {c.later.length > 0 && <Sub label="Later">{c.later.map(row)}</Sub>}
          {c.noDate.length > 0 && <Folded label="No due date" count={c.noDate.length}>{c.noDate.map(row)}</Folded>}
          {c.past.length > 0 && <Folded label="Past due" count={c.past.length}>{c.past.map(row)}</Folded>}
        </div>
      ))}
      {hidden.length > 0 && (
        <Folded label="Hidden" count={hidden.length}>
          {hidden.map((item) => (
            <HiddenRow key={item.assignmentId} item={item} actions={actions} />
          ))}
        </Folded>
      )}
    </section>
  );
}

function Sub({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sub-group">
      <p className="sub-label">{label}</p>
      {children}
    </div>
  );
}

function Folded({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <details className="group">
      <summary>
        <Icon name="chevronDown" size="sm" />
        {label} ({count})
      </summary>
      {children}
    </details>
  );
}

function HiddenRow({ item, actions }: { item: WorkItem; actions?: HomeActions }) {
  return (
    <div className="row">
      <span className="row-body">
        <span className="row-title regular">{item.title}</span>
        <span className="row-sub">{item.courseName ?? 'No course'}</span>
      </span>
      {actions && (
        <button type="button" className="btn sm" onClick={() => actions.setHidden(item.assignmentId, false)}>
          Restore
        </button>
      )}
    </div>
  );
}

function OpenInCanvasLink({ item }: { item: WorkItem }) {
  if (!item.url) return <span className="asg-meta">No Canvas link</span>;
  return (
    <a className="link" href={item.url} target="_blank" rel="noreferrer">
      {item.replay ? 'Open replay page' : 'Open in Canvas'}
      <Icon name="external" size="xs" />
    </a>
  );
}

/** Pick 6A: the assignment card with its policy notice and what still works. */
export function AssignmentDetail({ item, now, onBack, actions }: { item: WorkItem; now: Date; onBack: () => void; actions: HomeActions }) {
  const start = startControl(item, actions);
  const flags = itemFlags(item);
  const blocked = item.policy.state === 'blocked';
  return (
    <>
      <button type="button" className="link back" onClick={onBack}>
        <Icon name="chevronLeft" size="sm" />
        Home
      </button>
      <Card label="Assignment">
        <p className="card-label">Assignment</p>
        <div className="asg">
          <AssignmentTile />
          <div className="asg-body">
            <h2 className="asg-title">{item.title}</h2>
            {item.courseName && <div className="asg-meta">{item.courseName}</div>}
            <div className="asg-meta">
              <DueText item={item} now={now} />
            </div>
          </div>
        </div>
        {flags.length > 0 && (
          <div className="chips" style={{ marginTop: 12 }}>
            {flags}
          </div>
        )}
        {(blocked || item.policy.state === 'limited' || item.policy.state === 'unresolved') && (
          <div style={{ marginTop: 14 }}>
            <PolicyNotice item={item} />
          </div>
        )}
        {item.dueConflict && (
          <div className="callout amber" style={{ marginTop: 12 }}>
            <span className="tile amber">
              <Icon name="calendar" size="sm" />
            </span>
            <p className="callout-body">Canvas and the instructions give different due dates. Check both before you plan.</p>
          </div>
        )}
      </Card>
      <Card label="Details">
        <div className="row">
          <RequirementState state={item.requirements} />
          <span className="row-body">
            <span className="row-title">Instructions</span>
            <span className="row-sub">{requirementsLabel[item.requirements]}</span>
          </span>
        </div>
        <div className="row">
          <span className="tile">
            <Icon name="list" size="sm" />
          </span>
          <span className="row-body">
            <span className="row-title">Effort: {item.effort.label}</span>
            <span className="row-sub" style={{ whiteSpace: 'normal' }}>
              {item.effort.reason ?? 'Not enough checked requirements to say.'}
            </span>
          </span>
        </div>
      </Card>
      <button type="button" className="cta block" onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
        {start.busy ? 'Starting session…' : start.label === 'Continue' ? 'Continue session' : 'Start session'}
        <Icon name="arrowRight" />
      </button>
      <div className="btn-row" style={{ justifyContent: 'space-between' }}>
        <OpenInCanvasLink item={item} />
        <button type="button" className="link" onClick={() => actions.setHidden(item.assignmentId, !item.hidden)}>
          {item.hidden ? 'Restore to lists' : 'Hide from lists'}
        </button>
      </div>
      {actions.send && (
        <div className="row-actions center">
          <DeleteAssignmentData assignmentId={item.assignmentId} send={actions.send} />
        </div>
      )}
      {blocked && <p className="caption">Hints, reviews, and draft reading are off here. Your session still keeps your draft and pages together.</p>}
    </>
  );
}
