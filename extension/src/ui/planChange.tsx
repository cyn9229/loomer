// Plan changes the student made by talking to Loomer. PlanChangeCard is the
// chat block: a seven-day strip with each day's room and the starts that move,
// the planner's own lines, and Apply / Not now (then Undo). YourChanges is the
// quiet line on Home listing applied changes, each with Undo. The logic checks
// every change and computes the preview; the UI only shows it and sends
// plan:apply, plan:dismiss and plan:undo.
import type { DayRoom, WorkItem } from '../model/home';
import type { PlanChangeView } from '../model/plan';
import { useAction, type PanelApi } from './api';
import { observedAt, weekday, ymd } from './format';
import { Icon, type IconName } from './Icon';
import { RoomMeter, SubjectTile } from './parts';
import { stripDays, stripStarts } from './plan';

type CardProps = {
  change: PlanChangeView;
  /** Home's items and day room, so the strip shows the whole week, not only what moves. */
  items: WorkItem[];
  room: DayRoom[];
  now: Date;
  send: PanelApi['send'];
};

export function PlanChangeCard({ change, items, room, now, send }: CardProps) {
  const apply = useAction();
  const other = useAction();
  const { preview } = change;
  // plan:apply fails with "plan changed" when the plan moved after the preview was made; the store already holds the new preview.
  const replanned = Boolean(apply.error?.includes('plan changed'));
  const error = replanned ? other.error : (apply.error ?? other.error);
  const byId = new Map(items.map((i) => [i.assignmentId, i]));
  return (
    <section className="pcard enter" aria-label="Plan change">
      {replanned && change.status === 'proposed' && (
        <p className="pc-stale" role="status">
          <Icon name="refresh" size="xs" />
          Your plan changed since this was made, so here’s the new version.
        </p>
      )}
      {(preview.days.length > 0 || preview.moves.length > 0) && <Strip change={change} items={items} room={room} now={now} />}
      <div className="pc-lines">
        {preview.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {preview.moves.map((m) => (
        <p className="pc-line" key={m.assignmentId}>
          <SubjectTile courseName={byId.get(m.assignmentId)?.courseName ?? null} />
          <b className="grow ellipsis">{m.title}</b>
          {m.from && <s className="pc-from">{weekday(m.from)}</s>}
          {m.from && m.to && <Icon name="arrowRight" size="xs" />}
          {m.to && <span className="pc-to">{weekday(m.to)}</span>}
        </p>
      ))}
      {change.status === 'proposed' && (
        <>
          <p className="pc-note">Loomer saves the days, not the reason.</p>
          <div className="pc-act">
            <button
              type="button"
              className="btn-primary sm"
              disabled={apply.busy || other.busy}
              aria-busy={apply.busy}
              onClick={() => apply.run(() => send({ type: 'plan:apply', changeId: change.id }))}
            >
              {apply.busy ? 'Applying…' : 'Apply'}
            </button>
            <button type="button" className="btn" disabled={apply.busy || other.busy} onClick={() => other.run(() => send({ type: 'plan:dismiss', changeId: change.id }))}>
              Not now
            </button>
          </div>
        </>
      )}
      {change.status === 'applied' && (
        <p className="pc-done">
          <Icon name="checkCircle" size="sm" />
          <span className="grow">Added to your plan</span>
          <button type="button" className="link" disabled={other.busy} aria-busy={other.busy} onClick={() => other.run(() => send({ type: 'plan:undo', changeId: change.id }))}>
            <Icon name="undo" size="xs" />
            {other.busy ? 'Undoing…' : 'Undo'}
          </button>
        </p>
      )}
      {change.status === 'undone' && <p className="pc-off">Undone, so your plan is back to how it was.</p>}
      {change.status === 'dismissed' && <p className="pc-off">Not applied.</p>}
      {error && <p className="status-line error">{error}</p>}
    </section>
  );
}

/**
 * Seven days with their room (changed days filled) and start dots: a dot per
 * start, a ringed dot for a start moved there, a hollow dot where one was.
 */
function Strip({ change, items, room, now }: Omit<CardProps, 'send'>) {
  const changedDays = new Map(change.preview.days.map((d) => [d.date, d.after]));
  const roomByDay = new Map(room.map((r) => [r.date, r]));
  const moves = change.preview.moves.length > 0;
  return (
    <>
      <div className="strip" role="img" aria-label="Your week with this change">
        {stripDays(change.preview, now).map((day) => {
          const key = ymd(day);
          const after = changedDays.get(key) ?? roomByDay.get(key);
          const starts = stripStarts(items, change.preview.moves, day, now);
          return (
            <span key={key} className={changedDays.has(key) ? 'sday set' : 'sday'}>
              <b>
                {day.toLocaleDateString(undefined, { weekday: 'narrow' })}
                {after?.repeating && changedDays.has(key) && <Icon name="repeat" size="xs" />}
              </b>
              <small>{day.getDate()}</small>
              {after && after.level !== 'free' ? <RoomMeter level={after.level} /> : <span className="room-none" />}
              <span className="sdots">
                {Array.from({ length: starts.kept }, (_, i) => (
                  <u key={`k${i}`} />
                ))}
                {Array.from({ length: starts.movedIn }, (_, i) => (
                  <u key={`n${i}`} className="moved-in" />
                ))}
                {Array.from({ length: starts.movedOut }, (_, i) => (
                  <u key={`o${i}`} className="moved-out" />
                ))}
              </span>
            </span>
          );
        })}
      </div>
      <p className="pc-key" aria-hidden="true">
        <u />
        start
        {moves && (
          <>
            <u className="moved-in" />
            moved here
            <u className="moved-out" />
            was here
          </>
        )}
      </p>
    </>
  );
}

/** One quiet Home line that opens in place: the changes the student applied, newest first, each with Undo. */
export function YourChanges({ changes, now, send }: { changes: PlanChangeView[]; now: Date; send: PanelApi['send'] }) {
  return (
    <details className="notice-fold">
      <summary className="notice">
        <Icon name="edit" />
        <span className="grow">Your changes</span>
        <span className="count">{changes.length}</span>
        <Icon name="chevronRight" />
      </summary>
      <div className="notice-body">
        {changes.map((c) => (
          <ChangeRow key={c.id} change={c} now={now} send={send} />
        ))}
      </div>
    </details>
  );
}

function changeIcon(change: PlanChangeView): IconName {
  if (change.preview.days.some((d) => d.after.repeating)) return 'repeat';
  return change.preview.days.length > 0 ? 'calendar' : 'edit';
}

function ChangeRow({ change, now, send }: { change: PlanChangeView; now: Date; send: PanelApi['send'] }) {
  const undo = useAction();
  const [first, ...rest] = change.preview.lines;
  return (
    <div className="yc-row">
      <Icon name={changeIcon(change)} size="sm" />
      <span className="grow">
        <span className="yc-t">{first ?? 'Plan change'}</span>
        <span className="yc-s">{rest.length > 0 ? rest.join(' · ') : change.appliedAt ? `Set ${observedAt(change.appliedAt, now)}` : ''}</span>
        {undo.error && <span className="yc-s danger-text">{undo.error}</span>}
      </span>
      <button type="button" className="link" disabled={undo.busy} aria-busy={undo.busy} onClick={() => undo.run(() => send({ type: 'plan:undo', changeId: change.id }))}>
        <Icon name="undo" size="xs" />
        {undo.busy ? 'Undoing…' : 'Undo'}
      </button>
    </div>
  );
}
