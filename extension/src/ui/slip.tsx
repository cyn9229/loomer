// A start Loomer suggested that didn't happen (NextAction.slip). Home names it
// once under the next step ("Since yesterday"), and the first time asks "What
// got in the way?" with four one-tap answers (slip:answer). Skip dismisses it
// for good. Each answer changes Home: too big or not feeling it brings a
// 10-minute step (NextAction.quickStart), not sure brings the plain words and
// Talk it through, and no time offers Today is busy or Pick a day. A second
// skipped start near the deadline asks nothing; its label gives the due day.
import type { NextAction, SlipReason } from '../model/home';
import { AiBlock } from './aiBlock';
import { useAction, type PanelApi } from './api';
import { calendarDaysUntil, ymd } from './format';
import { Icon, type IconName } from './Icon';

type Slip = NonNullable<NextAction['slip']>;

const ANSWERS: { reason: SlipReason; icon: IconName; text: string }[] = [
  { reason: 'too-big', icon: 'mountain', text: 'It felt too big' },
  { reason: 'not-sure', icon: 'question', text: 'Not sure how to start' },
  { reason: 'no-time', icon: 'clock', text: 'No time' },
  { reason: 'not-feeling-it', icon: 'battery', text: 'Didn’t feel like it' },
];

const AFTER: Record<SlipReason, { icon: IconName; text: string }> = {
  'too-big': { icon: 'mountain', text: 'Made smaller' },
  'not-sure': { icon: 'question', text: 'Where to begin' },
  'no-time': { icon: 'calendar', text: 'Your week' },
  'not-feeling-it': { icon: 'battery', text: 'A smaller start' },
};

/** The label over a 'slipped' insight: since when, what the student's answer changed, or the due day on a second slip. */
export function slipLabel(next: NextAction, now: Date): { icon: IconName; text: string } {
  const slip = next.slip;
  if (slip?.answer) return AFTER[slip.answer];
  const due = next.item.due;
  if (slip && slip.count >= 2 && due) {
    const days = calendarDaysUntil(new Date(due.at), now);
    if (days === 0) return { icon: 'clock', text: 'Due tonight' };
    if (days === 1) return { icon: 'clock', text: 'Due tomorrow' };
  }
  if (!slip) return { icon: 'history', text: 'Since yesterday' };
  const [y, m, d] = slip.missedOn.split('-').map(Number);
  const missed = new Date(y!, m! - 1, d!);
  const yesterday = calendarDaysUntil(missed, now) === -1;
  return { icon: 'history', text: yesterday ? 'Since yesterday' : `Since ${missed.toLocaleDateString(undefined, { weekday: 'long' })}` };
}

/** Ask only once: the first skipped start, before any answer. */
export function asksWhy(slip: NextAction['slip']): slip is Slip {
  return slip !== null && slip.count === 1 && slip.answer === null;
}

/** "What got in the way?" with four answers and Skip. Optional: Start working stays right below. */
export function SlipQuestion({ slip, send }: { slip: Slip; send: PanelApi['send'] }) {
  const answer = useAction();
  const reply = (reason: SlipReason | 'dismissed') => answer.run(() => send({ type: 'slip:answer', assignmentId: slip.assignmentId, missedOn: slip.missedOn, reason }));
  return (
    <section className="slipq" aria-label="What got in the way?">
      <p className="slipq-k">
        <span className="grow">What got in the way?</span>
        <button type="button" className="link muted" disabled={answer.busy} onClick={() => reply('dismissed')}>
          Skip
        </button>
      </p>
      <div className="slipq-grid">
        {ANSWERS.map((a) => (
          <button key={a.reason} type="button" className="slipq-a" disabled={answer.busy} onClick={() => reply(a.reason)}>
            <Icon name={a.icon} size="sm" />
            {a.text}
          </button>
        ))}
      </div>
      {answer.error && <p className="status-line error">{answer.error}</p>}
    </section>
  );
}

/** After "Not sure how to start": what the work asks, in plain words. */
export function PlainWords({ next }: { next: NextAction }) {
  if (!next.plainWords) return null;
  return (
    <AiBlock className="slip-plain" label="In plain words" flashKey={`plain:${next.item.assignmentId}:${next.plainWords}`}>
      <p className="slip-plain-t">{next.plainWords}</p>
    </AiBlock>
  );
}

/**
 * After "No time": Today is busy marks today busy and moves this start to
 * tomorrow in one change (the planner never moves a start later by itself), so
 * one Undo reverts both. Pick a day opens the day picker. Shown only when a
 * later day is left before the due date.
 */
export function NoTimeChoices({ next, now, send, onPickDay, onMoved }: { next: NextAction; now: Date; send: PanelApi['send']; onPickDay: () => void; onMoved: (assignmentId: string) => void }) {
  const busy = useAction();
  const id = next.item.assignmentId;
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const markBusy = () =>
    busy.run(async () => {
      const reply = await send({
        type: 'plan:set',
        changes: [
          { kind: 'room', date: ymd(now), weekday: null, repeat: false, level: 'busy', minutes: null },
          { kind: 'start_on', assignment_id: id, date: tomorrow },
        ],
      });
      if (reply.ok) onMoved(id);
      return reply;
    });
  return (
    <>
      <div className="slip-two">
        <button type="button" className="btn" disabled={busy.busy} aria-busy={busy.busy} onClick={markBusy}>
          <Icon name="calendar" size="sm" />
          {busy.busy ? 'Saving…' : 'Today is busy'}
        </button>
        <button type="button" className="btn" disabled={busy.busy} onClick={onPickDay}>
          <Icon name="flag" size="sm" />
          Pick a day
        </button>
      </div>
      {busy.error && <p className="status-line error">{busy.error}</p>}
    </>
  );
}
