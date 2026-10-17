// Work-session screen (pick 3B) on the Sources tab: the proactive hint (3A card,
// collapsible to one row), the session, the linked draft, saved pages, and
// factual activity. Every change goes through PanelApi messages.
import { useState, type FormEvent } from 'react';
import { DOCS_ORIGINS } from '../core/messages';
import type { DocReadState, DocState, ProactiveHint, SessionModel, SourceItem } from '../model/session';
import { useAction, type PanelApi } from './api';
import { observedAt, shortDate } from './format';
import { Icon, type IconName } from './Icon';
import { AssignmentTile, Card, Pill } from './parts';

export type ActiveSession = Extract<SessionModel, { status: 'active' | 'paused' }>;

type HintProps = {
  hint: NonNullable<ProactiveHint>;
  hidden: boolean;
  onHide: () => void;
  onShow: () => void;
  onMoreHelp: () => void;
  api: PanelApi;
};

/**
 * A new hint shows as the full card. Hide collapses it to one row; the row's x
 * is the real dismiss (hint:dismiss), which the worker keeps under the pause rules.
 */
export function HintCard({ hint, hidden, onHide, onShow, onMoreHelp, api }: HintProps) {
  const dismiss = useAction();
  if (hidden) {
    return (
      <div className="hint-row">
        <button type="button" className="hint-row-open" onClick={onShow}>
          <Icon name="sparkle" size="sm" />
          <b>1 hint ready</b>
          <Icon name="chevronRight" size="sm" />
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Dismiss hint"
          disabled={dismiss.busy}
          onClick={() => dismiss.run(() => api.send({ type: 'hint:dismiss', id: hint.id }))}
        >
          <Icon name="x" size="sm" />
        </button>
        {dismiss.error && <p className="status-line error">{dismiss.error}</p>}
      </div>
    );
  }
  return (
    <Card tinted label="Hint">
      <div className="asg">
        <span className="tile white">
          <Icon name="sparkle" />
        </span>
        <h2 className="card-title">Hint</h2>
      </div>
      <p className="hint-text">{hint.text}</p>
      {hint.reference && <Reference quote={hint.reference.quote} from={hint.reference.from} />}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button type="button" className="btn sm" onClick={onMoreHelp}>
          More help
        </button>
        <button type="button" className="link" onClick={onHide}>
          Hide
        </button>
      </div>
    </Card>
  );
}

export function Reference({ quote, from }: { quote: string; from: 'your draft' | 'the instructions' }) {
  return (
    <figure className="reference">
      <figcaption>From {from}</figcaption>
      <blockquote>“{quote}”</blockquote>
    </figure>
  );
}

export function SessionCard({ session, now, api }: { session: ActiveSession; now: Date; api: PanelApi }) {
  const action = useAction();
  const { assignment } = session;
  const paused = session.status === 'paused';
  return (
    <Card label="Work session">
      <p className="card-label">
        Work session
        {paused ? (
          <Pill tone="amber" icon="pause">
            Paused
          </Pill>
        ) : (
          <span className="state-pill">Active</span>
        )}
      </p>
      <div className="asg">
        <AssignmentTile small />
        <div className="asg-body">
          <h2 className="asg-title">{assignment.title}</h2>
          <div className="asg-meta">
            {[assignment.courseName, assignment.due ? `Due ${shortDate(assignment.due.at)}` : null, `started ${observedAt(session.startedAt, now)}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>
      {paused && (
        <div className="callout amber" style={{ marginTop: 12 }}>
          <span className="tile amber">
            <Icon name="pause" size="sm" />
          </span>
          <p className="callout-body">Paused. Loomer is not reading your draft or saving pages.</p>
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="btn sm"
          disabled={action.busy}
          onClick={() => action.run(() => api.send({ type: paused ? 'session:resume' : 'session:pause' }))}
        >
          <Icon name={paused ? 'play' : 'pause'} size="sm" />
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn sm" disabled={action.busy} onClick={() => action.run(() => api.send({ type: 'session:end' }))}>
          End session
        </button>
      </div>
      {action.error && <p className="status-line error">{action.error}</p>}
    </Card>
  );
}

const readStateText: Record<DocReadState, { text: string; icon: IconName; tone: string }> = {
  ok: { text: 'Reading your draft', icon: 'check', tone: 'tile green' },
  waiting: { text: 'Linked. Not read yet', icon: 'doc', tone: 'tile' },
  'rate-limited': { text: 'Google asked Loomer to slow down. Reading resumes on its own', icon: 'pause', tone: 'tile amber' },
  'no-access': { text: 'Loomer can’t open this Doc. Sign in to Google with the account that owns it', icon: 'lock', tone: 'tile red' },
  unreadable: { text: 'Loomer couldn’t read the Doc. It will try again', icon: 'alert', tone: 'tile amber' },
};

const DOC_URL = /^https:\/\/docs\.google\.com\/document\/d\/[\w-]+/;

export function DocCard({ session, now, api }: { session: ActiveSession; now: Date; api: PanelApi }) {
  return session.doc.status === 'linked' ? (
    <LinkedDoc doc={session.doc} now={now} />
  ) : (
    <LinkDoc assignmentId={session.assignment.assignmentId} candidates={session.doc.candidates} api={api} />
  );
}

function LinkedDoc({ doc, now }: { doc: Extract<DocState, { status: 'linked' }>; now: Date }) {
  const state = readStateText[doc.readState];
  const facts = [
    doc.lastReadAt ? `last read ${observedAt(doc.lastReadAt, now)}` : null,
    doc.studentWords !== null ? `${doc.studentWords} of your words` : null,
  ].filter(Boolean);
  return (
    <Card label="Your draft">
      <p className="card-label">
        <span className="card-title">Your draft</span>
        <a className="link" href={doc.url} target="_blank" rel="noreferrer">
          Open
          <Icon name="external" size="xs" />
        </a>
      </p>
      <div className="row">
        <span className={state.tone}>
          <Icon name={state.icon} size="sm" />
        </span>
        <span className="row-body">
          <span className="row-title wrap">{state.text}</span>
          {facts.length > 0 && <span className="row-sub wrap">Google Doc · {facts.join(' · ')}</span>}
        </span>
      </div>
    </Card>
  );
}

/** Asks once which Doc is the draft. One click per candidate, or paste a link. Never links on its own. */
function LinkDoc({ assignmentId, candidates, api }: { assignmentId: string; candidates: { docId: string; url: string }[]; api: PanelApi }) {
  const action = useAction();
  const [pasted, setPasted] = useState('');

  const link = (docUrl: string) =>
    action.run(() =>
      // requestOrigins runs synchronously inside this click, before any await.
      api.requestOrigins(DOCS_ORIGINS).then((granted) =>
        granted
          ? api.send({ type: 'doc:link', assignmentId, docUrl })
          : { ok: false as const, error: 'Chrome access to Google Docs was not granted. Your draft stays unlinked.' },
      ),
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = pasted.trim();
    if (!DOC_URL.test(url)) {
      action.setError('Paste a Google Docs link, like https://docs.google.com/document/d/…');
      return;
    }
    link(url);
  };

  return (
    <Card label="Link your draft">
      <p className="card-label">
        <span className="card-title">Which Doc is your draft?</span>
      </p>
      <p className="lede">Loomer reads only the Google Doc you link here.</p>
      {candidates.length > 0 && (
        <>
          <p className="field-hint">Linked from the instructions. Pick one only if it is your own copy.</p>
          {candidates.map((c) => (
            <div className="row" key={c.docId}>
              <span className="tile">
                <Icon name="doc" size="sm" />
              </span>
              <span className="row-body">
                <span className="row-title">Google Doc</span>
                <span className="row-sub">{c.url.replace('https://', '')}</span>
              </span>
              <button type="button" className="btn sm" disabled={action.busy} onClick={() => link(c.url)}>
                Link
              </button>
            </div>
          ))}
        </>
      )}
      <form onSubmit={submit} className="paste-row">
        <label className="grow">
          <span className="visually-hidden">Google Doc link</span>
          <input
            className="field sm"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste your Doc link"
            inputMode="url"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="btn" disabled={action.busy}>
          Link
        </button>
      </form>
      {action.error && <p className="status-line error">{action.error}</p>}
    </Card>
  );
}

export function SourcesCard({ sources, now, api }: { sources: SourceItem[]; now: Date; api: PanelApi }) {
  return (
    <Card label="Saved pages">
      <p className="card-label">
        <span className="card-title">Saved for this assignment</span>
        <span className="aside">{sources.length === 1 ? '1 page' : `${sources.length} pages`}</span>
      </p>
      {sources.map((s) => (
        <SourceRow key={s.id} source={s} now={now} api={api} />
      ))}
      <p className="field-hint" style={{ marginTop: sources.length ? 12 : 0 }}>
        To save a page, right-click it and choose “Add page to Loomer”, or press Alt+Shift+L.
      </p>
    </Card>
  );
}

function SourceRow({ source, now, api }: { source: SourceItem; now: Date; api: PanelApi }) {
  const action = useAction();
  const host = hostOf(source.url);
  return (
    <div className="row">
      <span className="tile">
        <Icon name="globe" size="sm" />
      </span>
      <span className="row-body">
        <a className="row-title" href={source.url} target="_blank" rel="noreferrer">
          {source.title}
        </a>
        <span className="row-sub">
          {host} · added {observedAt(source.capturedAt, now)}
        </span>
        {action.error && <span className="row-sub danger-text">{action.error}</span>}
      </span>
      <button
        type="button"
        className="link"
        disabled={action.busy}
        onClick={() => action.run(() => api.send({ type: 'source:remove', id: source.id }))}
      >
        Remove
      </button>
    </div>
  );
}

export function ActivityCard({ session, now }: { session: ActiveSession; now: Date }) {
  if (session.activity.length === 0) return null;
  return (
    <Card label="This session">
      <p className="card-label">
        <span className="card-title">This session</span>
      </p>
      {session.activity.map((a, i) => (
        <div className="row" key={i}>
          <span className="row-body">
            <span className="row-title regular wrap">{a.text}</span>
          </span>
          <span className="row-end">{observedAt(a.at, now)}</span>
        </div>
      ))}
    </Card>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
