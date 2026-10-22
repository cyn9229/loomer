// Waits that say what Loomer is doing (round 45, 1B, with round 46's short
// titles). The box a result will fill is drawn right away (WaitSlot): its
// label, a still gray outline of what's coming, a short title ("Writing 6
// questions"), what it's about, how long it usually takes, and the seconds so
// far. Past 1.5 times the usual time it says so, with Keep waiting and Cancel
// where the work can stop. Long waits show their real steps (WaitSteps). A
// failure is one sentence with Try again (FailedLine), and a place where AI
// doesn't run at all says why, with the one action that fixes it (Before).
// Nothing moves: the only change over time is the seconds count, once a second.
import { useEffect, useState, type ReactNode } from 'react';
import type { Failed, Pending } from '../model/wait';
import { AiBlock } from './aiBlock';
import { Icon } from './Icon';

/** "15 s", "1½ min", "2 min". */
function span(sec: number): string {
  if (sec < 60) return `${Math.max(5, Math.round(sec / 5) * 5)} s`;
  const halves = Math.round(sec / 30);
  const whole = Math.floor(halves / 2);
  return halves % 2 ? `${whole === 0 ? '' : whole}½ min` : `${whole} min`;
}

/** How long a wait usually takes, in a few words: "a few seconds", "about 10 s", "5 to 10 s", "15 s to 1½ min". */
export function usualWords([low, high]: [number, number]): string {
  if (high <= 6) return 'a few seconds';
  if (span(low) === span(high)) return `about ${span(high)}`;
  return low < 60 && high < 60 ? `${span(low).replace(' s', '')} to ${span(high)}` : `${span(low)} to ${span(high)}`;
}

/** "4 s", or "1:12" past a minute. */
function clock(sec: number): string {
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

const secondsSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));

/** Whole seconds since `startedAt`, updated once a second. A counter, not an animation. */
export function useSince(startedAt: string): number {
  const [sec, setSec] = useState(() => secondsSince(startedAt));
  useEffect(() => {
    setSec(secondsSince(startedAt));
    const id = setInterval(() => setSec(secondsSince(startedAt)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return sec;
}

/** True once a wait has run past 1.5 times the high end of its usual time. */
function isSlow(pending: Pending, sec: number): boolean {
  return sec > pending.usualSec[1] * 1.5;
}

/** A wait's second line on its own: what it's about and the usual time (or that it's taking longer), with the seconds on the right. */
export function WaitSub({ pending }: { pending: Pending }) {
  const sec = useSince(pending.startedAt);
  const sub = isSlow(pending, sec) ? 'Taking longer than usual' : [pending.about, usualWords(pending.usualSec)].filter(Boolean).join(' · ');
  return (
    <span className="wait-s">
      <span className="grow">{sub}</span>
      <span className="wait-sec" aria-hidden="true">
        {clock(sec)}
      </span>
    </span>
  );
}

/**
 * The wait's words: the title, then what it's about and the usual time, with
 * the seconds on the right. Running long, the second line says so, and Keep
 * waiting and Cancel show when the work can stop.
 */
export function WaitLine({ pending, onCancel, icon = false }: { pending: Pending; onCancel?: () => void; icon?: boolean }) {
  const sec = useSince(pending.startedAt);
  const [kept, setKept] = useState(false);
  const slow = isSlow(pending, sec);
  const sub = slow ? 'Taking longer than usual' : [pending.about, usualWords(pending.usualSec)].filter(Boolean).join(' · ');
  return (
    <div className="wait-line" role="status">
      <p className="wait-t">
        {icon && <Icon name="sparkle" size="sm" />}
        {pending.title}
      </p>
      <p className="wait-s">
        <span className="grow">{sub}</span>
        <span className="wait-sec" aria-hidden="true">
          {clock(sec)}
        </span>
      </p>
      {slow && !kept && pending.canCancel && onCancel && (
        <p className="wait-acts">
          <button type="button" className="btn sm" onClick={() => setKept(true)}>
            Keep waiting
          </button>
          <button type="button" className="btn sm" onClick={onCancel}>
            Cancel
          </button>
        </p>
      )}
    </div>
  );
}

export type WaitShape = 'text' | 'question' | 'rows' | 'table' | 'chart' | 'none';

/** A still gray outline of what's coming. Never shimmers. */
export function WaitOutline({ shape }: { shape: WaitShape }) {
  switch (shape) {
    case 'none':
      return null;
    case 'text':
      return (
        <span className="wait-sk" aria-hidden="true">
          <i style={{ width: '94%' }} />
          <i style={{ width: '62%' }} />
        </span>
      );
    case 'question':
      return (
        <span className="wait-sk" aria-hidden="true">
          <i style={{ width: '92%' }} />
          <i style={{ width: '58%' }} />
          <span className="wait-opts">
            {[62, 78, 48, 70].map((w) => (
              <b key={w}>
                <i style={{ width: `${w}%` }} />
              </b>
            ))}
          </span>
        </span>
      );
    case 'rows':
      return (
        <span className="wait-rows" aria-hidden="true">
          {[78, 64, 84].map((w) => (
            <b key={w}>
              <i style={{ width: `${w}%` }} />
            </b>
          ))}
        </span>
      );
    case 'table':
      return (
        <span className="wait-table" aria-hidden="true">
          {[0, 1, 2, 3].map((r) => (
            <b key={r}>
              <i />
              <i />
              <i />
            </b>
          ))}
        </span>
      );
    case 'chart':
      return (
        <span className="wait-chart" aria-hidden="true">
          {[40, 72, 28, 55, 85, 20, 46].map((h, i) => (
            <i key={i} style={{ height: `${h}%` }} />
          ))}
        </span>
      );
  }
}

/**
 * The box a result will fill, drawn now with its own label (round 45, 1B), so
 * the result arrives in the same place and the page barely moves.
 */
export function WaitSlot({ label, pending, shape = 'text', onCancel, className }: { label: string; pending: Pending; shape?: WaitShape; onCancel?: () => void; className?: string }) {
  return (
    <AiBlock label={label} flashKey={null} className={['wait-slot', className].filter(Boolean).join(' ')}>
      <WaitLine pending={pending} onCancel={onCancel} />
      <WaitOutline shape={shape} />
    </AiBlock>
  );
}

/** A box that waits on other work, so it has no timer of its own (one timer per wait): its label, why it's empty, and the outline. */
export function WaitNote({ label, text, shape = 'text' }: { label: string; text: string; shape?: WaitShape }) {
  return (
    <AiBlock label={label} flashKey={null} className="wait-slot">
      <p className="wait-note">{text}</p>
      <WaitOutline shape={shape} />
    </AiBlock>
  );
}

/** A wait in a screen's main space with no label of its own (practice): the line, then the outline. */
export function WaitHold({ pending, shape = 'question', onCancel }: { pending: Pending; shape?: WaitShape; onCancel?: () => void }) {
  return (
    <div className="wait-hold">
      <WaitLine pending={pending} onCancel={onCancel} icon />
      <WaitOutline shape={shape} />
    </div>
  );
}

/** A long wait's real steps, ticking over as each one finishes. The step running now shows the usual time and the seconds. */
export function WaitSteps({ pending }: { pending: Pending }) {
  const sec = useSince(pending.startedAt);
  const slow = isSlow(pending, sec);
  return (
    <ol className="wait-steps" role="status">
      {(pending.steps ?? []).map((s, i) => (
        <li key={i} className={s.status}>
          <span className="wait-m" aria-hidden="true">
            {s.status === 'done' && <Icon name="check" />}
          </span>
          <span className="grow">
            <b>{s.label}</b>
            {s.status === 'now' ? (
              <span className="wait-s">
                <span className="grow">{slow ? 'Taking longer than usual, and Loomer keeps going while you work' : (s.detail ?? `Usually ${usualWords(pending.usualSec)}`)}</span>
                <span className="wait-sec" aria-hidden="true">
                  {clock(sec)}
                </span>
              </span>
            ) : (
              s.detail && <span className="wait-s">{s.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A wait that ended without a result: the sentence, and Try again when it can help. */
export function FailedLine({ failed, onRetry, retryLabel = 'Try again', children }: { failed: Failed; onRetry?: () => void; retryLabel?: string; children?: ReactNode }) {
  return (
    <div className="wait-failed" role="alert">
      <p>
        <Icon name="alert" size="sm" />
        <span>{failed.text}</span>
      </p>
      {(children || (failed.retry && onRetry)) && (
        <p className="wait-acts">
          {failed.retry && onRetry && (
            <button type="button" className="btn sm" onClick={onRetry}>
              {retryLabel}
            </button>
          )}
          {children}
        </p>
      )}
    </div>
  );
}

/** Before AI runs at all: what will be here, why it isn't, and the one action that fixes it. */
export function Before({ label, text, action }: { label: string; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <section className="wait-before" aria-label={label}>
      <p className="wait-before-k">{label}</p>
      <p className="wait-before-t">{text}</p>
      {action && (
        <button type="button" className="btn sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </section>
  );
}
