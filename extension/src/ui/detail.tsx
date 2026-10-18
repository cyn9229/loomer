// Assignment detail: tap any assignment. Subject icon and class, title, then
// three tiles (days left, size, AI help), what the assignment asks for, links
// as icon buttons, and Start working at the bottom. Before any draft check the requirements are a plain
// list; per-item marks (found / take a look / can't tell) appear only after a
// check. Renders the AssignmentDetailModel when it has loaded, and the WorkItem
// alone before.
import { useState } from 'react';
import type { AssignmentDetailModel, RequirementItem } from '../model/detail';
import type { StudentCorrection, WorkItem } from '../model/home';
import { useAction } from './api';
import { calendarDaysUntil, dueWhen, observedAt } from './format';
import { type HomeActions, startControl } from './home';
import { Icon } from './Icon';
import { Mark, SizeMeter, SubjectTile } from './parts';
import { DeleteAssignmentData } from './privacy';

type Detail = Extract<AssignmentDetailModel, { status: 'ok' }>;

/** One short word for the size tile. */
const sizeWord: Record<WorkItem['effort']['label'], string> = {
  Short: 'Quick',
  Moderate: 'Medium',
  Substantial: 'Big',
  Unknown: 'Not sure',
};

const aiText: Record<WorkItem['policy']['state'], string> = {
  permitted: 'Allowed',
  'none-found': 'No rule found',
  limited: 'Limited',
  blocked: 'Not allowed',
  unresolved: 'Not clear yet',
};

export function DetailView({ item, detail, now, actions }: { item: WorkItem; detail: AssignmentDetailModel | undefined; now: Date; actions: HomeActions }) {
  const start = startControl(item, actions);
  const ok = detail?.status === 'ok' ? detail : null;
  return (
    <>
      <div className="d-head">
        <SubjectTile courseName={item.courseName} size="lg" />
        <span className="d-class">{item.courseName ?? 'No class'}</span>
      </div>
      <h1 className="d-title">{item.title}</h1>
      <div className="facts">
        <DueTile item={item} now={now} />
        <div className="fact">
          <SizeMeter label={item.effort.label} />
          <b>{sizeWord[item.effort.label]}</b>
          <span>Size</span>
        </div>
        <div className={item.policy.state === 'permitted' ? 'fact ok' : item.policy.state === 'blocked' || item.policy.state === 'limited' ? 'fact warn' : 'fact'}>
          <Icon name={item.policy.state === 'permitted' ? 'shieldCheck' : 'shield'} />
          <b>{aiText[item.policy.state]}</b>
          <span>AI help</span>
        </div>
      </div>
      {item.dueConflict && (
        <p className="d-note warn">
          <Icon name="alert" size="xs" />
          Canvas and the instructions list different due dates. Check both.
        </p>
      )}
      {(item.policy.state === 'blocked' || item.policy.state === 'limited') && item.policy.quote && (
        <p className="d-note">
          “{item.policy.quote}” {item.policy.sourceLabel && <span>{item.policy.sourceLabel}</span>}
        </p>
      )}
      {ok?.effort.reason && <p className="d-note">{ok.effort.reason}</p>}
      {ok ? <Requirements detail={ok} now={now} actions={actions} /> : <p className="hint-line" style={{ paddingTop: 16 }}>Loading…</p>}
      <div className="end">
        <Links item={item} detail={ok} />
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

const summaryWord: Record<RequirementItem['state'], string> = {
  observed: 'found',
  'needs-review': 'to look at',
  unknown: 'can’t tell',
};

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
};

/** What the assignment asks for. Marks describe what was seen, never a grade or "done". */
function Requirements({ detail, now, actions }: { detail: Detail; now: Date; actions: HomeActions }) {
  const check = useAction();
  const canCheck = detail.checkAvailability === 'available';
  const checking = detail.checkPending || check.busy;
  const run = () => check.run(() => actions.send({ type: 'requirements:check', assignmentId: detail.item.assignmentId }));
  return (
    <section aria-label="What it asks for">
      <div className="sec">
        <h2>What it asks for</h2>
        {detail.check && <span className="aside">Checked {observedAt(detail.check.at, now)}</span>}
      </div>
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
          <p className="marks-line">
            {(['observed', 'needs-review', 'unknown'] as const).map((state) => {
              const n = detail.requirements.filter((r) => r.state === state).length;
              return n > 0 ? (
                <span key={state}>
                  <Mark state={state} />
                  {n} {summaryWord[state]}
                </span>
              ) : null;
            })}
          </p>
          {detail.requirements.map((r, i) => (
            <div className={`req ${r.state}`} key={i}>
              <Mark state={r.state} />
              <span className="req-text">{r.text}</span>
              <span className="req-note">{r.evidence?.note ?? fallbackNote[r.state]}</span>
              {r.evidence?.quote && <span className="quote">“{r.evidence.quote}”</span>}
            </div>
          ))}
        </>
      ) : (
        <>
          <ul className="plain-list">
            {detail.requirements.map((r, i) => (
              <li key={i}>{r.text}</li>
            ))}
          </ul>
          <p className="hint-line" style={{ paddingTop: 10 }}>
            {detail.checkAvailability === 'available' ? 'Loomer hasn’t checked your draft yet.' : notChecked[detail.checkAvailability]}
          </p>
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

/** Where the work lives: Canvas, the draft, saved sources. */
function Links({ item, detail }: { item: WorkItem; detail: Detail | null }) {
  const instructions = detail?.links.instructions[0] ?? item.url;
  const sources = detail?.links.sources.length ?? 0;
  if (!instructions && !detail?.links.doc && sources === 0) return null;
  return (
    <div className="icon-links">
      {instructions && (
        <a href={instructions} target="_blank" rel="noreferrer">
          <Icon name="external" />
          {item.replay ? 'Replay page' : 'Canvas'}
        </a>
      )}
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
    </div>
  );
}

/** Days until due, as the first tile. Today and tomorrow use the urgency color. */
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
  const days = calendarDaysUntil(at, now);
  const big = past ? 'Past due' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`;
  return (
    <div className={!past && days <= 1 ? 'fact urgent' : 'fact'}>
      <Icon name={!past && days <= 1 ? 'clock' : 'calendar'} />
      <b>{big}</b>
      <span>{dueWhen(item.due.at, now)}</span>
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
