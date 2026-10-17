// Shared building blocks for the side panel and options page. Each part renders
// model data as given and adds no claims of its own.
import type { ReactNode } from 'react';
import type { CheckInfo, Evidence, RequirementsState, WorkItem } from '../model/home';
import {
  checkProblem,
  dateTime,
  deadlineLabel,
  dueSourceLabel,
  evidenceKindLabel,
  observedAt,
  policyNotice,
  requirementsLabel,
  shortDate,
} from './format';
import { Icon, type IconName } from './Icon';
import { DocGlyph } from './Logo';

export function Card({ children, tinted, label }: { children: ReactNode; tinted?: boolean; label?: string }) {
  return (
    <section className={tinted ? 'card tinted' : 'card'} aria-label={label}>
      {children}
    </section>
  );
}

type Tone = 'accent' | 'green' | 'red' | 'amber' | 'replay' | 'gray';

export function Pill({ tone = 'gray', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={tone === 'gray' ? 'pill' : `pill ${tone}`}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

/** Visible label for replay data. Required wherever a replay item or check appears. */
export function ReplayPill() {
  return <Pill tone="replay">Replay</Pill>;
}

const requirementIcon: Record<RequirementsState, { name: IconName; className: string }> = {
  checked: { name: 'checkCircle', className: 'ok' },
  checking: { name: 'halfCircle', className: 'run' },
  unreadable: { name: 'xCircle', className: 'no' },
  'not-checked': { name: 'emptyCircle', className: 'idle' },
};

/** Icon plus a hidden text label, so the state never depends on color alone. */
export function RequirementState({ state }: { state: RequirementsState }) {
  const { name, className } = requirementIcon[state];
  return (
    <span className={`state-icon ${className}`}>
      <Icon name={name} label={requirementsLabel[state]} />
    </span>
  );
}

export function AssignmentTile({ small, tone }: { small?: boolean; tone?: 'amber' }) {
  const cls = ['asg-tile', small ? 'sm' : '', tone ?? ''].filter(Boolean).join(' ');
  return (
    <span className={cls} aria-hidden="true">
      {tone === 'amber' ? <Icon name="alert" /> : <DocGlyph size={small ? 26 : 32} />}
    </span>
  );
}

/** Due line with the relative deadline. Shows both sides when the sources disagree. */
export function DueText({ item, now }: { item: WorkItem; now: Date }) {
  if (!item.due) return <>No due date found</>;
  const rel = deadlineLabel(item.due.at, now);
  const from = dueSourceLabel(item);
  return (
    <>
      Due {dateTime(item.due.at)}
      {from && ` (${from})`} · <span className={rel.soon ? 'danger-text' : undefined}>{rel.text}</span>
    </>
  );
}

/** Pills that flag what the student must not miss about an item. */
export function itemFlags(item: WorkItem): ReactNode[] {
  const flags: ReactNode[] = [];
  if (item.replay) flags.push(<ReplayPill key="replay" />);
  if (item.dueConflict)
    flags.push(
      <Pill key="conflict" tone="amber" icon="alert">
        Two due dates
      </Pill>,
    );
  if (item.policy.state === 'blocked')
    flags.push(
      <Pill key="ai" tone="amber" icon="shield">
        AI off
      </Pill>,
    );
  if (item.requirements === 'unreadable')
    flags.push(
      <Pill key="unread" tone="red">
        Instructions unreadable
      </Pill>,
    );
  return flags;
}

/** One assignment in a list. Clicking opens its detail in the panel. */
export function WorkRow({ item, now, onOpen }: { item: WorkItem; now: Date; onOpen?: (id: string) => void }) {
  const flags = itemFlags(item);
  const sub = [item.courseName, item.due ? shortDate(item.due.at) : 'No due date'].filter(Boolean).join(' · ');
  const content = (
    <>
      <span className="row-body">
        <span className="row-title">{item.title}</span>
        <span className="row-sub">{sub}</span>
        {flags.length > 0 && <span className="row-pills">{flags}</span>}
      </span>
      <span className="row-end">
        <Pill>{item.effort.label}</Pill>
        {onOpen && <Icon name="chevronRight" size="sm" />}
      </span>
    </>
  );
  if (!onOpen) return <div className="row">{content}</div>;
  return (
    <button type="button" className="row" onClick={() => onOpen(item.assignmentId)}>
      {content}
    </button>
  );
}

/** The pick 6A notice: the rule, quoted, with where it came from. */
export function PolicyNotice({ item }: { item: WorkItem }) {
  const notice = policyNotice[item.policy.state];
  if (!notice) return null;
  return (
    <div className={`callout ${notice.tone}`} role="note">
      <span className={notice.tone === 'amber' ? 'tile amber' : 'tile'}>
        <Icon name="shield" />
      </span>
      <div className="callout-body">
        <strong className="callout-title">{notice.title}</strong>
        {item.policy.quote && <span className="quote">“{item.policy.quote}”</span>}
        {item.policy.sourceLabel && (
          <span className="source">
            <Icon name="doc" size="xs" />
            {item.policy.sourceLabel}
          </span>
        )}
      </div>
    </div>
  );
}

const evidenceIcon: Record<Evidence['kind'], { name: IconName; tone: string }> = {
  'school-fact': { name: 'list', tone: 'tile' },
  'ai-interpretation': { name: 'sparkle', tone: 'tile' },
  'student-context': { name: 'user', tone: 'tile green' },
  limitation: { name: 'alert', tone: 'tile amber' },
};

/** "Why this?" rows. Quotes appear only when the model supplies one. */
export function EvidenceList({ evidence, now }: { evidence: Evidence[]; now: Date }) {
  return (
    <>
      {evidence.map((e, i) => {
        const { name, tone } = evidenceIcon[e.kind];
        return (
          <div className="evidence" key={i}>
            <span className={tone}>
              <Icon name={name} size="sm" />
            </span>
            <div className="row-body">
              <span className="evidence-kind">{evidenceKindLabel[e.kind]}</span>
              <div className="evidence-text">{e.text}</div>
              {e.quote && e.kind === 'ai-interpretation' && <span className="quote-label">From the assignment</span>}
              {e.quote && <span className="quote">“{e.quote}”</span>}
              <span className="source">
                {e.sourceUrl ? (
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                    {e.sourceLabel}
                  </a>
                ) : (
                  e.sourceLabel
                )}
                {e.observedAt && <> · checked {observedAt(e.observedAt, now)}</>}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Last Canvas check, with partial coverage and failures stated plainly. */
export function CheckBar({
  lastCheck,
  now,
  onRefresh,
  refreshing,
}: {
  lastCheck: CheckInfo | null;
  now: Date;
  onRefresh?: () => void;
  refreshing: boolean;
}) {
  const problem = lastCheck ? checkProblem(lastCheck.partial && lastCheck.outcome === 'ok' ? 'partial' : lastCheck.outcome) : null;
  return (
    <div className="checkbar" role="status">
      <span className={problem ? 'tile amber' : 'tile'}>
        <Icon name={problem ? 'alert' : 'refresh'} size="sm" />
      </span>
      <span className="grow">
        {lastCheck ? (
          <>
            <strong>Canvas</strong> · {lastCheck.courses} {lastCheck.courses === 1 ? 'course' : 'courses'} ·{' '}
            {problem ? 'tried' : 'checked'} {observedAt(lastCheck.at, now)}
            {problem && <span className="checkbar-problem">{problem}</span>}
          </>
        ) : (
          'No check has finished yet'
        )}
      </span>
      {lastCheck?.replay && <ReplayPill />}
      {onRefresh && (
        <button type="button" className="btn sm" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Checking' : 'Refresh'}
        </button>
      )}
    </div>
  );
}
