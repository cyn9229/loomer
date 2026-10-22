// "Not today" on Home's next step: the student picks the day to start instead.
// The days run from tomorrow to the due day, which is marked Due. Any other day
// moves the start at once (plan:set start_on). The due day asks once more,
// plainly, because all of the work would land that day. Home then shows
// Loomer's own line for the new start (the item's rankReason) with Undo.
import { useState } from 'react';
import type { PlanChangeView } from '../model/plan';
import type { WorkItem } from '../model/home';
import { assignmentNoun } from '../analysis/insight';
import { useAction, type PanelApi } from './api';
import { calendarDaysUntil, monthDay, ymd } from './format';
import { Icon } from './Icon';

/** How many days the chips cover before "Pick a day" takes over. */
const CHIP_DAYS = 6;

/** "this essay", for lines that name the assignment. */
export function nounOf(item: WorkItem): string {
  return assignmentNoun({ title: item.title, kind: item.quiz ? 'quiz' : 'assignment' });
}

/** Not today is only offered when there is a later day to start on. */
export function canMoveStart(item: WorkItem, now: Date): boolean {
  return item.due === null || calendarDaysUntil(new Date(item.due.at), now) > 0;
}

type Day = { key: string; short: string; long: string; sub: string; due: boolean };

function dayOf(d: Date, due: boolean): Day {
  return {
    key: ymd(d),
    short: d.toLocaleDateString(undefined, { weekday: 'short' }),
    long: d.toLocaleDateString(undefined, { weekday: 'long' }),
    sub: due ? 'Due' : monthDay(d.toISOString()),
    due,
  };
}

/** Tomorrow up to the due day (or CHIP_DAYS days), and whether later days need the date field. */
function startDays(item: WorkItem, now: Date): { days: Day[]; more: boolean; dueKey: string | null } {
  const dueKey = item.due ? ymd(new Date(item.due.at)) : null;
  const days: Day[] = [];
  for (let offset = 1; offset <= CHIP_DAYS; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const key = ymd(d);
    days.push(dayOf(d, key === dueKey));
    if (key === dueKey) return { days, more: false, dueKey };
  }
  return { days, more: true, dueKey };
}

type DayPickerProps = {
  item: WorkItem;
  now: Date;
  send: PanelApi['send'];
  /** The start moved: Home shows the new line with Undo. */
  onMoved: (assignmentId: string) => void;
  onCancel: () => void;
};

/** "Which day will you start this essay?" with day chips up to the due day. */
export function DayPicker({ item, now, send, onMoved, onCancel }: DayPickerProps) {
  const move = useAction();
  const [pending, setPending] = useState<string | null>(null);
  // The due day waits for a second tap, with the plain fact above it.
  const [dueAsk, setDueAsk] = useState(false);
  const [other, setOther] = useState('');
  const { days, more, dueKey } = startDays(item, now);
  const noun = nounOf(item);
  const tomorrow = days[0]!.key;

  const pick = (key: string) => {
    setPending(key);
    move.run(async () => {
      const reply = await send({ type: 'plan:set', changes: [{ kind: 'start_on', assignment_id: item.assignmentId, date: key, during: null }] });
      setPending(null);
      if (reply.ok) onMoved(item.assignmentId);
      return reply;
    });
  };
  const choose = (key: string) => {
    if (key === dueKey) setDueAsk(true);
    else pick(key);
  };
  const dueDay = days.find((d) => d.due) ?? (dueKey ? dayOf(new Date(item.due!.at), true) : null);

  return (
    <section className="dpick" aria-label="Pick a start day">
      <p className="dpick-k">
        <span className="grow">Which day will you start {noun}?</span>
        <button type="button" className="link muted" disabled={move.busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
      <div className="dpick-days" role="group" aria-label="Start day">
        {days.map((d) => (
          <button
            key={d.key}
            type="button"
            className={d.due ? 'dpick-day due' : 'dpick-day'}
            aria-pressed={pending === d.key || (d.due && dueAsk)}
            aria-busy={pending === d.key}
            disabled={move.busy}
            onClick={() => choose(d.key)}
          >
            <b>{d.short}</b>
            <span>{d.sub}</span>
          </button>
        ))}
      </div>
      {more && (
        <label className="dpick-more">
          <Icon name="calendarRange" size="xs" />
          <span>Another day</span>
          <input
            type="date"
            className="af-in af-date"
            aria-label="Another start day"
            value={other}
            min={tomorrow}
            max={dueKey ?? undefined}
            disabled={move.busy}
            onChange={(e) => {
              setOther(e.target.value);
              if (e.target.value) choose(e.target.value);
            }}
          />
        </label>
      )}
      {dueAsk && dueDay && (
        <>
          <p className="dpick-firm">
            <Icon name="flag" size="xs" />
            {dueDay.long} is the day {noun} is due, so all of it would happen that day.
          </p>
          <div className="dpick-two">
            <button type="button" className="btn" disabled={move.busy} aria-busy={pending === dueKey} onClick={() => dueKey && pick(dueKey)}>
              {pending === dueKey ? 'Saving…' : `Start ${dueDay.long}`}
            </button>
            {/* With no earlier day left, the other choice is to keep today's start. */}
            <button type="button" className="btn" disabled={move.busy} onClick={days.length > 1 ? () => setDueAsk(false) : onCancel}>
              {days.length > 1 ? 'Pick an earlier day' : 'Keep today'}
            </button>
          </div>
        </>
      )}
      {move.error && <p className="status-line error">{move.error}</p>}
    </section>
  );
}

/** Clock slack between the panel and the worker when matching a change to the tap that made it. */
const SLACK_MS = 5_000;

/**
 * After Not today or Today is busy: Loomer's own line for the new start, like
 * "You picked Thursday to start this essay, which leaves 1 day before it's
 * due." Undo reverts the change this tap made (plan:undo): the newest change
 * applied since `since`. Its moves can be empty when the picked day was
 * already the start day, so the time, not the moves, finds it.
 */
export function MovedNotice({ item, since, changes, send, onDone }: { item: WorkItem; since: number; changes: PlanChangeView[]; send: PanelApi['send']; onDone: () => void }) {
  const undo = useAction();
  const change = changes.find((c) => c.status === 'applied' && c.appliedAt !== null && Date.parse(c.appliedAt) >= since - SLACK_MS);
  return (
    <div className="notice">
      <Icon name="calendar" />
      <span className="grow">
        {change && item.rankReason ? item.rankReason : `Moving the start of ${nounOf(item)}…`}
        {undo.error && <span className="notice-sub danger-text">{undo.error}</span>}
      </span>
      {change && (
        <button
          type="button"
          className="link"
          disabled={undo.busy}
          aria-busy={undo.busy}
          onClick={() =>
            undo.run(async () => {
              const reply = await send({ type: 'plan:undo', changeId: change.id });
              if (reply.ok) onDone();
              return reply;
            })
          }
        >
          Undo
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={onDone}>
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}
