// "Keep going" on Home: where the last session left off, as facts. Continue
// restarts that session; the x hides the briefing (resume:dismiss). No "you
// were away" language and no list of what could have been done.
import type { ResumeBriefing } from '../model/home';
import { useAction, type PanelApi } from './api';
import { observedAt } from './format';
import type { HomeActions } from './home';
import { Icon } from './Icon';

export function ResumeCard({ resume, now, api, actions }: { resume: ResumeBriefing; now: Date; api: PanelApi; actions: HomeActions }) {
  const dismiss = useAction();
  const { assignment } = resume;
  const continuing = actions.startingId === assignment.assignmentId;

  return (
    <section className="block violet" aria-label="Keep going">
      <div className="block-k">
        <Icon name="clock" />
        Keep going · {observedAt(resume.at, now)}
        <span className="grow" />
        <button
          type="button"
          className="icon-btn"
          style={{ width: 24, height: 24 }}
          aria-label="Dismiss this summary"
          title="Dismiss"
          disabled={dismiss.busy}
          onClick={() => dismiss.run(() => api.send({ type: 'resume:dismiss', assignmentId: assignment.assignmentId }))}
        >
          <Icon name="x" size="xs" />
        </button>
      </div>
      <p className="row-title clamp">{assignment.title}</p>
      {resume.facts.length > 0 && <p className="row-sub">{resume.facts.slice(0, 2).join(' · ')}</p>}
      {resume.recommendationChanged && <p className="row-sub">Loomer suggests something else first now. This one’s still here.</p>}
      <div className="block-act">
        <button type="button" className={resume.recommendationChanged ? 'btn sm on-tint' : 'vbtn'} onClick={() => actions.startSession(assignment.assignmentId)} disabled={actions.startingId !== null} aria-busy={continuing}>
          {continuing ? 'Opening…' : 'Keep going'}
          {!continuing && <Icon name="arrowRight" />}
        </button>
        {resume.docUrl && (
          <a className="btn sm on-tint" href={resume.docUrl} target="_blank" rel="noreferrer">
            Open Doc
            <Icon name="external" size="xs" />
          </a>
        )}
      </div>
      {resume.sources.length > 0 && (
        <details className="fold" style={{ marginTop: 8 }}>
          <summary>
            <Icon name="chevronRight" size="sm" />
            Saved sources ({resume.sources.length})
          </summary>
          {resume.sources.map((s) => (
            <a className="row-line" key={s.url} href={s.url} target="_blank" rel="noreferrer">
              <Icon name="globe" size="sm" />
              <span className="grow row-title" style={{ fontSize: 13 }}>
                {s.title}
              </span>
            </a>
          ))}
        </details>
      )}
      {dismiss.error && <p className="status-line error">{dismiss.error}</p>}
    </section>
  );
}
