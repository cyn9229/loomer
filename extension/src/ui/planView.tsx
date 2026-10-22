// "Your plan" on Home, in two views the student switches between. List groups
// work by the day it should start (a day can hold several starts); each row is
// its title, class, and day, and why it sits there lives on its page. Week
// shows each of the next seven days with what starts, which checkpoints land,
// and what is due, under the busy-week note and the student's own changes.
// Below both: Later, No due date, Past due and Hidden as folds.
import type { CrowdedWeek, DayRoom, WorkItem } from '../model/home';
import type { PlanChangeView } from '../model/plan';
import { calendarDaysUntil, minutesText, timeOf, ymd } from './format';
import type { HomeActions } from './home';
import { Icon, type IconName } from './Icon';
import { RoomMeter, WorkRow } from './parts';
import { planByStart, weekDays, type WeekEvent } from './plan';
import { YourChanges } from './planChange';
import { rowReadWords } from './readState';
import { subjectIcon } from './subject';

export type PlanMode = 'list' | 'week';

type PlanProps = { items: WorkItem[]; room: DayRoom[]; crowded: CrowdedWeek; yourChanges: PlanChangeView[]; now: Date; actions: HomeActions; mode: PlanMode; onMode: (mode: PlanMode) => void };

/**
 * Your plan: List or Week, then the folds. Add (in the heading, and a line at
 * the end) adds work that isn't on Canvas; it shows even when the plan is empty.
 */
export function PlanSection({ items, room, crowded, yourChanges, now, actions, mode, onMode }: PlanProps) {
  const plan = planByStart(items, now);
  const addLine = (
    <button type="button" className="plan-add-line" onClick={actions.addAssignment}>
      <Icon name="plus" size="sm" />
      Add something that isn’t on Canvas
    </button>
  );
  if (items.length === 0) return addLine;
  return (
    <>
      <div className="sec">
        <h2>Your plan</h2>
        <button type="button" className="plan-add" onClick={actions.addAssignment}>
          <Icon name="plus" size="xs" />
          Add
        </button>
        <span className="vseg" role="group" aria-label="Plan view">
          {(
            [
              ['list', 'list', 'List'],
              ['week', 'calendar', 'Week'],
            ] as const
          ).map(([value, icon, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => onMode(value)}>
              <Icon name={icon} size="xs" />
              {label}
            </button>
          ))}
        </span>
      </div>
      {mode === 'list' ? (
        <PlanList days={plan.days} now={now} onOpen={actions.openItem} />
      ) : (
        <>
          {(crowded || yourChanges.length > 0) && (
            <div className="notices">
              {crowded && (
                <p className="notice busy" role="note">
                  <Icon name="alert" />
                  <span className="grow">{crowded.text}</span>
                </p>
              )}
              {yourChanges.length > 0 && <YourChanges changes={yourChanges} now={now} send={actions.send} />}
            </div>
          )}
          <PlanWeek items={items} room={room} now={now} onOpen={actions.openItem} />
        </>
      )}
      <Folds items={items} later={plan.later} now={now} actions={actions} />
      {addLine}
    </>
  );
}

/** "Start today", "Start tomorrow · Sun", "Start by Tue". */
function startHeading(offset: number, now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const name = d.toLocaleDateString(undefined, { weekday: 'short' });
  return offset === 0 ? 'Start today' : offset === 1 ? `Start tomorrow · ${name}` : `Start by ${name}`;
}

/** The plan grouped by start day. Each row is its title, class, and day; the planner's reason is its tooltip. */
function PlanList({ days, now, onOpen }: { days: { offset: number; items: WorkItem[] }[]; now: Date; onOpen: (id: string) => void }) {
  if (days.length === 0) return <p className="empty-line">Nothing needs a start this week.</p>;
  return (
    <>
      {days.map(({ offset, items }) => (
        <section key={offset} aria-label={startHeading(offset, now)}>
          <div className="day">
            {offset === 0 ? (
              <b>
                <Icon name="sandglass" size="xs" />
                Start today
              </b>
            ) : (
              startHeading(offset, now)
            )}
            {items.length > 1 && <> · {items.length}</>}
          </div>
          {items.map((item) => (
            <WorkRow key={item.assignmentId} item={item} now={now} onOpen={onOpen} />
          ))}
        </section>
      ))}
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Week option 1: every day listed, today first, with its starts, checkpoints
 * and dues. A day the student gave less room shows its dots and level (and a
 * repeat mark when it is every week); a busy day keeps its dues but no starts.
 */
function PlanWeek({ items, room, now, onOpen }: { items: WorkItem[]; room: DayRoom[]; now: Date; onOpen: (id: string) => void }) {
  const roomByDay = new Map(room.map((r) => [r.date, r]));
  return (
    <>
      <p className="wk-key" aria-hidden="true">
        <span className="evk start">
          <Icon name="play" />
        </span>
        start
        <span className="evk due" />
        due
        <span className="evk checkpoint">
          <Icon name="flag" />
        </span>
        checkpoint
        {room.some((r) => r.level !== 'free') && (
          <>
            <RoomMeter level="some" />
            room you have
          </>
        )}
        {room.some((r) => r.repeating && r.level !== 'free') && (
          <>
            <Icon name="repeat" size="xs" />
            every week
          </>
        )}
      </p>
      {weekDays(items, now).map(({ date, offset, events }) => {
        const starts = events.filter((e) => e.kind === 'start').length;
        const dues = events.filter((e) => e.kind === 'due').length;
        const name = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday: 'short' });
        const day = roomByDay.get(ymd(date));
        const limited = day && day.level !== 'free' ? day : null;
        return (
          <section className={limited?.level === 'busy' ? 'wd busy' : 'wd'} key={offset} aria-label={name}>
            <div className="wdh">
              <b className={offset <= 1 ? 'soon' : undefined}>{name}</b>
              <span>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span className="grow" />
              {limited ? (
                <>
                  {limited.repeating && <Icon name="repeat" size="xs" label="Every week" />}
                  <RoomMeter level={limited.level} word />
                  {limited.minutes !== null && limited.level !== 'busy' && <span className="wdm">{minutesText(limited.minutes)}</span>}
                </>
              ) : (
                <span>{events.length === 0 ? 'Nothing planned' : `${plural(starts, 'start')} · ${dues} due`}</span>
              )}
            </div>
            {limited?.level === 'busy' && <p className="wd-note">Nothing starts this day because you said you’re busy.</p>}
            {events.map((event, i) => (
              <WeekRow key={i} event={event} onOpen={onOpen} />
            ))}
          </section>
        );
      })}
    </>
  );
}

const eventLabel: Record<WeekEvent['kind'], string> = { start: 'Start', checkpoint: 'Step', due: 'Due' };
const eventIcon: Partial<Record<WeekEvent['kind'], IconName>> = { start: 'play', checkpoint: 'flag' };

function WeekRow({ event, onOpen }: { event: WeekEvent; onOpen: (id: string) => void }) {
  const icon = eventIcon[event.kind];
  // Whether Loomer has read it, on starts only, so one assignment says it once a day; under the title, so a long title can't cut it off.
  const read = event.kind === 'start' ? rowReadWords(event.item) : null;
  return (
    <button type="button" className={`ev ${event.kind}`} onClick={() => onOpen(event.item.assignmentId)}>
      <span className={`evk ${event.kind}`}>{icon && <Icon name={icon} />}</span>
      <span className="evl">{eventLabel[event.kind]}</span>
      <span className="evi">
        <Icon name={subjectIcon(event.item.courseName)} size="xs" />
      </span>
      <span className="evtw">
        <span className="evt">
          {event.kind === 'checkpoint' ? (
            <>
              {event.checkpoint.text}
              <span className="evs"> · {event.item.title}</span>
            </>
          ) : (
            event.item.title
          )}
        </span>
        {read && event.item.read && <span className={`evr read-w s-${event.item.read.state}`}>{read}</span>}
      </span>
      {event.kind === 'due' && <span className="evw">{timeOf(event.at)}</span>}
    </button>
  );
}

/**
 * Later (starts after this week), No due date, Past due, and Hidden, each one
 * folded row. A missing date does not mean unimportant, so they stay one tap away.
 */
function Folds({ items, later, now, actions }: { items: WorkItem[]; later: WorkItem[]; now: Date; actions: HomeActions }) {
  const visible = items.filter((i) => !i.hidden);
  const byDueDesc = (a: WorkItem, b: WorkItem) => Date.parse(b.due?.at ?? '') - Date.parse(a.due?.at ?? '');
  const folds = [
    { label: 'Later', icon: 'calendarRange', items: later, note: (i: WorkItem) => (i.startBy ? `Start by ${new Date(i.startBy.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null) },
    { label: 'No due date', icon: 'inbox', items: visible.filter((i) => i.bucket === 'no-date'), note: () => null },
    { label: 'Past due', icon: 'alert', items: visible.filter((i) => i.bucket === 'past').sort(byDueDesc), note: () => null },
  ] as const;
  const hidden = items.filter((i) => i.hidden);
  if (folds.every((f) => f.items.length === 0) && hidden.length === 0) return null;
  return (
    <div className="folds">
      {folds
        .filter((f) => f.items.length > 0)
        .map((f) => (
          <details className="fold" key={f.label}>
            <summary>
              <span className="fold-ic">
                <Icon name={f.icon} />
              </span>
              {f.label}
              <span className="count">{f.items.length}</span>
              <Icon name="chevronRight" />
            </summary>
            {f.items.map((item) => (
              <WorkRow key={item.assignmentId} item={item} now={now} note={f.note(item)} onOpen={actions.openItem} inFold />
            ))}
          </details>
        ))}
      {hidden.length > 0 && (
        <details className="fold">
          <summary>
            <span className="fold-ic">
              <Icon name="eyeOff" />
            </span>
            Hidden
            <span className="count">{hidden.length}</span>
            <Icon name="chevronRight" />
          </summary>
          {hidden.map((item) => (
            <div className="row-line" key={item.assignmentId}>
              <span className="grow">
                <span className="row-title">{item.title}</span>
                <span className="row-sub">{item.courseName ?? 'No class'}</span>
              </span>
              <button
                type="button"
                className="btn sm"
                disabled={actions.hidingId === item.assignmentId}
                aria-busy={actions.hidingId === item.assignmentId}
                onClick={() => actions.setHidden(item.assignmentId, false)}
              >
                Show again
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
