// Work-session pieces. SessionHero is the band for Chat and Sources (which
// assignment, what Loomer last read). SourcesBody is the Sources tab: session
// controls, the linked draft, saved pages and screenshots, and factual activity.
// HintCard, SuggestionRow and LinkDocStep render inside Chat. Every change goes
// through PanelApi messages.
import { useEffect, useState, type FormEvent } from 'react';
import { DOCS_ORIGINS } from '../core/messages';
import type { DiscoverySuggestion, DocReadState, DocState, ProactiveHint, SessionModel, SourceItem } from '../model/session';
import { useAction, type PanelApi } from './api';
import { observedAt } from './format';
import { Icon } from './Icon';
import { DeleteAssignmentData, docRule, hostRule, NeverRead } from './privacy';

export type ActiveSession = Extract<SessionModel, { status: 'active' | 'paused' }>;

const readLine: Record<DocReadState, string> = {
  ok: 'Loomer is reading your draft',
  waiting: 'Draft linked. Loomer reads it soon',
  'rate-limited': 'Google asked Loomer to slow down. Reading picks back up on its own',
  'no-access': 'Loomer can’t open your Doc. Sign in to Google with the account that owns it',
  unreadable: 'Loomer couldn’t read your Doc. It’ll try again',
};

/** One line about the draft, for the band. */
function draftLine(doc: DocState, now: Date): string {
  if (doc.status === 'not-linked') return 'Link your draft to get started';
  if (doc.readState === 'ok' && doc.lastReadAt) return `Loomer read your draft at ${observedAt(doc.lastReadAt, now)}`;
  return readLine[doc.readState];
}

export function SessionHero({ session, now }: { session: ActiveSession; now: Date }) {
  return (
    <>
      <h1 className="hero-title md clamp">{session.assignment.title}</h1>
      <p className="hero-sub">{session.status === 'paused' ? 'Paused. Loomer isn’t reading your draft or saving pages.' : draftLine(session.doc, now)}</p>
    </>
  );
}

/** Band pill for the header: working or paused. */
export function sessionPill(session: ActiveSession, now: Date): { text: string; paused: boolean } {
  if (session.status === 'paused') return { text: 'Paused', paused: true };
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(session.startedAt).getTime()) / 60_000));
  return { text: minutes < 1 ? 'Working · just now' : `Working · ${minutes} min`, paused: false };
}

type HintProps = {
  hint: NonNullable<ProactiveHint>;
  /** The hint went away on its own (or was dismissed); fade out. */
  leaving: boolean;
  hidden: boolean;
  onHide: () => void;
  onShow: () => void;
  onMoreHelp: () => void;
  api: PanelApi;
};

/**
 * A new hint shows as the full card. Hide collapses it to one row; the row's x
 * is the real dismiss (hint:dismiss): that kind of hint is not raised again for
 * this assignment. Rendering a hint tells the worker it was seen (hint:seen),
 * which clears the toolbar badge. Never takes focus.
 */
export function HintCard({ hint, leaving, hidden, onHide, onShow, onMoreHelp, api }: HintProps) {
  const dismiss = useAction();

  useEffect(() => {
    // Once per hint. A failed "seen" only leaves the badge up, so it is not shown as an error.
    void api.send({ type: 'hint:seen' }).catch(() => undefined);
  }, [hint.id, api]);

  if (hidden) {
    return (
      <div className={leaving ? 'hint-row leaving' : 'hint-row'} aria-hidden={leaving || undefined}>
        <button type="button" className="hint-row-open" onClick={onShow}>
          <Icon name="sparkle" size="sm" />
          1 hint ready
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Don’t show this kind of hint again"
          title="Don’t show this kind of hint again"
          disabled={dismiss.busy || leaving}
          aria-busy={dismiss.busy}
          onClick={() => dismiss.run(() => api.send({ type: 'hint:dismiss', id: hint.id }))}
        >
          <Icon name="x" size="sm" />
        </button>
        {dismiss.error && <p className="status-line error">{dismiss.error}</p>}
      </div>
    );
  }
  return (
    <section className={leaving ? 'block violet hint leaving' : 'block violet hint'} aria-label="Hint" aria-hidden={leaving || undefined}>
      <div className="block-k">
        <Icon name="sparkle" />
        Hint
        <span className="grow" />
        <button type="button" className="link subtle" onClick={onHide}>
          Hide
        </button>
      </div>
      <p className="block-text">{hint.text}</p>
      {hint.reference && <Reference quote={hint.reference.quote} from={hint.reference.from} />}
      <div className="block-act">
        <button type="button" className="btn sm on-tint" onClick={onMoreHelp}>
          More help
        </button>
      </div>
    </section>
  );
}

/**
 * Research discovery: one quiet row for the tab in front. It never claims the
 * page is relevant. Save asks Chrome for this one site inside the click, then
 * the worker saves one snapshot and gives the access back.
 */
export function SuggestionRow({ suggestion, leaving, api }: { suggestion: NonNullable<DiscoverySuggestion>; leaving: boolean; api: PanelApi }) {
  const action = useAction();
  const [verb, setVerb] = useState<'add' | 'dismiss' | null>(null);
  const origin = originOf(suggestion.url);

  const add = () => {
    if (!origin) return;
    setVerb('add');
    action.run(() =>
      // requestOrigins runs synchronously inside this click, before any await.
      api
        .requestOrigins([`${origin}/*`])
        .then((granted) =>
          granted
            ? api.send({ type: 'suggestion:add', tabId: suggestion.tabId })
            : { ok: false as const, error: 'Chrome didn’t allow access to this site. Nothing was saved.' },
        )
        .finally(() => setVerb(null)),
    );
  };

  const dismiss = () => {
    setVerb('dismiss');
    action.run(() => api.send({ type: 'suggestion:dismiss' }).finally(() => setVerb(null)));
  };

  const rule = hostRule(suggestion.url);
  return (
    <section className={leaving ? 'suggestion leaving' : 'suggestion'} aria-label="Page suggestion" aria-hidden={leaving || undefined}>
      <div className="suggestion-main">
        <Icon name="globe" />
        <div className="grow">
          <div className="suggestion-t">Researching for this? Save this page.</div>
          <div className="suggestion-s" title={suggestion.matched.length ? `Title mentions: ${suggestion.matched.join(', ')}` : undefined}>
            {suggestion.title} · {hostOf(suggestion.url)}
          </div>
        </div>
        <button type="button" className="vbtn sm" onClick={add} disabled={action.busy || leaving || !origin} aria-busy={verb === 'add'}>
          <Icon name="plus" />
          {verb === 'add' ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="btn-row">
        <button type="button" className="link subtle" onClick={dismiss} disabled={action.busy || leaving} aria-busy={verb === 'dismiss'}>
          {verb === 'dismiss' ? 'Stopping…' : 'Not now'}
        </button>
        {rule && !leaving && <NeverRead rule={rule} label="Never read this site" deleteLabel="Also delete pages already saved from this site" send={api.send} />}
      </div>
      {action.error && <p className="status-line error">{action.error}</p>}
    </section>
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

const DOC_URL = /^https:\/\/docs\.google\.com\/document\/d\/[\w-]+/;

/** Asks once which Doc is the draft. One click per candidate, or paste a link. Never links on its own. */
export function LinkDocStep({ n, assignmentId, candidates, api }: { n?: number; assignmentId: string; candidates: { docId: string; url: string }[]; api: PanelApi }) {
  const action = useAction();
  const [pasted, setPasted] = useState('');
  const [linking, setLinking] = useState<string | null>(null);

  const link = (docUrl: string) => {
    setLinking(docUrl);
    action.run(() =>
      // requestOrigins runs synchronously inside this click, before any await.
      api
        .requestOrigins(DOCS_ORIGINS)
        .then((granted) =>
          granted
            ? api.send({ type: 'doc:link', assignmentId, docUrl })
            : { ok: false as const, error: 'Chrome didn’t allow access to Google Docs. Your draft isn’t linked.' },
        )
        .finally(() => setLinking(null)),
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = pasted.trim();
    if (!DOC_URL.test(url)) {
      action.setError('That doesn’t look like a Google Doc link.');
      return;
    }
    link(url);
  };

  return (
    <section className="step" aria-label="Link your draft">
      {n !== undefined && <span className="num">{n}</span>}
      <div className="grow">
        <div className="step-t">Which Doc is your draft?</div>
        <div className="step-s">{candidates.length > 0 ? 'We found these in the instructions. Pick yours.' : 'Paste the link to your Google Doc.'}</div>
        {candidates.map((c) => (
          <div className="pick" key={c.docId}>
            <Icon name="doc" />
            <span className="grow">
              <span className="row-title">Google Doc</span>
              <span className="row-sub ellipsis">
                {c.url.replace('https://', '')}
              </span>
            </span>
            <button type="button" className="vbtn sm" disabled={action.busy} aria-busy={linking === c.url} onClick={() => link(c.url)}>
              {linking === c.url ? 'Linking…' : 'Use this'}
            </button>
          </div>
        ))}
        <form onSubmit={submit} className="paste-row">
          <label className="grow">
            <span className="visually-hidden">Google Doc link</span>
            <input className="input" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste a Doc link" inputMode="url" spellCheck={false} />
          </label>
          <button type="submit" className="btn sm on-tint" style={{ height: 38 }} disabled={action.busy || !pasted.trim()} aria-busy={linking !== null && linking === pasted.trim()}>
            Link
          </button>
        </form>
        {action.error && <p className="status-line error" style={{ marginTop: 6 }}>{action.error}</p>}
      </div>
    </section>
  );
}

type SessionVerb = 'pause' | 'resume' | 'end';
const busyLabel: Record<SessionVerb, string> = { pause: 'Pausing…', resume: 'Resuming…', end: 'Ending…' };

/** The Sources tab: session controls, the draft, saved pages, and what happened. */
export function SourcesBody({ session, now, api }: { session: ActiveSession; now: Date; api: PanelApi }) {
  const action = useAction();
  const [verb, setVerb] = useState<SessionVerb | null>(null);
  const runVerb = (v: SessionVerb) => {
    setVerb(v);
    action.run(() => api.send({ type: v === 'end' ? 'session:end' : v === 'pause' ? 'session:pause' : 'session:resume' }).finally(() => setVerb(null)));
  };
  const paused = session.status === 'paused';
  return (
    <>
      <div className="session-ctl">
        <button type="button" className="btn sm" disabled={action.busy} aria-busy={verb === 'pause' || verb === 'resume'} onClick={() => runVerb(paused ? 'resume' : 'pause')}>
          <Icon name={paused ? 'play' : 'pause'} />
          {verb === 'pause' || verb === 'resume' ? busyLabel[verb] : paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn sm" disabled={action.busy} aria-busy={verb === 'end'} onClick={() => runVerb('end')}>
          {verb === 'end' ? busyLabel.end : 'End session'}
        </button>
      </div>
      {action.error && <p className="status-line error">{action.error}</p>}

      {session.doc.status === 'linked' ? (
        <LinkedDoc doc={session.doc} now={now} api={api} />
      ) : (
        <LinkDocStep assignmentId={session.assignment.assignmentId} candidates={session.doc.candidates} api={api} />
      )}

      <section aria-label="Saved sources">
        <div className="sec">
          <h2>Sources</h2>
          <span className="n">{session.sources.length}</span>
        </div>
        {session.sources.map((s) => (
          <SourceRow key={s.id} source={s} now={now} api={api} />
        ))}
        <p className="field-hint">Right-click any page and pick “Add page to Loomer”, or press Alt+Shift+L.</p>
      </section>

      {session.activity.length > 0 && (
        <section aria-label="This session">
          <div className="sec">
            <h2>This session</h2>
          </div>
          {session.activity.map((a, i) => (
            <div className="row-line" key={i}>
              <span className="grow row-sub" style={{ color: 'var(--ink)', fontSize: 13 }}>
                {a.text}
              </span>
              <span className="when">{observedAt(a.at, now)}</span>
            </div>
          ))}
        </section>
      )}
      <div className="row-actions">
        <DeleteAssignmentData assignmentId={session.assignment.assignmentId} send={api.send} />
      </div>
    </>
  );
}

function LinkedDoc({ doc, now, api }: { doc: Extract<DocState, { status: 'linked' }>; now: Date; api: PanelApi }) {
  const facts = [doc.lastReadAt ? `read ${observedAt(doc.lastReadAt, now)}` : null, doc.studentWords !== null ? `${doc.studentWords} of your words` : null].filter(Boolean);
  const trouble = doc.readState === 'no-access' || doc.readState === 'unreadable' || doc.readState === 'rate-limited';
  return (
    <section className={trouble ? 'block amber' : 'block'} aria-label="Your draft">
      <div className="row-line" style={{ padding: 0 }}>
        <Icon name="doc" />
        <span className="grow">
          <span className="row-title">Your draft</span>
          <span className="row-sub">
            {doc.readState === 'ok' ? `Google Doc${facts.length ? ` · ${facts.join(' · ')}` : ''}` : readLine[doc.readState]}
          </span>
        </span>
        <a className="btn sm on-tint" href={doc.url} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
      <div className="row-actions">
        <NeverRead rule={docRule(doc.docId)} label="Never read this Doc" deleteLabel="Also delete Loomer’s copy of this Doc" send={api.send} />
      </div>
    </section>
  );
}

function SourceRow({ source, now, api }: { source: SourceItem; now: Date; api: PanelApi }) {
  const action = useAction();
  const rule = hostRule(source.url);
  return (
    <div>
      <div className="row-line">
        {source.kind === 'screenshot' && source.image ? <img className="thumb" src={source.image} alt="" /> : <Icon name={source.kind === 'screenshot' ? 'image' : 'globe'} />}
        <span className="grow">
          <a className="row-title" href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
          <span className="row-sub">
            {source.kind === 'screenshot' ? 'Screenshot' : hostOf(source.url)} · {observedAt(source.capturedAt, now)}
          </span>
          {action.error && <span className="row-sub danger-text">{action.error}</span>}
        </span>
        <button type="button" className="link subtle" disabled={action.busy} aria-busy={action.busy} onClick={() => action.run(() => api.send({ type: 'source:remove', id: source.id }))}>
          {action.busy ? 'Removing…' : 'Remove'}
        </button>
      </div>
      {rule && (
        <div className="row-actions" style={{ margin: '-4px 0 6px 30px' }}>
          <NeverRead rule={rule} label="Never read this site" deleteLabel="Also delete pages already saved from this site" send={api.send} />
        </div>
      )}
    </div>
  );
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
