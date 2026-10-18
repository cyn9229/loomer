// Assignment detail: tap any assignment. Subject icon, class and kind of work
// (a menu to change it), title, the
// instructions in plain words (AI, when allowed), three tiles (start by, due,
// workload; "you set this" when the student chose them), the student's own
// time guess, the checkpoint track when the instructions set earlier dates, and
// what the assignment asks for as a checklist with open items first. Links,
// Ask Loomer, and Start working sit at the bottom. Renders the
// AssignmentDetailModel when it has loaded, and the WorkItem alone before.
import type { TeacherSheet } from '../model/session';
import { useState, type ReactNode } from 'react';
import { DOCS_ORIGINS } from '../core/messages';
import type { AssignmentDetailModel, RequirementItem } from '../model/detail';
import type { StudentCorrection, WorkItem } from '../model/home';
import { useAction } from './api';
import { calendarDaysUntil, minutesText, monthDay, observedAt, timeOf, weekday, workloadWord } from './format';
import { type HomeActions, startControl } from './home';
import { Icon } from './Icon';
import { PolicyNote, SizeMeter, SubjectTile } from './parts';
import { DeleteAssignmentData } from './privacy';
import { TypeMenu } from './workType';

type Detail = Extract<AssignmentDetailModel, { status: 'ok' }>;

export function DetailView({ item, detail, now, actions, nudge }: { item: WorkItem; detail: AssignmentDetailModel | undefined; now: Date; actions: HomeActions; nudge?: ReactNode }) {
  const start = startControl(item, actions);
  const ok = detail?.status === 'ok' ? detail : null;
  const effortReason = ok?.effort.reason ?? item.effort.reason;
  return (
    <>
      <div className="d-head">
        <SubjectTile courseName={item.courseName} size="lg" />
        <span className="d-class">{item.courseName ?? 'No class'} ·</span>
        <TypeMenu item={item} send={actions.send} />
      </div>
      <h1 className="d-title">{item.title}</h1>
      {ok?.plainWords && (
        <section className="plain" aria-label="In plain words">
          <div className="plain-k">
            <Icon name="sparkle" size="xs" />
            In plain words
            <span className="grow" />
            <span>Loomer’s reading</span>
          </div>
          <p>{ok.plainWords}</p>
        </section>
      )}
      <div className="facts">
        <StartTile item={item} now={now} />
        <DueTile item={item} now={now} />
        <div className={item.effort.source === 'student' ? 'fact you' : 'fact'}>
          <SizeMeter label={item.effort.label} />
          <b>{workloadWord[item.effort.label]}</b>
          <span>{item.effort.source === 'student' ? 'Workload · you set this' : 'Workload'}</span>
        </div>
      </div>
      {item.guessMinutes !== null && (
        <p className="guess">
          <Icon name="clock" size="sm" />
          Your guess: about {minutesText(item.guessMinutes)}
        </p>
      )}
      {item.checkpoints.length > 0 && item.due && <CheckpointTrack item={item} due={item.due.at} now={now} />}
      {item.effort.source === 'ai' && item.effort.label !== 'Unknown' && effortReason && (
        <p className="quoteline">
          Why {workloadWord[item.effort.label].toLowerCase()}? {effortReason}
        </p>
      )}
      {item.dueConflict && (
        <p className="d-note warn">
          <Icon name="alert" size="xs" />
          Canvas and the instructions list different due dates. Check both.
        </p>
      )}
      {item.policy.state !== 'permitted' && item.policy.state !== 'none-found' && (
        <div className="pad">
          <PolicyNote state={item.policy.state} quote={item.policy.quote} source={item.policy.sourceLabel} />
        </div>
      )}
      {ok ? <Requirements detail={ok} now={now} actions={actions} /> : <p className="hint-line" style={{ paddingTop: 16 }}>Loading…</p>}
      <div className="end">
        {nudge}
        <Links item={item} detail={ok} onAsk={() => actions.openAsk(item.assignmentId)} />
        <button type="button" className="btn-primary" onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
          {start.busy ? 'Starting…' : start.label}
          <Icon name="arrowRight" />
        </button>
        <Corrections item={item} correction={ok?.correction ?? item.correction} actions={actions} />
        <div className="row-actions center" style={{ marginTop: 14 }}>
          <button type="button" className="link subtle" onClick={() => actions.setHidden(item.assignmentId, !item.hidden)}>
            {item.hidden ? 'Show it in my lists again' : 'Hide from my lists'}
          </button>
          <DeleteAssignmentData assignmentId={item.assignmentId} send={actions.send} />
        </div>
      </div>
    </>
  );
}

/** "Today", "Tomorrow", "Thu" this week, otherwise "Oct 29". */
function dayWord(iso: string, now: Date): string {
  const days = calendarDaysUntil(new Date(iso), now);
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 1 && days < 7 ? weekday(iso) : monthDay(iso);
}

/** When to begin. A start date that passed still reads Today: the work needs a start. */
function StartTile({ item, now }: { item: WorkItem; now: Date }) {
  const open = item.startBy && item.bucket !== 'past';
  const at = open ? (Date.parse(item.startBy!.at) < now.getTime() ? now.toISOString() : item.startBy!.at) : null;
  const soon = at !== null && calendarDaysUntil(new Date(at), now) <= 1;
  return (
    <div className={soon ? 'fact acc' : 'fact'}>
      <Icon name="sandglass" />
      <b>{at ? dayWord(at, now) : 'Not set'}</b>
      <span>{item.startBy?.basis === 'student' ? 'Start by · you picked' : 'Start by'}</span>
    </div>
  );
}

/** The due day, with the time under it. Today and tomorrow use the urgency color. */
function DueTile({ item, now }: { item: WorkItem; now: Date }) {
  if (!item.due) {
    return (
      <div className="fact">
        <Icon name="calendar" />
        <b>No date</b>
        <span>Due</span>
      </div>
    );
  }
  const at = new Date(item.due.at);
  const past = at.getTime() < now.getTime();
  const soon = !past && calendarDaysUntil(at, now) <= 1;
  return (
    <div className={soon ? 'fact urgent' : 'fact'}>
      <Icon name={soon ? 'clock' : 'calendar'} />
      <b>{past ? 'Past due' : dayWord(item.due.at, now)}</b>
      <span>{past ? `Was due ${monthDay(item.due.at)}` : `Due ${timeOf(item.due.at)}`}</span>
    </div>
  );
}

/**
 * Start, each checkpoint from the instructions, then the due date, on one
 * line. Under it, each checkpoint's quote, so a date Loomer worked out (like
 * "the day before the final deadline") shows where it came from.
 */
function CheckpointTrack({ item, due, now }: { item: WorkItem; due: string; now: Date }) {
  const start = item.startBy && Date.parse(item.startBy.at) > now.getTime() ? item.startBy.at : now.toISOString();
  return (
    <>
      <ol className="cptrack" aria-label="Checkpoints">
        <li className="cp now">
          <i />
          <b>{dayWord(start, now)}</b>
          <span>Start</span>
        </li>
        {item.checkpoints.map((c) => (
          <li className="cp mid" key={c.at + c.text}>
            <i>
              <Icon name="flag" />
            </i>
            <b>{dayWord(c.at, now)}</b>
            <span>{c.text}</span>
          </li>
        ))}
        <li className="cp due">
          <i />
          <b>{dayWord(due, now)}</b>
          <span>Due {timeOf(due)}</span>
        </li>
      </ol>
      {item.checkpoints.map((c) => (
        <p className="quoteline" key={c.at + c.quote}>
          Why {dayWord(c.at, now)}? The instructions say “{c.quote}”
        </p>
      ))}
    </>
  );
}

/** Open items first: what to look at, then what Loomer can't tell, then what it found. */
const order: Record<RequirementItem['state'], number> = { 'needs-review': 0, unknown: 1, observed: 2 };

const fallbackNote: Record<RequirementItem['state'], string> = {
  observed: 'Found in your draft',
  'needs-review': 'Take a look',
  unknown: 'Can’t tell yet',
};

/** Why the draft hasn't been checked. Shown before any check exists. */
const notChecked: Record<Exclude<Detail['checkAvailability'], 'available'>, string> = {
  'no-doc': 'Start working and link your draft, then Loomer can check it against this list.',
  'needs-policy-answer': 'Answer the AI question in Help, then Loomer can check your draft.',
  'ai-off': 'Turn on AI help in settings to check your draft against this list.',
  blocked: 'No AI on this one, so Loomer won’t read your draft.',
  limited: 'AI help is limited here, so Loomer won’t check your draft.',
  unresolved: 'Checking is on hold until the AI rule is clear.',
  quiz: 'This is a quiz or test, so Loomer won’t read your answers.',
};

/** What the assignment asks for. Checks describe what was seen in the draft, never a grade. */
function Requirements({ detail, now, actions }: { detail: Detail; now: Date; actions: HomeActions }) {
  const check = useAction();
  // The draft check reads the student's own draft, so it exists only for writing.
  const writing = !detail.item.quiz && detail.item.workType.type === 'writing';
  const canCheck = writing && detail.checkAvailability === 'available';
  const checking = detail.checkPending || check.busy;
  const run = () => check.run(() => actions.send({ type: 'requirements:check', assignmentId: detail.item.assignmentId }));
  const sorted = [...detail.requirements].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <section aria-label="What it asks for">
      <div className="sec">
        <h2>What it asks for</h2>
        {detail.check && <span className="aside">Checked {observedAt(detail.check.at, now)}</span>}
      </div>
      {detail.sheets.map((s) => (
        <SheetLine key={s.docId} sheet={s} actions={actions} />
      ))}
      {detail.requirements.length === 0 ? (
        <>
          <p className="hint-line">We haven’t pulled out the requirements yet.</p>
          {detail.descriptionExcerpt && <p className="hint-line" style={{ color: 'var(--text)' }}>{detail.descriptionExcerpt}</p>}
        </>
      ) : detail.check ? (
        <>
          {(detail.check.scope === 'partial' || detail.check.stale) && (
            <p className="hint-line">{detail.check.stale ? 'Your draft changed since this check.' : 'Only part of your draft was readable.'}</p>
          )}
          <ul className="checklist">
            {sorted.map((r, i) => (
              <li className={`rq ${r.state}`} key={i}>
                <span className="cbx" aria-label={fallbackNote[r.state]}>
                  {r.state === 'observed' && <Icon name="check" />}
                </span>
                <span className="rq-text">{r.text}</span>
                <span className="rq-note">{r.evidence?.note ?? fallbackNote[r.state]}</span>
                {r.state === 'needs-review' && r.evidence?.quote && <span className="rq-quote">“{r.evidence.quote}”</span>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <ul className="checklist">
            {detail.requirements.map((r, i) => (
              <li className="rq" key={i}>
                <span className="cbx" aria-hidden="true" />
                <span className="rq-text">{r.text}</span>
              </li>
            ))}
          </ul>
          {writing && (
            <p className="hint-line" style={{ paddingTop: 6 }}>
              {detail.checkAvailability === 'available' ? 'Loomer hasn’t checked your draft yet.' : notChecked[detail.checkAvailability]}
            </p>
          )}
        </>
      )}
      {canCheck && detail.requirements.length > 0 && (
        <p className="pad" style={{ paddingTop: 8 }}>
          <button type="button" className="link" disabled={checking} aria-busy={checking} onClick={run}>
            {checking ? 'Checking…' : detail.check ? 'Check my draft again' : 'Check my draft'}
          </button>
        </p>
      )}
      {check.error && <p className="status-line error pad">{check.error}</p>}
    </section>
  );
}

const sheetText: Record<Exclude<TeacherSheet['state'], 'ok' | 'needs-permission'>, string> = {
  'no-access': 'Google didn’t let Loomer read the sheet (signed out, or download is turned off).',
  unreadable: 'Loomer couldn’t read the sheet in the instructions. It tries again on the next check.',
  'rate-limited': 'Google asked Loomer to slow down. It reads the sheet on the next check.',
};

/**
 * The teacher's Google Doc embedded in the instructions, when Loomer couldn't
 * read it (a read sheet is a link in the row below instead). needs-permission
 * asks Chrome for Google Docs inside the click, then refreshes so the worker
 * reads it right away.
 */
function SheetLine({ sheet, actions }: { sheet: TeacherSheet; actions: HomeActions }) {
  const allow = useAction();
  if (sheet.state === 'ok') return null;
  if (sheet.state === 'needs-permission') {
    return (
      <div className="d-note sheet">
        <Icon name="doc" size="xs" />
        <span className="grow">Allow Google Docs so Loomer can read the sheet in the instructions.</span>
        <button
          type="button"
          className="link"
          disabled={allow.busy}
          aria-busy={allow.busy}
          onClick={() =>
            allow.run(() =>
              // requestOrigins runs synchronously inside this click, before any await.
              actions
                .requestOrigins(DOCS_ORIGINS)
                .then((granted) =>
                  granted ? actions.send({ type: 'canvas:refresh' }) : { ok: false as const, error: 'Chrome didn’t allow Google Docs, so Loomer can’t read the sheet.' },
                ),
            )
          }
        >
          {allow.busy ? 'Allowing…' : 'Allow'}
        </button>
        {allow.error && <p className="status-line error">{allow.error}</p>}
      </div>
    );
  }
  return (
    <p className="d-note sheet warn">
      <Icon name="alert" size="xs" />
      <span className="grow">{sheetText[sheet.state]}</span>
      <a className="link" href={sheet.url} target="_blank" rel="noreferrer">
        Open it
      </a>
    </p>
  );
}

/** Where the work lives (Canvas, the teacher's sheet, the draft, saved sources), plus Ask Loomer about it. */
function Links({ item, detail, onAsk }: { item: WorkItem; detail: Detail | null; onAsk: () => void }) {
  const instructions = detail?.links.instructions[0] ?? item.url;
  const sources = detail?.links.sources.length ?? 0;
  return (
    <div className="icon-links">
      {instructions && (
        <a href={instructions} target="_blank" rel="noreferrer">
          <Icon name="external" />
          {item.replay ? 'Replay page' : 'Canvas'}
        </a>
      )}
      {detail?.sheets
        .filter((s) => s.state === 'ok')
        .map((s) => (
          <a key={s.docId} href={s.url} target="_blank" rel="noreferrer" title={s.title ?? 'Sheet in the instructions'}>
            <Icon name="doc" />
            Sheet
          </a>
        ))}
      {detail?.links.doc && (
        <a href={detail.links.doc} target="_blank" rel="noreferrer">
          <Icon name="doc" />
          Your draft
        </a>
      )}
      {sources > 0 && (
        <span>
          <Icon name="layers" />
          {sources === 1 ? '1 source' : `${sources} sources`}
        </span>
      )}
      <button type="button" onClick={onAsk}>
        <Icon name="sparkle" />
        Ask Loomer
      </button>
    </div>
  );
}

const correctionText: Record<Exclude<StudentCorrection, null>, string> = {
  'done-offline': 'You said you did this offline, so it’s off your list.',
  'kept-active': 'You asked to keep this on your list.',
};

/** "Did it already?" Loomer only knows what Canvas shows, so the student can say. */
function Corrections({ item, correction, actions }: { item: WorkItem; correction: StudentCorrection; actions: HomeActions }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const set = (value: StudentCorrection) => act.run(() => actions.send({ type: 'context:set', assignmentId: item.assignmentId, correction: value }));
  return (
    <div className="correct">
      {correction ? (
        <>
          {correctionText[correction]}{' '}
          <button type="button" className="link" disabled={act.busy} aria-busy={act.busy} onClick={() => set(null)}>
            {act.busy ? 'Undoing…' : 'Undo'}
          </button>
        </>
      ) : open ? (
        <>
          Loomer only knows what Canvas shows.
          <div className="btn-row">
            <button type="button" className="btn sm" disabled={act.busy} onClick={() => set('done-offline')}>
              I did it offline
            </button>
            <button type="button" className="btn sm" disabled={act.busy} onClick={() => set('kept-active')}>
              Keep it on my list
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="link muted" onClick={() => setOpen(true)}>
          Did it already?
        </button>
      )}
      {act.error && <p className="status-line error">{act.error}</p>}
    </div>
  );
}
