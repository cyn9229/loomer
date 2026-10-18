// The Working screen's pieces. WorkHeader: which assignment, what Loomer last
// read, a stat strip (words, sources, checklist marks), and the Help | Sources
// switch. SourcesBody: the draft, saved pages and
// screenshots, what happened this session, and Pause / End. HintCard,
// SuggestionRow and LinkDocStep render inside Help. Every change goes through
// PanelApi messages.
import { useEffect, useState, type FormEvent } from 'react';
import { DOCS_ORIGINS } from '../core/messages';
import type { AssignmentDetailModel, RequirementItem } from '../model/detail';
import type { DiscoverySuggestion, DocReadState, DocState, ProactiveHint, SessionModel, SourceItem } from '../model/session';
import { useAction, type PanelApi } from './api';
import { observedAt, timeOf } from './format';
import { Icon } from './Icon';
import { DeleteAssignmentData, docRule, hostRule, NeverRead } from './privacy';

export type ActiveSession = Extract<SessionModel, { status: 'active' | 'paused' }>;
export type WorkTab = 'help' | 'sources';

const readLine: Record<DocReadState, string> = {
  ok: 'Loomer is reading your draft',
  waiting: 'Draft linked. Loomer reads it soon',
  'rate-limited': 'Google asked Loomer to slow down. It picks back up on its own',
  'no-access': 'Loomer can’t open your Doc. Sign in to Google with the account that owns it',
  unreadable: 'Loomer couldn’t read your Doc. It’ll try again',
};

/** One line about the draft, under the title. */
function draftLine(doc: DocState, now: Date): string {
  if (doc.status === 'not-linked') return 'No draft linked yet';
  if (doc.readState !== 'ok') return readLine[doc.readState];
  const parts = [doc.lastReadAt ? `Draft read ${observedAt(doc.lastReadAt, now)}` : 'Draft linked', doc.studentWords !== null ? `${doc.studentWords} of your words` : null];
  return parts.filter(Boolean).join(' · ');
}

/** Whole minutes until the student's time is up (0 or less once it is), or null without a limit. */
export function minutesLeft(session: ActiveSession, now: Date): number | null {
  return session.plannedUntil ? Math.ceil((Date.parse(session.plannedUntil) - now.getTime()) / 60_000) : null;
}

/**
 * The top bar's clock: "28 min left" when the student set a time ("warn" in the
 * last 5 minutes), otherwise "24 min" since the start, or "Paused". The panel
 * refreshes `now` once a minute, so this changes once a minute and never animates.
 */
export function sessionClock(session: ActiveSession, now: Date): { text: string; paused: boolean; warn: boolean } {
  if (session.status === 'paused') return { text: 'Paused', paused: true, warn: false };
  const left = minutesLeft(session, now);
  if (left !== null) return { text: left > 0 ? `${left} min left` : 'Time’s up', paused: false, warn: left <= 5 };
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(session.startedAt).getTime()) / 60_000));
  return { text: minutes < 1 ? 'Just started' : `${minutes} min`, paused: false, warn: false };
}

/**
 * The student's time limit inside the Working screen. In the last 5 minutes, a
 * quiet note; at time up, Stop here (session:end) or Keep going (session:time
 * null, which clears the limit). Loomer never stops a session by itself.
 */
export function SessionTime({ session, now, api, onStopped }: { session: ActiveSession; now: Date; api: PanelApi; onStopped: (item: ActiveSession['assignment']) => void }) {
  const act = useAction();
  const [noted, setNoted] = useState<string | null>(null);
  const left = minutesLeft(session, now);
  if (left === null || left > 5 || session.status !== 'active') return null;
  if (left > 0) {
    return noted === session.plannedUntil ? null : (
      <p className="tnote" role="status">
        <Icon name="edit" size="sm" />
        <span className="grow">About {left} min left. Note where you stopped.</span>
        <button type="button" className="link" onClick={() => setNoted(session.plannedUntil)}>
          Got it
        </button>
      </p>
    );
  }
  return (
    <section className="tup" role="status" aria-label="Time is up">
      <p className="tup-k">
        <Icon name="sandglass" size="sm" />
        Your time is up
      </p>
      <p className="tup-p">Stop here or keep going. Loomer won’t stop you.</p>
      <div className="pc-act">
        <button
          type="button"
          className="btn-primary sm"
          disabled={act.busy}
          onClick={() =>
            act.run(async () => {
              const reply = await api.send({ type: 'session:end' });
              if (reply.ok) onStopped(session.assignment);
              return reply;
            })
          }
        >
          Stop here
        </button>
        <button type="button" className="btn" disabled={act.busy} onClick={() => act.run(() => api.send({ type: 'session:time', minutes: null }))}>
          Keep going
        </button>
      </div>
      {act.error && <p className="status-line error">{act.error}</p>}
    </section>
  );
}

type WorkHeaderProps = {
  session: ActiveSession;
  now: Date;
  tab: WorkTab;
  onTab: (t: WorkTab) => void;
  hintWaiting: boolean;
  /** The assignment's detail model, for the checklist marks. */
  detail: AssignmentDetailModel | undefined;
  /** Opens the assignment's detail (the full checklist). */
  onChecklist: () => void;
};

export function WorkHeader({ session, now, tab, onTab, hintWaiting, detail, onChecklist }: WorkHeaderProps) {
  return (
    <>
      <h1 className="w-title">{session.assignment.title}</h1>
      <p className="w-meta">{session.status === 'paused' ? 'Paused. Loomer isn’t reading your draft or saving pages.' : draftLine(session.doc, now)}</p>
      <StatStrip session={session} detail={detail} onSources={() => onTab('sources')} onChecklist={onChecklist} />
      <div className="seg" role="tablist" aria-label="Working">
        <button type="button" role="tab" aria-selected={tab === 'help'} onClick={() => onTab('help')}>
          Help
          {hintWaiting && tab !== 'help' && <span className="dot" aria-label="1 hint ready" />}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'sources'} onClick={() => onTab('sources')}>
          Sources <span className="n">{session.sources.length}</span>
        </button>
      </div>
    </>
  );
}

/**
 * Three facts at a glance: your words in the draft, saved sources, and the
 * next open checklist item from the last draft check. Each one opens where it lives.
 */
function StatStrip({ session, detail, onSources, onChecklist }: { session: ActiveSession; detail: AssignmentDetailModel | undefined; onSources: () => void; onChecklist: () => void }) {
  const words = session.doc.status === 'linked' ? session.doc.studentWords : null;
  return (
    <div className="stats">
      <button type="button" className="stat" onClick={onSources}>
        <Icon name="doc" />
        <b>{words ?? '—'}</b>
        <span>{words === null ? 'no draft read yet' : 'your words'}</span>
      </button>
      <button type="button" className="stat" onClick={onSources}>
        <Icon name="layers" />
        <b>{session.sources.length}</b>
        <span>{session.sources.length === 1 ? 'source' : 'sources'}</span>
      </button>
      <button type="button" className="stat wide next" onClick={onChecklist}>
        <NextToFix requirements={detail?.status === 'ok' && detail.check ? detail.requirements : null} />
      </button>
    </div>
  );
}

/**
 * The checklist cell: the first thing to look at, else the first thing Loomer
 * can't tell, with how many more are open. Before any check, says so.
 */
function NextToFix({ requirements }: { requirements: RequirementItem[] | null }) {
  if (!requirements) {
    return (
      <>
        <span className="nk">
          <Icon name="listChecks" size="xs" />
          Checklist
        </span>
        <b className="soft">Not checked</b>
        <span>Tap to see it</span>
      </>
    );
  }
  const review = requirements.filter((r) => r.state === 'needs-review');
  const unknown = requirements.filter((r) => r.state === 'unknown');
  const first = review[0] ?? unknown[0];
  if (!first) {
    return (
      <>
        <span className="nk ok">
          <Icon name="checkCircle" size="xs" />
          Checklist
        </span>
        <b>All found</b>
        <span>in your draft</span>
      </>
    );
  }
  const more = review.length + unknown.length - 1;
  const note = first.evidence?.note ?? (first.state === 'needs-review' ? 'Take a look' : 'Can’t tell yet');
  return (
    <>
      <span className="nk">
        <Icon name="target" size="xs" />
        {first.state === 'needs-review' ? 'Next to fix' : 'Next to check'}
      </span>
      <b className="sm">{first.text}</b>
      <span>
        {note}
        {more > 0 && ` · ${more} more open`}
      </span>
    </>
  );
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
 * A new hint shows in full. Hide collapses it to one line; that line's x is the
 * real dismiss (hint:dismiss): that kind of hint is not raised again for this
 * assignment. Rendering a hint tells the worker it was seen (hint:seen), which
 * clears the toolbar badge. Never takes focus.
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
          <Icon name="sparkle" />
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
    <section className={leaving ? 'hint leaving' : 'hint'} aria-label="Hint" aria-hidden={leaving || undefined}>
      <div className="hint-k">
        <span className="hint-ic">
          <Icon name="sparkle" />
        </span>
        Hint
        <span className="grow" />
        <button type="button" className="link muted" onClick={onMoreHelp}>
          More help
        </button>
        <button type="button" className="link muted" onClick={onHide}>
          Hide
        </button>
      </div>
      <p className="hint-text">{hint.text}</p>
      {hint.reference && (
        <p className="reference">
          <mark>“{hint.reference.quote}”</mark> <span className="from">{hint.reference.from}</span>
        </p>
      )}
    </section>
  );
}

/**
 * Research discovery: one quiet line for the tab in front. It never claims the
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
    <section className={leaving ? 'leaving' : undefined} aria-label="Page suggestion" aria-hidden={leaving || undefined}>
      <div className="sugg">
        <Icon name="globe" />
        <span className="grow">
          <b>Save this page as a source?</b>
          <span className="sub" title={suggestion.matched.length ? `Title mentions: ${suggestion.matched.join(', ')}` : undefined}>
            {suggestion.title} · {hostOf(suggestion.url)}
          </span>
        </span>
        <button type="button" className="link" onClick={add} disabled={action.busy || leaving || !origin} aria-busy={verb === 'add'}>
          {verb === 'add' ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="icon-btn" aria-label="Not now" title="Not now" onClick={dismiss} disabled={action.busy || leaving} aria-busy={verb === 'dismiss'}>
          <Icon name="x" size="sm" />
        </button>
      </div>
      {rule && !leaving && (
        <div className="sugg-more">
          <NeverRead rule={rule} label="Never read this site" deleteLabel="Also delete pages already saved from this site" send={api.send} />
        </div>
      )}
      {action.error && <p className="status-line error" style={{ paddingBottom: 8 }}>{action.error}</p>}
    </section>
  );
}

export function Reference({ quote, from }: { quote: string; from: 'your draft' | 'the instructions' }) {
  return (
    <figure className="reference">
      <blockquote>“{quote}”</blockquote> <figcaption>{from}</figcaption>
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
      <span className="num">{n ?? <Icon name="doc" size="xs" />}</span>
      <div className="grow">
        <div className="step-t">Which Doc is your draft?</div>
        <div className="step-s">{candidates.length > 0 ? 'We found these in the instructions. Pick yours.' : 'Paste the link to your Google Doc.'}</div>
        {candidates.map((c) => (
          <div className="pick" key={c.docId}>
            <Icon name="doc" />
            <span className="grow">
              <span className="row-title">Google Doc</span>
              <span className="row-sub ellipsis">{c.url.replace('https://', '')}</span>
            </span>
            <button type="button" className="btn sm accent" disabled={action.busy} aria-busy={linking === c.url} onClick={() => link(c.url)}>
              {linking === c.url ? 'Linking…' : 'Use this'}
            </button>
          </div>
        ))}
        <form onSubmit={submit} className="paste-row">
          <label className="grow">
            <span className="visually-hidden">Google Doc link</span>
            <input className="input" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Or paste a Doc link" inputMode="url" spellCheck={false} />
          </label>
          <button type="submit" className="btn" disabled={action.busy || !pasted.trim()} aria-busy={linking !== null && linking === pasted.trim()}>
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

/** The Sources tab: the draft, saved pages, what happened, and Pause / End. */
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
      <div className="sec">
        <h2>Your draft</h2>
      </div>
      {session.doc.status === 'linked' ? (
        <LinkedDoc doc={session.doc} now={now} api={api} />
      ) : (
        <LinkDocStep assignmentId={session.assignment.assignmentId} candidates={session.doc.candidates} api={api} />
      )}

      <div className="sec">
        <h2>Sources</h2>
        <span className="aside">{session.sources.length === 0 ? 'None yet' : session.sources.length}</span>
      </div>
      {session.sources.map((s) => (
        <SourceRow key={s.id} source={s} now={now} api={api} />
      ))}
      <p className="field-hint">To save a page, right-click it and pick “Add page to Loomer”, or press Alt+Shift+L.</p>

      {session.activity.length > 0 && (
        <>
          <div className="sec">
            <h2>This session</h2>
          </div>
          {session.activity.map((a, i) => (
            <div className="activity" key={i}>
              <span className="item-t">{timeOf(a.at)}</span>
              <span>{a.text}</span>
            </div>
          ))}
        </>
      )}

      <div className="session-ctl">
        <button type="button" className="btn" disabled={action.busy} aria-busy={verb === 'pause' || verb === 'resume'} onClick={() => runVerb(paused ? 'resume' : 'pause')}>
          <Icon name={paused ? 'play' : 'pause'} />
          {verb === 'pause' || verb === 'resume' ? busyLabel[verb] : paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn" disabled={action.busy} aria-busy={verb === 'end'} onClick={() => runVerb('end')}>
          {verb === 'end' ? busyLabel.end : 'End session'}
        </button>
      </div>
      {action.error && <p className="status-line error pad">{action.error}</p>}
      <div className="row-actions pad" style={{ padding: '16px 18px 18px' }}>
        <DeleteAssignmentData assignmentId={session.assignment.assignmentId} send={api.send} />
      </div>
    </>
  );
}

function LinkedDoc({ doc, now, api }: { doc: Extract<DocState, { status: 'linked' }>; now: Date; api: PanelApi }) {
  const trouble = doc.readState === 'no-access' || doc.readState === 'unreadable' || doc.readState === 'rate-limited';
  return (
    <>
      <div className="row-line">
        <Icon name="doc" />
        <span className="grow">
          <span className="row-title">Google Doc</span>
          <span className={trouble ? 'row-sub danger-text' : 'row-sub'}>{draftLine(doc, now)}</span>
        </span>
        <a className="link" href={doc.url} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
      <div className="indent">
        <NeverRead rule={docRule(doc.docId)} label="Never read this Doc" deleteLabel="Also delete Loomer’s copy of this Doc" send={api.send} />
      </div>
    </>
  );
}

function SourceRow({ source, now, api }: { source: SourceItem; now: Date; api: PanelApi }) {
  const action = useAction();
  const rule = hostRule(source.url);
  return (
    <>
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
        <button type="button" className="link muted" disabled={action.busy} aria-busy={action.busy} onClick={() => action.run(() => api.send({ type: 'source:remove', id: source.id }))}>
          {action.busy ? 'Removing…' : 'Remove'}
        </button>
      </div>
      {rule && (
        <div className="indent">
          <NeverRead rule={rule} label="Never read this site" deleteLabel="Also delete pages already saved from this site" send={api.send} />
        </div>
      )}
    </>
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
