// "Keep going" row on Home: where the last session left off, as one line of
// facts. The arrow restarts that session; the x hides the briefing
// (resume:dismiss). When the briefing is for the next step itself, the hero
// shows it instead and this row is not rendered. No "you were away" language.
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
    <section className="keep" aria-label="Keep going">
      <span className="keep-icon">
        <Icon name="clock" />
      </span>
      <span className="grow">
        <span className="keep-k">Keep going · {observedAt(resume.at, now)}</span>
        <span className="keep-t">{assignment.title}</span>
        {resume.facts.length > 0 && <span className="keep-f ellipsis">{resume.facts[0]}</span>}
        {dismiss.error && <span className="keep-f danger-text">{dismiss.error}</span>}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss this summary"
        title="Dismiss"
        disabled={dismiss.busy}
        onClick={() => dismiss.run(() => api.send({ type: 'resume:dismiss', assignmentId: assignment.assignmentId }))}
      >
        <Icon name="x" size="sm" />
      </button>
      <button
        type="button"
        className="go"
        aria-label={`Keep going on ${assignment.title}`}
        onClick={() => actions.startSession(assignment.assignmentId)}
        disabled={actions.startingId !== null}
        aria-busy={continuing}
      >
        <Icon name="arrowRight" />
      </button>
    </section>
  );
}
