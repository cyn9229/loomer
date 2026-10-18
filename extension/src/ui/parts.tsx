// Shared building blocks for the side panel and options page. Each part renders
// model data as given and adds no claims of its own.
import type { ReactNode } from 'react';
import type { CheckInfo, Evidence, WorkItem } from '../model/home';
import { calendarDaysUntil, checkProblem, evidenceKindLabel, monthDay, observedAt, policyNotice, timeOf } from './format';
import { Icon, type IconName } from './Icon';

type Tone = 'accent' | 'green' | 'red' | 'amber' | 'replay' | 'gray';

/** A colored status word (settings only). No capsule: color plus an optional icon. */
export function Pill({ tone = 'gray', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={tone === 'gray' ? 'pill' : `pill ${tone}`}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

/** Visible label for replay data. Required wherever a replay check appears. */
export function ReplayPill() {
  return <Pill tone="replay">Replay data</Pill>;
}

/** Short words for what the student must not miss about an item, shown after the class. */
function itemFlags(item: WorkItem): string[] {
  const flags: string[] = [];
  if (item.dueConflict) flags.push('two due dates');
  if (item.policy.state === 'blocked') flags.push('no AI');
  if (item.requirements === 'unreadable') flags.push('can’t read it');
  if (item.correction === 'kept-active') flags.push('kept on your list');
  return flags;
}

/**
 * One agenda row: a time column, then the title with the class under it.
 * `when` picks the left column: the due time (inside a day group) or the date
 * (in Later, No due date, and Past due).
 */
export function WorkRow({ item, now, when, onOpen }: { item: WorkItem; now: Date; when: 'time' | 'date'; onOpen: (id: string) => void }) {
  const flags = itemFlags(item);
  const soon = item.due ? isSoon(item.due.at, now) : false;
  const left = !item.due ? '' : when === 'time' ? timeOf(item.due.at) : monthDay(item.due.at);
  return (
    <button type="button" className="item" onClick={() => onOpen(item.assignmentId)}>
      <span className={soon ? 'item-t soon' : 'item-t'}>{left}</span>
      <span className="item-body">
        <span className="item-title">{item.title}</span>
        <span className="item-sub">
          {item.courseName ?? 'No class'}
          {flags.length > 0 && <span className="flag"> · {flags.join(' · ')}</span>}
        </span>
      </span>
    </button>
  );
}

/** Due today or tomorrow, and not passed: the only things shown in the accent. */
export function isSoon(iso: string, now: Date): boolean {
  const at = new Date(iso);
  return at.getTime() >= now.getTime() && calendarDaysUntil(at, now) <= 1;
}

/** A teacher's AI rule, as one quiet note with the quote and where it came from. */
export function PolicyNote({ state, quote, source }: { state: WorkItem['policy']['state']; quote?: string; source?: string }) {
  const notice = policyNotice[state];
  if (!notice) return null;
  return (
    <div className="policy" role="note">
      <Icon name="shield" />
      <div className="grow">
        <b>{notice.title}</b>
        {quote && <span className="quote">“{quote}”</span>}
        {source && <span className="source">{source}</span>}
      </div>
    </div>
  );
}

const evidenceIcon: Record<Evidence['kind'], IconName> = {
  'school-fact': 'calendar',
  'ai-interpretation': 'sparkle',
  'student-context': 'user',
  limitation: 'alert',
};

/** "Why this?" rows. Quotes appear only when the model supplies one. */
export function EvidenceList({ evidence, now }: { evidence: Evidence[]; now: Date }) {
  return (
    <>
      {evidence.map((e, i) => (
        <div className="evidence" key={i}>
          <Icon name={evidenceIcon[e.kind]} />
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
      ))}
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
            {problem ? 'Tried to sync' : 'Synced with Canvas'} at {observedAt(lastCheck.at, now)}
            {problem && <span className="foot-problem">{problem}</span>}
          </>
        ) : (
          'Hasn’t synced with Canvas yet'
        )}
      </span>
      {onRefresh && (
        <button type="button" className="link muted" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      )}
    </div>
  );
}
