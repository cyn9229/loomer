// Home tab views, one per HomeModel status, plus the assignment detail (pick 6A).
// Picks: 1A for checking, 2B for the next action. Views render only what the
// model says; they never invent progress, time estimates, or checks.
import type { HomeModel, NextAction, WorkItem } from '../model/home';
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
  RequirementState,
  WorkRow,
} from './parts';

export type HomeActions = {
  openSettings: () => void;
  openItem: (id: string) => void;
};

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
  if (model.rest.length === 0 && model.pending.length === 0) {
    return (
      <Card>
        <div className="asg">
          <RequirementState state="checking" />
          <div className="asg-body">
            <h2 className="card-title">Looking for your assignments</h2>
            <p className="asg-meta">Loomer is reading your Canvas courses.</p>
          </div>
        </div>
      </Card>
    );
  }
  const matched = new Set(model.rest.map((i) => i.title));
  const orphanPending = model.pending.filter((p) => !matched.has(p.title));
  return (
    <>
      <Card label="Checking assignment requirements">
        <p className="card-label">
          Checking assignment requirements
          {model.progress.total > 0 && (
            <span className="aside">
              {model.progress.checked} of {model.progress.total} read
            </span>
          )}
        </p>
        {model.rest.map((item) => {
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
      <WorkList title="Known work" items={model.rest} now={now} onOpen={actions.openItem} />
    </>
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
      <WorkList title="Pick one yourself" items={model.rest} now={now} onOpen={actions.openItem} />
    </>
  );
}

/** Pick 2B: action headline, chips, two buttons, then "Why this?". */
export function ReadyView({ model, now, actions }: ViewProps<'ready'>) {
  return (
    <>
      <NextActionCard next={model.next} now={now} />
      <Card label="Why this?">
        <details className="disclosure" open>
          <summary>
            Why this?
            <Icon name="chevronUp" size="sm" />
          </summary>
          <EvidenceList evidence={model.next.evidence} now={now} />
        </details>
      </Card>
      <WorkList id="other-work" title="Other work" items={model.rest} now={now} onOpen={actions.openItem} />
    </>
  );
}

function NextActionCard({ next, now }: { next: NextAction; now: Date }) {
  const { item } = next;
  const rel = item.due ? deadlineLabel(item.due.at, now) : null;
  return (
    <Card label="Next action">
      <p className="card-label accent">
        <Icon name="sparkle" size="sm" />
        {next.aiGenerated ? 'Recommended next' : 'Your next step'}
      </p>
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
      <div className="btn-row" style={{ marginTop: 16, flexWrap: 'nowrap' }}>
        <OpenInCanvas item={item} grow />
        <a className="btn pill-shape" href="#other-work">
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
      {model.rest.length > 0 && <WorkList title="Other known work" items={model.rest} now={now} onOpen={actions.openItem} />}
    </>
  );
}

function WorkList({
  id,
  title,
  items,
  now,
  onOpen,
}: {
  id?: string;
  title: string;
  items: WorkItem[];
  now: Date;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="card" id={id} tabIndex={id ? -1 : undefined} aria-label={title}>
      <p className="card-label">
        <span className="card-title">{title}</span>
        <span className="aside">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </p>
      {items.map((item) => (
        <WorkRow key={item.assignmentId} item={item} now={now} onOpen={onOpen} />
      ))}
    </section>
  );
}

function OpenInCanvas({ item, grow }: { item: WorkItem; grow?: boolean }) {
  if (!item.url) {
    return (
      <button type="button" className="cta" disabled style={grow ? { flex: 1 } : undefined}>
        No Canvas link
      </button>
    );
  }
  return (
    <a className="cta" href={item.url} target="_blank" rel="noreferrer" style={grow ? { flex: 1 } : undefined}>
      {item.replay ? 'Open replay page' : 'Open in Canvas'}
      <Icon name="external" size="sm" />
    </a>
  );
}

/** Pick 6A: the assignment card with its policy notice and what still works. */
export function AssignmentDetail({ item, now, onBack }: { item: WorkItem; now: Date; onBack: () => void }) {
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
      <OpenInCanvas item={item} />
      {blocked && <p className="caption">Hints, reviews, and draft reading are off here.</p>}
    </>
  );
}
