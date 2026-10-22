// Has Loomer read this assignment yet? (round 45, 6A). A plan row says so in
// a few words after its class, but only when it isn't simply read, so read
// rows stay quiet. The assignment's page says it in one sentence that names
// the assignment, with the one action that helps when there is one; a read
// assignment shows only "Read 2:14 PM" beside What it asks for.
import type { WorkItem } from '../model/home';
import type { ReadState } from '../model/wait';
import { observedAt } from './format';
import { Icon } from './Icon';
import { nounOf } from './notToday';
import { WaitSteps } from './wait';

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** The row's few words, or null when it's simply read. */
export function readWords(read: ReadState): string | null {
  switch (read.state) {
    case 'read':
      return null;
    case 'waiting':
      return 'Not read yet';
    case 'reading':
      return 'Reading now';
    case 'changed':
      return 'Changed, reading again';
    case 'failed':
      return read.retryAt ? `Couldn’t read, trying ${time(read.retryAt)}` : 'Couldn’t read';
    case 'blocked':
      return read.reason === 'ai-off' ? 'AI help is off' : read.reason === 'rule-unclear' ? 'AI rule unclear' : 'No AI on this one';
    case 'empty':
      return read.reason === 'page-closed' ? (read.retryAt ? `Couldn’t open, trying ${time(read.retryAt)}` : 'Couldn’t open it') : 'No instructions on Canvas';
  }
}

/**
 * The words for a plan row. In the Later, No due date, and Past due folds,
 * "not read yet" is expected (Loomer reads those closer to the date, or when
 * asked), so only the other states show there.
 */
export function rowReadWords(item: WorkItem, inFold = false): string | null {
  const read = item.read;
  if (!read || (inFold && read.state === 'waiting')) return null;
  return readWords(read);
}

/** The row's words in their color, after the class. */
export function RowRead({ item, inFold }: { item: WorkItem; inFold?: boolean }) {
  const words = rowReadWords(item, inFold);
  if (!words || !item.read) return null;
  return (
    <span className="read-tail">
      {' · '}
      <span className={`read-w s-${item.read.state}`}>{words}</span>
    </span>
  );
}

type ReadLineActions = {
  /** read:now, for Read it now and Try now. */
  onReadNow: () => void;
  openSettings: () => void;
};

/**
 * The page's line for every state but read: one sentence that names the
 * assignment, and the action that helps. While Loomer reads, its steps follow.
 */
export function ReadLine({ item, read, actions }: { item: WorkItem; read: ReadState; actions: ReadLineActions }) {
  const noun = nounOf(item);
  const at = read.retryAt ? time(read.retryAt) : null;
  const line = (text: string, tone: '' | 'acc' | 'amb', action?: { label: string; onClick?: () => void; href?: string | null }) => (
    <div className={tone ? `read-line ${tone}` : 'read-line'} role="status">
      <p>{text}</p>
      {action &&
        (action.href ? (
          <a className="btn sm" href={action.href} target="_blank" rel="noreferrer">
            {action.label}
            <Icon name="external" size="xs" />
          </a>
        ) : (
          action.onClick && (
            <button type="button" className="btn sm" onClick={action.onClick}>
              {action.label}
            </button>
          )
        ))}
    </div>
  );
  switch (read.state) {
    case 'read':
      return null;
    case 'waiting':
      if (read.reason === 'later') return line(`Loomer will read ${noun} closer to its due date.`, '', { label: 'Read it now', onClick: actions.onReadNow });
      if (read.reason === 'past-due') return line(`${noun.charAt(0).toUpperCase()}${noun.slice(1)} is past due, so Loomer reads it only if you ask.`, '', { label: 'Read it now', onClick: actions.onReadNow });
      return line(`Loomer hasn’t read ${noun} yet, and it will on the next Canvas check.`, '', { label: 'Read it now', onClick: actions.onReadNow });
    case 'reading':
      return (
        <>
          {line(`Loomer is reading ${noun} now.`, '')}
          {read.pending?.steps && (
            <div className="pad">
              <WaitSteps pending={read.pending} />
            </div>
          )}
        </>
      );
    case 'changed':
      return line('Your teacher changed the instructions, so Loomer is reading them again.', 'acc');
    case 'failed':
      return line(at ? `Loomer couldn’t read ${noun}, so it will try again at ${at}.` : `Loomer couldn’t read ${noun}, so try again when you’re ready.`, 'amb', { label: 'Try now', onClick: actions.onReadNow });
    case 'blocked':
      if (read.reason === 'ai-off') return line(`AI help is off, so Loomer won’t read ${noun}.`, '', { label: 'Turn on AI help', onClick: actions.openSettings });
      // The rule itself shows on the page (PolicyNote), so these need no action here.
      if (read.reason === 'rule-unclear') return line(`The AI rule for ${noun} isn’t clear yet, so Loomer is waiting to read it.`, '');
      return line(`Your teacher’s rule says no AI on ${noun}, so Loomer won’t read it.`, '');
    case 'empty':
      if (read.reason === 'page-closed')
        return line(at ? `Loomer couldn’t open ${noun} on Canvas, so it will try again at ${at}.` : `Loomer couldn’t open ${noun} on Canvas.`, 'amb', { label: 'Try now', onClick: actions.onReadNow });
      return line(`Canvas has no instructions for ${noun}, so there’s nothing for Loomer to read.`, '', { label: 'Open on Canvas', href: item.url });
  }
}

/** "Read 2:14 PM" (or "Read Tue"), beside What it asks for once an assignment is read. */
export function readAside(read: ReadState, now: Date): string | null {
  return read.state === 'read' && read.at ? `Read ${observedAt(read.at, now)}` : null;
}
