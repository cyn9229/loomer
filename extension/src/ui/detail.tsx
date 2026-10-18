// Assignment detail: tap any assignment. The band shows the class, title, due
// date and size; the sheet shows what the assignment asks for with what Loomer
// saw in the draft, links, Start, and the student's own corrections. Renders
// the AssignmentDetailModel when it has loaded, and the WorkItem alone before.
import type { ReactNode } from 'react';
import type { AssignmentDetailModel, RequirementItem } from '../model/detail';
import type { StudentCorrection, WorkItem } from '../model/home';
import { useAction } from './api';
import { dueWhen, effortText, observedAt } from './format';
import { type HomeActions, startControl } from './home';
import { Icon } from './Icon';
import { PolicyBlock, ReplayPill } from './parts';
import { DeleteAssignmentData } from './privacy';

type Detail = Extract<AssignmentDetailModel, { status: 'ok' }>;

export function DetailHero({ item, now, onBack }: { item: WorkItem; now: Date; onBack: () => void }) {
  const effort = effortText[item.effort.label];
  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        <Icon name="chevronLeft" size="sm" />
        Back
      </button>
      <div style={{ marginTop: 16 }}>
        <span className="tag">{item.courseName ?? 'No class'}</span>
      </div>
      <h1 className="hero-title md clamp" style={{ marginTop: 8 }}>
        {item.title}
      </h1>
      <div className="band-pills">
        <span className="band-pill">{item.due ? `Due ${dueWhen(item.due.at, now)}` : 'No due date'}</span>
        {effort && <span className="band-pill">{effort}</span>}
        {item.dueConflict && <span className="band-pill">Two due dates</span>}
        {item.replay && <span className="band-pill">Replay</span>}
      </div>
    </>
  );
}

export function DetailBody({ item, detail, now, actions }: { item: WorkItem; detail: AssignmentDetailModel | undefined; now: Date; actions: HomeActions }) {
  const start = startControl(item, actions);
  const ok = detail?.status === 'ok' ? detail : null;
  return (
    <>
      {(item.policy.state === 'blocked' || item.policy.state === 'limited' || item.policy.state === 'unresolved') && (
        <PolicyBlock state={item.policy.state} quote={item.policy.quote} source={item.policy.sourceLabel} />
      )}
      {item.dueConflict && (
        <div className="mini amber">
          <Icon name="calendar" />
          Canvas and the instructions list different due dates. Check both.
        </div>
      )}
      {ok ? <Requirements detail={ok} now={now} actions={actions} /> : <p className="caption">Loading…</p>}
      <Links item={item} detail={ok} />
      <button type="button" className="vbtn block" onClick={start.onClick} disabled={start.disabled} aria-busy={start.busy}>
        {start.busy ? 'Starting…' : start.label}
        <Icon name="arrowRight" />
      </button>
      {ok?.effort.reason && <p className="note">Why “{effortText[ok.effort.label] ?? ok.effort.label}”: {ok.effort.reason}</p>}
      <Corrections item={item} correction={ok?.correction ?? item.correction} actions={actions} />
      <div className="row-actions">
        <button type="button" className="link subtle" onClick={() => actions.setHidden(item.assignmentId, !item.hidden)}>
          <Icon name="eyeOff" size="xs" />
          {item.hidden ? 'Show it in my lists again' : 'Hide from my lists'}
        </button>
        <DeleteAssignmentData assignmentId={item.assignmentId} send={actions.send} />
      </div>
      {item.replay && <ReplayPill />}
    </>
  );
}

const reqMark: Record<RequirementItem['state'], ReactNode> = {
  observed: <Icon name="check" label="Found in your draft" />,
  'needs-review': <Icon name="alert" label="Take a look" />,
  unknown: <span aria-label="Can’t tell yet">?</span>,
};

const reqFallback: Record<RequirementItem['state'], string> = {
  observed: 'Found in your draft',
  'needs-review': 'Take a look at this one',
  unknown: 'Can’t tell yet',
};

/** What the assignment asks for. States describe what was seen, never a grade or "done". */
function Requirements({ detail, now, actions }: { detail: Detail; now: Date; actions: HomeActions }) {
  const check = useAction();
  const canCheck = detail.checkAvailability === 'available';
  const checking = detail.checkPending || check.busy;
  return (
    <section aria-label="What you need to do">
      <div className="sec">
        <h2>What you need to do</h2>
        {canCheck && (
          <button
            type="button"
            className="link"
            style={{ marginLeft: 'auto' }}
            disabled={checking}
            aria-busy={checking}
            onClick={() => check.run(() => actions.send({ type: 'requirements:check', assignmentId: detail.item.assignmentId }))}
          >
            <Icon name="refresh" size="xs" />
            {checking ? 'Checking…' : detail.check ? 'Check again' : 'Check my draft'}
          </button>
        )}
      </div>
      {check.error && <p className="status-line error">{check.error}</p>}
      {detail.check && (
        <p className="row-sub">
          Checked {observedAt(detail.check.at, now)}
          {detail.check.scope === 'partial' && ' · only part of your draft was readable'}
          {detail.check.stale && ' · your draft changed since then'}
        </p>
      )}
      {detail.checkAvailability !== 'available' && <p className="row-sub">{checkBlocked[detail.checkAvailability]}</p>}
      {detail.requirements.length === 0 ? (
        <>
          <p className="empty-line">We haven’t pulled out the requirements yet.</p>
          {detail.descriptionExcerpt && <p className="quote clamp">{detail.descriptionExcerpt}</p>}
        </>
      ) : (
        detail.requirements.map((r, i) => (
          <div className={`req ${r.state}`} key={i}>
            <span className="req-mark">{reqMark[r.state]}</span>
            <div className="grow">
              <div className="req-t">{r.text}</div>
              <div className="req-n">{r.evidence?.note ?? reqFallback[r.state]}</div>
              {r.evidence?.quote && <span className="quote">“{r.evidence.quote}”</span>}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

const checkBlocked: Record<Exclude<Detail['checkAvailability'], 'available'>, string> = {
  'no-doc': 'Start a session and link your draft to check it.',
  'needs-policy-answer': 'Answer the AI question in Chat to check your draft.',
  'ai-off': 'Turn on AI help in settings to check your draft.',
  blocked: 'Your teacher said no AI here, so Loomer won’t read your draft.',
  limited: 'Your teacher limits AI here, so Loomer won’t check your draft.',
  unresolved: 'Checking is on hold until the AI rule is clear.',
};

function Links({ item, detail }: { item: WorkItem; detail: Detail | null }) {
  const instructions = detail?.links.instructions[0] ?? item.url;
  const sources = detail?.links.sources.length ?? 0;
  return (
    <div className="links">
      {instructions && (
        <a href={instructions} target="_blank" rel="noreferrer">
          <Icon name="doc" />
          {item.replay ? 'Replay page' : 'Instructions'}
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
          <Icon name="globe" />
          {sources === 1 ? '1 source' : `${sources} sources`}
        </span>
      )}
    </div>
  );
}

const correctionText: Record<Exclude<StudentCorrection, null>, string> = {
  'done-offline': 'You said you did this offline, so it’s off your list.',
  'kept-active': 'You asked to keep this on your list.',
};

/** "Already did this?" Loomer only knows what Canvas shows, so the student can say. */
function Corrections({ item, correction, actions }: { item: WorkItem; correction: StudentCorrection; actions: HomeActions }) {
  const act = useAction();
  const set = (value: StudentCorrection) => act.run(() => actions.send({ type: 'context:set', assignmentId: item.assignmentId, correction: value }));
  return (
    <section className="block" aria-label="Already did this?">
      {correction ? (
        <>
          <div className="block-title">{correctionText[correction]}</div>
          <div className="block-act">
            <button type="button" className="btn sm on-tint" disabled={act.busy} aria-busy={act.busy} onClick={() => set(null)}>
              {act.busy ? 'Undoing…' : 'Undo'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="block-title">Already did this?</div>
          <p className="row-sub">Loomer only knows what Canvas shows.</p>
          <div className="two" style={{ marginTop: 10 }}>
            <button type="button" className="btn sm on-tint" disabled={act.busy} onClick={() => set('done-offline')}>
              I did it offline
            </button>
            <button type="button" className="btn sm on-tint" disabled={act.busy} onClick={() => set('kept-active')}>
              Keep it on my list
            </button>
          </div>
        </>
      )}
      {act.error && <p className="status-line error">{act.error}</p>}
    </section>
  );
}
