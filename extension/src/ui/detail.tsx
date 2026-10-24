// Assignment detail: tap any assignment. Subject icon, class and kind of work
// (a menu to change it), title, the instructions in plain words in one
// sentence (More opens the rest), three tiles (start by, the next checkpoint
// or the workload, due), "Why this is next" when it is Home's step, and what
// the assignment asks for, one line per requirement that opens to its
// evidence. Start working, then Canvas, the draft, and Ask Loomer; workload,
// the student's time guess, checkpoint quotes, sources, Did it already?, Hide,
// and Delete fold into More options. Renders the
// AssignmentDetailModel when it has loaded, and the WorkItem alone before.
import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { AssignmentDetailModel, RequirementItem } from '../model/detail';
import type { NextAction, StudentCorrection, WorkItem } from '../model/home';
import type { TestPrep } from '../model/prep';
import { useAction } from './api';
import { calendarDaysUntil, minutesText, monthDay, observedAt, timeOf, weekday, workloadWord } from './format';
import { type HomeActions, startControl } from './home';
import { AiBlock } from './aiBlock';
import { Icon } from './Icon';
import { EvidenceList, PolicyNote, SizeMeter, SubjectTile } from './parts';
import { DeleteAssignmentData } from './privacy';
import { SheetList } from './sheets';
import { TypeMenu } from './workType';
import { Before, FailedLine, WaitLine, WaitNote, WaitOutline } from './wait';
import { ReadLine, readAside } from './readState';

// Test prep shows only on a test's page, so its screens load when one opens.
const PrepSection = lazy(() => import('./prep').then((m) => ({ default: m.PrepSection })));

type Detail = Extract<AssignmentDetailModel, { status: 'ok' }>;

type DetailProps = {
  item: WorkItem;
  detail: AssignmentDetailModel | undefined;
  now: Date;
  actions: HomeActions;
  nudge?: ReactNode;
  /** Home's next step, when it is this item: its reason and evidence fold in as "Why this is next". */
  next?: NextAction | null;
};

export function DetailView({ item, detail, now, actions, nudge, next = null }: DetailProps) {
  const start = startControl(item, actions);
  const ok = detail?.status === 'ok' ? detail : null;
  // Work the student added by hand: marked, editable, and done only when they say so.
  const mine = item.source === 'student';
  const editable = ok?.editable ?? null;
  // The next checkpoint takes the middle tile; without one, the workload does.
  const checkpoint = item.checkpoints.find((c) => Date.parse(c.at) >= now.getTime()) ?? null;
  return (
    <>
      <div className="d-head">
        <SubjectTile courseName={item.courseName} size="lg" />
        <span className="d-class">
          <span>{item.courseName ?? 'No class'}</span> ·
        </span>
        <TypeMenu item={item} send={actions.send} />
        {editable && (
          <button type="button" className="link d-edit" onClick={() => actions.editAssignment(item.assignmentId, editable)}>
            <Icon name="edit" size="xs" />
            Edit
          </button>
        )}
      </div>
      <h1 className="d-title">{item.title}</h1>
      {mine && (
        <p className="d-note mine-note">
          <span className="mine">
            <Icon name="user" size="xs" />
            Added by you
          </span>
        </p>
      )}
      {item.sameAsCanvas && <SameAsCanvas item={item} same={item.sameAsCanvas} actions={actions} />}
      {/* Has Loomer read it? A rule that says no AI already shows below as the policy note, so it isn't said twice. */}
      {item.read && !(item.read.state === 'blocked' && item.read.reason !== 'ai-off') && (
        <ReadLine item={item} read={item.read} actions={{ onReadNow: () => void actions.send({ type: 'read:now', assignmentId: item.assignmentId }), openSettings: actions.openSettings }} />
      )}
      {ok?.plainWords ? (
        <PlainWordsBlock id={item.assignmentId} full={ok.plainWords} short={ok.plainShort} />
      ) : item.read?.state === 'reading' || item.read?.state === 'changed' ? (
        <WaitNote label="In plain words" text="Loomer writes these instructions in plain words after reading them." />
      ) : (
        // With the read line saying AI is off, the placeholder here would repeat it.
        ok?.checkAvailability === 'ai-off' &&
        item.read?.state !== 'blocked' && (
          <Before label="In plain words" text="Turn on AI help, and Loomer rewrites these instructions in plain words." action={{ label: 'Turn on AI help', onClick: actions.openSettings }} />
        )
      )}
      {ok?.prep && (
        <Suspense fallback={<p className="lazy-wait">Opening your test prep…</p>}>
          <TestPrepBlock prep={ok.prep} actions={actions} />
        </Suspense>
      )}
      <div className="facts">
        <StartTile item={item} now={now} />
        {checkpoint ? <CheckpointTile at={checkpoint.at} label={checkpoint.label} now={now} /> : <WorkloadTile item={item} />}
        <DueTile item={item} now={now} />
      </div>
      {item.dueConflict && (
        <p className="d-note warn">
          <Icon name="alert" size="xs" />
          Canvas and the instructions list different due dates, so check both.
        </p>
      )}
      {item.policy.state !== 'permitted' && item.policy.state !== 'none-found' && (
        <div className="pad">
          <PolicyNote state={item.policy.state} quote={item.policy.quote} source={item.policy.sourceLabel} />
        </div>
      )}
      {next && <WhyNext next={next} now={now} />}
      {ok ? <Requirements detail={ok} now={now} actions={actions} /> : <p className="hint-line" style={{ paddingTop: 16 }}>Loading…</p>}
      <div className="end">
        {nudge}
        <button type="button" className="btn-primary" onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
          {start.busy ? 'Starting…' : start.label}
          <Icon name="arrowRight" />
        </button>
        <Links item={item} detail={ok} onAsk={() => actions.openAsk(item.assignmentId)} />
        {mine && <MarkDone item={item} correction={ok?.correction ?? item.correction} actions={actions} />}
        <MoreOptions item={item} detail={ok} now={now} actions={actions} withWorkload={Boolean(checkpoint)} />
      </div>
    </>
  );
}

/** One sentence of plain words; More opens the whole rewrite. Uses `short` when Loomer wrote one, else the first sentence. */
function PlainWordsBlock({ id, full, short }: { id: string; full: string; short: string | null }) {
  const [open, setOpen] = useState(false);
  const first = short ?? full.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? full;
  const more = first.trim() !== full.trim();
  return (
    <AiBlock
      className="plain"
      label="In plain words"
      flashKey={`plain:${id}:${full}`}
      right={
        more && (
          <button type="button" className="link muted" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Less' : 'More'}
          </button>
        )
      }
    >
      <p className="ai-text">{open ? full : first}</p>
    </AiBlock>
  );
}

/** Home's reason for this step, and the evidence behind it, folded. Only for the item that is Home's next step. */
function WhyNext({ next, now }: { next: NextAction; now: Date }) {
  return (
    <details className="d-fold">
      <summary>
        <span className="grow">Why this is next</span>
        <Icon name="chevronRight" size="sm" />
      </summary>
      <div className="d-fold-body">
        <p className="d-fold-text">{next.insight.text}</p>
        <EvidenceList evidence={next.evidence} now={now} />
      </div>
    </details>
  );
}

/**
 * Everything a student rarely needs, folded under the links: the workload and
 * why (when a checkpoint took its tile), their own time guess, why each
 * checkpoint falls where it does, saved sources, Did it already?, Hide, and
 * deleting Loomer's data.
 */
function MoreOptions({ item, detail, now, actions, withWorkload }: { item: WorkItem; detail: Detail | null; now: Date; actions: HomeActions; withWorkload: boolean }) {
  const mine = item.source === 'student';
  const reason = detail?.effort.reason ?? item.effort.reason;
  const sources = detail?.links.sources.length ?? 0;
  const need = detail?.sourceNeed ?? null;
  return (
    <details className="d-more">
      <summary>More options</summary>
      <div className="d-more-body">
        {withWorkload && (
          <p className="d-more-line">
            <SizeMeter label={item.effort.label} />
            <span>
              <b>{workloadWord[item.effort.label]}</b> workload{item.effort.source === 'student' ? ', you set this' : ''}
            </span>
          </p>
        )}
        {item.effort.source === 'ai' && item.effort.label !== 'Unknown' && reason && (
          <p className="quoteline">
            Why {workloadWord[item.effort.label].toLowerCase()}? {reason}
          </p>
        )}
        {item.guessMinutes !== null && (
          <p className="d-more-line">
            <Icon name="clock" size="sm" />
            Your guess: about {minutesText(item.guessMinutes)}
          </p>
        )}
        {item.checkpoints.map((c) => (
          <p className="quoteline" key={c.at + c.quote}>
            Why {dayWord(c.at, now)}? The instructions say “{c.quote}”
          </p>
        ))}
        {(sources > 0 || need) && (
          <p className="d-more-line" title={need ? `“${need.quote}”` : undefined}>
            <Icon name="layers" size="sm" />
            {need ? `${sources} of ${need.required} ${need.required === 1 ? 'source' : 'sources'} saved` : sources === 1 ? '1 source saved' : `${sources} sources saved`}
          </p>
        )}
        {!mine && <Corrections item={item} correction={detail?.correction ?? item.correction} actions={actions} />}
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button type="button" className="link subtle" onClick={() => actions.setHidden(item.assignmentId, !item.hidden)}>
            {item.hidden ? 'Show it in my lists again' : 'Hide from my lists'}
          </button>
          {/* Hand-added work is deleted whole from Edit; this keeps the assignment and clears what Loomer saved. */}
          {!mine && <DeleteAssignmentData assignmentId={item.assignmentId} send={actions.send} />}
        </div>
      </div>
    </details>
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

/** The next checkpoint from the instructions, by its short label ("Draft due"). Why it falls there is under More options. */
function CheckpointTile({ at, label, now }: { at: string; label: string; now: Date }) {
  const soon = calendarDaysUntil(new Date(at), now) <= 1;
  return (
    <div className={soon ? 'fact urgent' : 'fact'}>
      <Icon name="flag" />
      <b>{dayWord(at, now)}</b>
      <span>{label}</span>
    </div>
  );
}

/** The workload, when no checkpoint needs the middle tile. */
function WorkloadTile({ item }: { item: WorkItem }) {
  return (
    <div className={item.effort.source === 'student' ? 'fact you' : 'fact'}>
      <SizeMeter label={item.effort.label} />
      <b>{workloadWord[item.effort.label]}</b>
      <span>{item.effort.source === 'student' ? 'Workload · you set this' : 'Workload'}</span>
    </div>
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

/**
 * What the assignment asks for, one line per requirement with open items
 * first. A line opens to what Loomer saw in the draft (a note and a quote) and
 * its latest hint. Checks describe what was seen in the draft, never a grade.
 */
function Requirements({ detail, now, actions }: { detail: Detail; now: Date; actions: HomeActions }) {
  const check = useAction();
  // The draft check reads the student's own draft, so it exists only for writing.
  const writing = !detail.item.quiz && detail.item.workType.type === 'writing';
  const canCheck = writing && detail.checkAvailability === 'available';
  const checking = Boolean(detail.checkPending) || check.busy;
  const run = () => check.run(() => actions.send({ type: 'requirements:check', assignmentId: detail.item.assignmentId }));
  const rows = detail.check ? [...detail.requirements].sort((a, b) => order[a.state] - order[b.state]) : detail.requirements;
  const open = detail.requirements.filter((r) => r.state !== 'observed').length;
  return (
    <section aria-label="What it asks for">
      <div className="sec">
        <h2>What it asks for</h2>
        {detail.check ? <span className="aside">{open === 0 ? 'All found' : `${open} open`}</span> : detail.item.read && readAside(detail.item.read, now) && <span className="aside">{readAside(detail.item.read, now)}</span>}
      </div>
      <SheetList sheets={detail.sheets} label="Sheets in the instructions" requestOrigins={actions.requestOrigins} send={actions.send} />
      {detail.checkPending && (
        <div className="pad">
          <WaitLine pending={detail.checkPending} />
        </div>
      )}
      {detail.checkFailed && !detail.checkPending && <FailedLine failed={detail.checkFailed} onRetry={canCheck ? run : undefined} />}
      {detail.requirements.length === 0 ? (
        detail.item.read?.state === 'reading' || detail.item.read?.state === 'changed' ? (
          <div className="pad">
            <WaitOutline shape="rows" />
            <p className="hint-line flat">This list fills in when Loomer finishes reading.</p>
          </div>
        ) : (
          <>
            {/* The read line above already says why the list is empty, so this offers the instructions themselves. */}
            <p className="hint-line">{detail.item.read && detail.item.read.state !== 'read' ? 'Here’s the start of the instructions, so you can work from them now.' : 'Loomer hasn’t read the requirements yet.'}</p>
            {detail.descriptionExcerpt && <p className="hint-line" style={{ color: 'var(--text)' }}>{detail.descriptionExcerpt}</p>}
          </>
        )
      ) : (
        <>
          {detail.check && (detail.check.scope === 'partial' || detail.check.stale) && (
            <p className="hint-line">{detail.check.stale ? 'Your draft changed since this check.' : 'Only part of your draft was readable.'}</p>
          )}
          <ul className={detail.checkPending ? 'checklist waiting' : 'checklist'}>
            {rows.map((r, i) => (
              <RequirementRow key={i} r={r} checked={Boolean(detail.check)} />
            ))}
          </ul>
          {!detail.check && writing && (
            <p className="hint-line" style={{ paddingTop: 6 }}>
              {detail.checkAvailability === 'available' ? 'Loomer hasn’t checked your draft yet.' : notChecked[detail.checkAvailability]}
            </p>
          )}
        </>
      )}
      {canCheck && detail.requirements.length > 0 && !detail.checkPending && (
        <p className="pad" style={{ paddingTop: 8 }}>
          <button type="button" className="link" disabled={checking} aria-busy={checking} title={detail.check ? `Checked ${observedAt(detail.check.at, now)}` : undefined} onClick={run}>
            {checking ? 'Checking…' : detail.check ? 'Check my draft again' : 'Check my draft'}
          </button>
        </p>
      )}
      {check.error && <p className="status-line error pad">{check.error}</p>}
    </section>
  );
}

/** One requirement: its box and text, and, when tapped, the full text, the note, the quote, and the hint. Before a check, only a hint or a long text opens it. */
function RequirementRow({ r, checked }: { r: RequirementItem; checked: boolean }) {
  const [open, setOpen] = useState(false);
  const note = checked ? (r.evidence?.note ?? fallbackNote[r.state]) : null;
  const quote = checked ? (r.evidence?.quote ?? null) : null;
  // A long row (a rubric line in the teacher's words) clamps to one line, so it opens even with nothing else to show.
  const opens = Boolean(note || quote || r.hint) || r.text.length > 40;
  const box = (
    <span className="cbx" aria-label={checked ? fallbackNote[r.state] : undefined} aria-hidden={checked ? undefined : true}>
      {checked && r.state === 'observed' && <Icon name="check" />}
    </span>
  );
  if (!opens)
    return (
      <li className="rq">
        {box}
        <span className="rq-text">{r.text}</span>
      </li>
    );
  return (
    <li className={['rq tap', checked && r.state, open && 'open'].filter(Boolean).join(' ')}>
      <button type="button" className="rq-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {box}
        <span className="rq-text">{r.text}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size="sm" />
      </button>
      {open && (
        <span className="rq-more">
          {note && <span className="rq-note">{note}</span>}
          {quote && <span className="rq-quote">“{quote}”</span>}
          {r.hint && <RequirementHint hint={r.hint} />}
        </span>
      )}
    </li>
  );
}

/** The latest hint for a requirement: still open, or handled (shown as progress). */
function RequirementHint({ hint }: { hint: NonNullable<RequirementItem['hint']> }) {
  return hint.state === 'handled' ? (
    <span className="rq-hint done">
      <Icon name="check" size="xs" />
      Hint handled · {hint.text}
    </span>
  ) : (
    <span className="rq-hint">
      <Icon name="sparkle" size="xs" />
      Hint · {hint.text}
    </span>
  );
}

/** Where the work lives (Canvas, the draft) and Ask Loomer about it, as one quiet line under Start working. Saved sources are under More options. */
function Links({ item, detail, onAsk }: { item: WorkItem; detail: Detail | null; onAsk: () => void }) {
  const instructions = detail?.links.instructions[0] ?? item.url;
  return (
    <p className="d-links">
      {instructions && (
        <a href={instructions} target="_blank" rel="noreferrer">
          {item.replay ? 'Replay page' : 'Canvas'}
        </a>
      )}
      {detail?.links.doc && (
        <a href={detail.links.doc} target="_blank" rel="noreferrer">
          Your draft
        </a>
      )}
      <button type="button" onClick={onAsk}>
        Ask Loomer
      </button>
    </p>
  );
}

const correctionText: Record<Exclude<StudentCorrection, null>, string> = {
  'done-offline': 'You did this on paper, so it’s off your list.',
  'kept-active': 'You asked to keep this on your list.',
  'turned-in': 'You turned this in, so it’s off your plan until Canvas shows your submission.',
};

/** Hand-added work never finishes by itself: the student marks it done (the same turned-in correction the end card sets). */
function MarkDone({ item, correction, actions }: { item: WorkItem; correction: StudentCorrection; actions: HomeActions }) {
  const act = useAction();
  const set = (value: 'turned-in' | null) => act.run(() => actions.send({ type: 'context:set', assignmentId: item.assignmentId, correction: value }));
  return (
    <div className="correct">
      {correction === 'turned-in' ? (
        <>
          You marked this done, so it’s off your plan.{' '}
          <button type="button" className="link" disabled={act.busy} aria-busy={act.busy} onClick={() => set(null)}>
            {act.busy ? 'Undoing…' : 'Undo'}
          </button>
        </>
      ) : (
        <button type="button" className="link muted" disabled={act.busy} aria-busy={act.busy} onClick={() => set('turned-in')}>
          <Icon name="check" size="xs" />
          {act.busy ? 'Marking…' : 'Mark as done'}
        </button>
      )}
      {act.error && <p className="status-line error">{act.error}</p>}
    </div>
  );
}

/** A hand-added item that looks like open Canvas work: open that one, or remove this copy (assignment:delete). */
function SameAsCanvas({ item, same, actions }: { item: WorkItem; same: NonNullable<WorkItem['sameAsCanvas']>; actions: HomeActions }) {
  const act = useAction();
  return (
    <div className="d-same">
      <Icon name="info" size="sm" />
      <span className="grow">
        This looks like <b>{same.title}</b> from Canvas.
      </span>
      <button type="button" className="link" onClick={() => actions.openItem(same.assignmentId)}>
        Open it
      </button>
      <button
        type="button"
        className="link muted"
        disabled={act.busy}
        aria-busy={act.busy}
        onClick={() =>
          act.run(async () => {
            const reply = await actions.send({ type: 'assignment:delete', assignmentId: item.assignmentId });
            if (reply.ok) actions.openItem(same.assignmentId);
            return reply;
          })
        }
      >
        {act.busy ? 'Removing…' : 'Remove mine'}
      </button>
      {act.error && <p className="status-line error">{act.error}</p>}
    </div>
  );
}

/** "Did it already?" Loomer only knows what Canvas shows, so the student can say. */
function Corrections({ item, correction, actions }: { item: WorkItem; correction: StudentCorrection; actions: HomeActions }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const set = (value: Exclude<StudentCorrection, 'turned-in'>) => act.run(() => actions.send({ type: 'context:set', assignmentId: item.assignmentId, correction: value }));
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
              I did it on paper
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

/** Test prep on the test's page: maps the section's actions to prep messages. Errors show under it. */
function TestPrepBlock({ prep, actions }: { prep: TestPrep; actions: HomeActions }) {
  const edit = useAction();
  const id = prep.assignmentId;
  return (
    <>
      <PrepSection
        prep={prep}
        actions={{
          onStart: () => actions.startPractice(id),
          onBuild: () => edit.run(() => actions.send({ type: 'prep:setup', assignmentId: id })),
          onPracticeMistake: (mistakeId) => actions.startPractice(id, mistakeId),
          onSetTime: (minutes) => edit.run(() => actions.send({ type: 'prep:time', assignmentId: id, minutes })),
          onRemind: (sessionId, on) => {
            // Ask for notifications inside the click, before any await, or Chrome won't show its prompt.
            const allowed = on ? actions.requestNotifications() : Promise.resolve(true);
            edit.run(async () =>
              (await allowed) ? actions.send({ type: 'prep:remind', assignmentId: id, sessionId, on }) : { ok: false, error: 'Chrome didn’t allow notifications, so Loomer can’t remind you.' },
            );
          },
          onEditTopics: (change) => edit.run(() => actions.send({ type: 'prep:topics-edit', assignmentId: id, ...change })),
          onSetFormats: (formats) => edit.run(() => actions.send({ type: 'prep:format-set', assignmentId: id, formats })),
          onAddNotes: (attachments) => edit.run(() => actions.send({ type: 'prep:notes', assignmentId: id, attachments: attachments.slice(0, 6) })),
          busy: edit.busy || actions.startingId !== null,
        }}
      />
      {edit.error && <p className="status-line error pad">{edit.error}</p>}
    </>
  );
}
