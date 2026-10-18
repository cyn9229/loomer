// Shared building blocks for the side panel and options page. Each part renders
// model data as given and adds no claims of its own.
import type { ReactNode } from 'react';
import type { CheckInfo, Evidence, WorkItem } from '../model/home';
import { checkProblem, dueBadge, dueWhen, evidenceKindLabel, observedAt, policyNotice } from './format';
import { Icon, type IconName } from './Icon';

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

/** The class an item belongs to, as a neutral tag. */
export function ClassTag({ item }: { item: WorkItem }) {
  return <span className="tag">{item.courseName ?? 'No class'}</span>;
}

/** Pills that flag what the student must not miss about an item. Replay is labeled once in the header, not per row. */
export function itemFlags(item: WorkItem, now: Date): ReactNode[] {
  const flags: ReactNode[] = [];
  const badge = item.due ? dueBadge(item.due.at, now) : null;
  if (badge)
    flags.push(
      <Pill key="due" tone="red">
        {badge}
      </Pill>,
    );
  if (item.dueConflict)
    flags.push(
      <Pill key="conflict" tone="amber">
        Two due dates
      </Pill>,
    );
  if (item.policy.state === 'blocked') flags.push(<Pill key="ai">No AI</Pill>);
  if (item.requirements === 'unreadable') flags.push(<Pill key="unread">Can’t read</Pill>);
  if (item.correction === 'kept-active')
    flags.push(
      <Pill key="kept" tone="accent">
        Kept on list
      </Pill>,
    );
  return flags;
}

/** One assignment in a list: class tag, flags, when it is due, then the title. */
export function WorkRow({ item, now, onOpen }: { item: WorkItem; now: Date; onOpen?: (id: string) => void }) {
  const content = (
    <>
      <span className="row-k">
        <ClassTag item={item} />
        {itemFlags(item, now)}
        <span className="grow" />
        <span className="when">{item.due ? dueWhen(item.due.at, now) : 'No due date'}</span>
      </span>
      <span className="row-title clamp">{item.title}</span>
    </>
  );
  if (!onOpen) return <div className="row">{content}</div>;
  return (
    <button type="button" className="row" onClick={() => onOpen(item.assignmentId)}>
      {content}
    </button>
  );
}

/** A teacher's AI rule: what it means, quoted, with where it came from. */
export function PolicyBlock({ state, quote, source }: { state: WorkItem['policy']['state']; quote?: string; source?: string }) {
  const notice = policyNotice[state];
  if (!notice) return null;
  return (
    <div className={notice.tone === 'amber' ? 'block amber' : 'block violet'} role="note">
      <div className="block-k">
        <Icon name="shield" />
        {notice.title}
      </div>
      {quote && <span className="quote">“{quote}”</span>}
      {source && (
        <span className="source">
          <Icon name="doc" size="xs" />
          {source}
        </span>
      )}
    </div>
  );
}

const evidenceIcon: Record<Evidence['kind'], { name: IconName; amber?: boolean }> = {
  'school-fact': { name: 'calendar' },
  'ai-interpretation': { name: 'sparkle' },
  'student-context': { name: 'user' },
  limitation: { name: 'alert', amber: true },
};

/** "Why this?" rows. Quotes appear only when the model supplies one. */
export function EvidenceList({ evidence, now }: { evidence: Evidence[]; now: Date }) {
  return (
    <>
      {evidence.map((e, i) => {
        const { name, amber } = evidenceIcon[e.kind];
        return (
          <div className="evidence" key={i}>
            <span className={amber ? 'evidence-dot amber' : 'evidence-dot'}>
              <Icon name={name} />
            </span>
            <div className="grow">
              <span className="evidence-kind">{evidenceKindLabel[e.kind]}</span>
              <div className="evidence-text">{e.text}</div>
              {e.quote && <span className="quote">“{e.quote}”</span>}
              <span className="source">
                {e.sourceUrl ? (
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                    {e.sourceLabel}
                  </a>
                ) : (
                  e.sourceLabel
                )}
                {e.observedAt && <> · {observedAt(e.observedAt, now)}</>}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Last Canvas sync at the bottom of Home, with partial coverage and failures stated plainly. */
export function SyncFoot({
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
    <div className="foot" role="status">
      <span className="grow">
        {lastCheck ? (
          <>
            {problem ? 'Tried' : 'Synced with'} Canvas at {observedAt(lastCheck.at, now)} · {lastCheck.courses}{' '}
            {lastCheck.courses === 1 ? 'class' : 'classes'}
            {problem && <span className="foot-problem">{problem}</span>}
          </>
        ) : (
          'Hasn’t synced with Canvas yet'
        )}
      </span>
      {onRefresh && (
        <button type="button" className="link" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>
          <Icon name="refresh" size="xs" />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      )}
    </div>
  );
}
