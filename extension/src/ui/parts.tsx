// Shared building blocks for the side panel and options page. Each part renders
// model data as given and adds no claims of its own.
import { useState, type ReactNode } from 'react';
import type { CheckInfo, Evidence, RoomLevel, WorkItem } from '../model/home';
import { calendarDaysUntil, checkProblem, evidenceKindLabel, monthDay, observedAt, policyNotice, timeOf, weekday } from './format';
import { Icon, type IconName } from './Icon';
import { subjectIcon } from './subject';
import { typeLabel } from './workType';

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

/** The class's subject icon in a soft square. */
export function SubjectTile({ courseName, size }: { courseName: string | null; size?: 'lg' }) {
  return (
    <span className={size ? `subject ${size}` : 'subject'} aria-hidden="true">
      <Icon name={subjectIcon(courseName)} />
    </span>
  );
}

/** "due 7:59 PM" today, "due Thu" this week, "due Oct 29" later. */
function dueShort(iso: string, now: Date): string {
  const days = calendarDaysUntil(new Date(iso), now);
  return `due ${days === 0 ? timeOf(iso) : days > 0 && days < 7 ? weekday(iso) : monthDay(iso)}`;
}

/**
 * One plan row: the class's subject icon, the title with a short line under
 * it (the kind of work first), and the due date on the right (crimson when due today or tomorrow).
 * `note` replaces the class line, for example with the planner's reason.
 */
export function WorkRow({ item, now, note, onOpen }: { item: WorkItem; now: Date; note?: string | null; onOpen: (id: string) => void }) {
  const flags = itemFlags(item);
  const soon = item.due ? isSoon(item.due.at, now) : false;
  return (
    <button type="button" className="item" onClick={() => onOpen(item.assignmentId)} title={item.rankReason ?? undefined}>
      <SubjectTile courseName={item.courseName} />
      <span className="item-body">
        <span className="item-title">{item.title}</span>
        <span className="item-sub">
          {item.source === 'student' && (
            <span className="mine" title="Added by you">
              <Icon name="user" size="xs" label="Added by you" />
            </span>
          )}
          <span className="wtype" title={typeLabel(item).word}>
            <Icon name={typeLabel(item).icon} size="xs" label={typeLabel(item).word} />
          </span>
          {note ?? item.courseName ?? 'No class'}
          {flags.length > 0 && <span className="flag"> · {flags.join(' · ')}</span>}
        </span>
      </span>
      <span className={soon ? 'item-t soon' : 'item-t'}>{item.due ? dueShort(item.due.at, now) : ''}</span>
    </button>
  );
}

const roomWord: Record<RoomLevel, string> = { free: 'Free', some: 'Some room', little: 'Little room', busy: 'Busy' };
const roomDots: Record<RoomLevel, number> = { free: 3, some: 2, little: 1, busy: 0 };

/**
 * How much room a day has, as three dots (free 3, some 2, little 1, busy none,
 * with busy's dots in amber). `word` adds the level's name after the dots.
 */
export function RoomMeter({ level, word }: { level: RoomLevel; word?: boolean }) {
  return (
    <span className="room" role="img" aria-label={roomWord[level]}>
      <span className={`rm ${level}`} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <i key={i} className={i < roomDots[level] ? 'on' : undefined} />
        ))}
      </span>
      {word && (
        <span className={`rw ${level}`} aria-hidden="true">
          {roomWord[level]}
        </span>
      )}
    </span>
  );
}

/** Workload as a three-step meter: Light 1, Medium 2, Heavy 3, Not sure 0. */
export function SizeMeter({ label }: { label: WorkItem['effort']['label'] }) {
  const filled = { Short: 1, Moderate: 2, Substantial: 3, Unknown: 0 }[label];
  return (
    <span className="meter" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= filled ? 'on' : undefined} />
      ))}
    </span>
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

/**
 * The local AI service isn't answering its health check, said before the
 * student types. "Check again" asks the worker to ping it now (ai:check).
 */
export function AiServiceDown({ send }: { send: (message: { type: 'ai:check' }) => Promise<unknown> }) {
  const [checking, setChecking] = useState(false);
  return (
    <p className="service-down" role="status">
      <Icon name="power" size="sm" />
      <span className="grow" title="Developers: start it with npm run dev:server">
        Loomer’s AI isn’t running right now, so try again in a bit.
      </span>
      <button
        type="button"
        className="link"
        disabled={checking}
        aria-busy={checking}
        onClick={() => {
          setChecking(true);
          void send({ type: 'ai:check' }).finally(() => setChecking(false));
        }}
      >
        {checking ? 'Checking…' : 'Check again'}
      </button>
    </p>
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
            {problem ? 'Tried to check Canvas' : 'Checked Canvas'} at {observedAt(lastCheck.at, now)}
            {problem && <span className="foot-problem">{problem}</span>}
          </>
        ) : (
          'Loomer hasn’t checked Canvas yet'
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
