// Resume briefing on Home (pick 4B): where the last session left off, as facts.
// Continue restarts that session; dismiss hides the briefing. No "you were away"
// language and no list of what could have been done.
import type { ResumeBriefing } from '../model/home';
import { useAction, type PanelApi } from './api';
import { observedAt } from './format';
import type { HomeActions } from './home';
import { Icon } from './Icon';
import { AssignmentTile } from './parts';

export function ResumeCard({
  resume,
  now,
  api,
  actions,
}: {
  resume: ResumeBriefing;
  now: Date;
  api: PanelApi;
  actions: HomeActions;
}) {
  const dismiss = useAction();
  const { assignment } = resume;
  const continuing = actions.startingId === assignment.assignmentId;
  const continueSession = () => actions.startSession(assignment.assignmentId);

  return (
    <section className="card resume" aria-label="Where you left off">
      <p className="card-label">
        <span className="resume-label">
          <Icon name="clock" size="sm" />
          Where you left off · {observedAt(resume.at, now)}
        </span>
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Dismiss this summary"
          title="Dismiss"
          disabled={dismiss.busy}
          onClick={() => dismiss.run(() => api.send({ type: 'resume:dismiss', assignmentId: assignment.assignmentId }))}
        >
          <Icon name="x" size="sm" />
        </button>
      </p>
      <div className="asg">
        <AssignmentTile small />
        <div className="asg-body">
          <h2 className="asg-title">{assignment.title}</h2>
          {assignment.courseName && <div className="asg-meta">{assignment.courseName}</div>}
        </div>
      </div>

      {resume.recommendationChanged && (
        <div className="callout accent" style={{ marginTop: 12 }}>
          <span className="tile">
            <Icon name="info" size="sm" />
          </span>
          <p className="callout-body">Loomer now suggests something else below. This one is still one tap away.</p>
        </div>
      )}

      {resume.facts.length > 0 && (
        <ul className="facts">
          {resume.facts.map((f, i) => (
            <li key={i}>
              <Icon name="check" size="xs" />
              {f}
            </li>
          ))}
        </ul>
      )}

      {resume.requirements.length > 0 && (
        <details className="group">
          <summary>
            <Icon name="chevronDown" size="sm" />
            What the assignment asks ({resume.requirements.length})
          </summary>
          {resume.requirements.map((r, i) => (
            <div className="req-item" key={i}>
              <span className="evidence-text">{r.text}</span>
              {r.quote && (
                <>
                  <span className="quote-label">From the assignment</span>
                  <span className="quote">“{r.quote}”</span>
                </>
              )}
            </div>
          ))}
        </details>
      )}

      {resume.sources.length > 0 && (
        <details className="group">
          <summary>
            <Icon name="chevronDown" size="sm" />
            Saved pages ({resume.sources.length})
          </summary>
          {resume.sources.map((s) => (
            <a className="row source-link" key={s.url} href={s.url} target="_blank" rel="noreferrer">
              <span className="tile">
                <Icon name="globe" size="sm" />
              </span>
              <span className="row-title regular">{s.title}</span>
              <Icon name="external" size="xs" />
            </a>
          ))}
        </details>
      )}

      <div className="btn-row" style={{ marginTop: 14, flexWrap: 'nowrap' }}>
        <button
          type="button"
          className={resume.recommendationChanged ? 'btn pill-shape grow-btn' : 'cta grow-btn'}
          onClick={continueSession}
          disabled={actions.startingId !== null}
          aria-busy={continuing}
        >
          {continuing ? 'Continuing…' : 'Continue'}
          {!continuing && <Icon name="arrowRight" size="sm" />}
        </button>
        {resume.docUrl && (
          <a className="btn pill-shape" href={resume.docUrl} target="_blank" rel="noreferrer">
            Open Doc
            <Icon name="external" size="xs" />
          </a>
        )}
      </div>
      {dismiss.error && <p className="status-line error">{dismiss.error}</p>}
    </section>
  );
}
