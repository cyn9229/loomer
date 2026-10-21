// The Working screen's pieces. WorkHeader: which assignment and what kind of
// work, with writing's words, sources, and checklist in the same line, then by
// type: writing gets the session focus (a few words; why and handled hints
// behind its info button); practice and study get the teacher's sheets, a Next topic,
// and the topics with their last Quick check; reading gets neither; a quiz gets
// only the title. Then the Help | Sources switch (not for a quiz, see QuizNote).
// SessionControls (Pause or Resume, and End) sit in the top bar and on
// SessionStrip, which shows the running session on Home. End opens the end
// sheet (endSheet.tsx). SourcesBody: the draft or sheet, saved
// pages and screenshots, and what happened this session. HintCard,
// SuggestionRow and LinkDocStep render inside Help. Every change goes through
// PanelApi messages.
import { useEffect, useState, type FormEvent } from 'react';
import { DOCS_ORIGINS } from '../core/messages';
import type { AssignmentDetailModel, RequirementItem } from '../model/detail';
import type { DiscoverySuggestion, DocReadState, DocState, ProactiveHint, SessionModel, SourceItem, TopicNext } from '../model/session';
import { useAction, type PanelApi } from './api';
import { observedAt, timeOf } from './format';
import { SheetList } from './sheets';
import { typeLabel } from './workType';
import { AiBlock } from './aiBlock';
import { Icon } from './Icon';
import { DeleteAssignmentData, docRule, hostRule, NeverRead } from './privacy';

export type ActiveSession = Extract<SessionModel, { status: 'active' | 'paused' }>;
export type WorkTab = 'help' | 'sources';

const readLine: Record<DocReadState, string> = {
  ok: 'Loomer is reading your draft',
  waiting: 'Your draft is linked, and Loomer will read it soon',
  'rate-limited': 'Google asked Loomer to slow down, so it will try again in a minute',
  'no-access': 'Loomer can’t open your Doc, so sign in to Google with the account that owns it',
  unreadable: 'Loomer couldn’t read your Doc and will try again soon',
};

/**
 * The linked Doc: the student's draft (writing), or their own copy of the
 * work (practice, study). Loomer reads the teacher's sheets by itself.
 */
type DocKind = 'draft' | 'copy';

function docKind(session: ActiveSession): DocKind {
  return session.assignment.workType.type === 'practice' || session.assignment.workType.type === 'study' ? 'copy' : 'draft';
}

/** One line about the linked Doc. A copy of practice work never gets a word count. */
function draftLine(doc: DocState, now: Date, kind: DocKind = 'draft'): string {
  if (doc.status === 'not-linked') return kind === 'copy' ? 'No copy linked' : 'No draft linked yet';
  if (doc.readState !== 'ok') return kind === 'copy' && doc.readState === 'waiting' ? 'Your copy is linked, and Loomer will read it soon' : readLine[doc.readState];
  const name = kind === 'copy' ? 'Copy' : 'Draft';
  const parts = [doc.lastReadAt ? `${name} read ${observedAt(doc.lastReadAt, now)}` : `${name} linked`, kind === 'draft' && doc.studentWords !== null ? `${doc.studentWords} of your words` : null];
  return parts.filter(Boolean).join(' · ');
}

/**
 * Whole minutes until the student's time is up (0 or less once it is), or null
 * without a limit. The panel's `now` can be up to a minute old, which would make
 * a fresh 30 min limit read "31 min left", so the later of it and the clock is used.
 */
export function minutesLeft(session: ActiveSession, now: Date): number | null {
  return session.plannedUntil ? Math.ceil((Date.parse(session.plannedUntil) - Math.max(now.getTime(), Date.now())) / 60_000) : null;
}

/**
 * The top bar's state: "28 min left" when the student set a time ("warn" in the
 * last 5 minutes), otherwise "Working", or "Paused". Never time spent: Loomer
 * doesn't track it. The panel refreshes `now` once a minute, so a countdown
 * changes once a minute and never animates.
 */
export function sessionClock(session: ActiveSession, now: Date): { text: string; paused: boolean; warn: boolean } {
  if (session.status === 'paused') return { text: 'Paused', paused: true, warn: false };
  const left = minutesLeft(session, now);
  if (left !== null) return { text: left > 0 ? `${left} min left` : 'Time’s up', paused: false, warn: left <= 5 };
  return { text: 'Working', paused: false, warn: false };
}

/**
 * The student's time limit inside the Working screen. In the last 5 minutes, a
 * quiet note; at time up, Stop here (opens the end sheet) or Keep going
 * (session:time null, which clears the limit). Loomer never stops a session by itself.
 */
export function SessionTime({ session, now, api, onStop }: { session: ActiveSession; now: Date; api: PanelApi; onStop: () => void }) {
  const act = useAction();
  const [noted, setNoted] = useState<string | null>(null);
  const left = minutesLeft(session, now);
  if (left === null || left > 5 || session.status !== 'active') return null;
  if (left > 0) {
    return noted === session.plannedUntil ? null : (
      <p className="tnote" role="status">
        <Icon name="edit" size="sm" />
        <span className="grow">You have about {left} {left === 1 ? 'minute' : 'minutes'} left, so jot down where you are.</span>
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
      <p className="tup-p">You can stop here or keep going.</p>
      <div className="pc-act">
        <button type="button" className="btn-primary sm" disabled={act.busy} onClick={onStop}>
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
  api: PanelApi;
};

type Topic = NonNullable<ActiveSession['topics']>['items'][number];
type HelpMode = 'explain' | 'example' | 'check';

/**
 * Asks Loomer about one topic (topic:help). The reply streams into the
 * assignment's chat; the worker marks that chat as opened for a topic, and the
 * panel switches to it and says so.
 */
function useTopicHelp(assignmentId: string, send: PanelApi['send']) {
  const help = useAction();
  const ask = (topic: string, mode: HelpMode) => help.run(() => send({ type: 'topic:help', assignmentId, topic, mode }));
  return { ask, busy: help.busy, error: help.error };
}

/**
 * Where to start, and why ("You missed 2 of 3 on the last check."). With a
 * time limit it says how to use the time. One primary button: Quick check, or
 * Explain when the topic needs explaining first.
 */
function NextTopic({ next, session, now, help }: { next: NonNullable<TopicNext>; session: ActiveSession; now: Date; help: ReturnType<typeof useTopicHelp> }) {
  const left = minutesLeft(session, now);
  const [first, second] = next.mode === 'check' ? (['check', 'explain'] as const) : (['explain', 'check'] as const);
  const label = { check: 'Quick check', explain: 'Explain it' } as const;
  return (
    <section className="next-topic" aria-label="Next topic">
      <p className="nt-k">
        <Icon name="target" size="sm" />
        <span>
          {left !== null && left > 0 ? `You have ${left} min: start with ` : 'Next: '}
          <b>{next.topic}</b>
        </span>
      </p>
      <p className="nt-r">{next.reason}</p>
      <div className="nt-a">
        <button type="button" className="btn-primary sm" disabled={help.busy} onClick={() => help.ask(next.topic, first)}>
          <Icon name={first === 'check' ? 'question' : 'bulb'} size="sm" />
          {label[first]}
        </button>
        <button type="button" className="btn" disabled={help.busy} onClick={() => help.ask(next.topic, second)}>
          {second === 'explain' ? 'Explain it first' : 'Quick check'}
        </button>
      </div>
    </section>
  );
}

const lastCheckText = (t: Topic) => (t.lastCheck ? `Last check: ${t.lastCheck.correct} of ${t.lastCheck.total}` : 'Not checked');

/**
 * The topics on the teacher's sheets, grouped by sheet when there is more than
 * one. Each row shows how the student did on their last Quick check (not
 * checked, shaky, solid); tapping it offers Explain, Example and Quick check,
 * and a quiet Skip for a topic the teacher dropped. Skipped topics sit at the
 * bottom with Undo. Each topic's quote from the sheet is its tooltip.
 */
function TopicsList({ topics, item, help, send }: { topics: NonNullable<ActiveSession['topics']>; item: ActiveSession['assignment']; help: ReturnType<typeof useTopicHelp>; send: PanelApi['send'] }) {
  const [open, setOpen] = useState<string | null>(null);
  const skip = useAction();
  const shown = topics.items.filter((t) => !t.skipped);
  const skipped = topics.items.filter((t) => t.skipped);
  const groups = [...new Set(shown.map((t) => t.sheet))];
  const grouped = groups.length > 1;
  const title = grouped ? 'Topics' : item.workType.type === 'study' ? 'What’s on the test' : 'Topics on the sheet';
  const count = (standing: Topic['standing']) => shown.filter((t) => t.standing === standing).length;
  const summary = (
    [
      [count('solid'), 'solid'],
      [count('shaky'), 'shaky'],
      [count('unchecked'), 'not checked'],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(' · ');
  const setSkipped = (topic: string, value: boolean) => skip.run(() => send({ type: 'topic:skip', assignmentId: item.assignmentId, topic, skipped: value }));

  const row = (t: Topic) => {
    const isOpen = open === t.text;
    return (
      <div className={isOpen ? 'trow open' : 'trow'} key={`${t.sheet}:${t.text}`}>
        <button type="button" className="trow-b" aria-expanded={isOpen} title={`“${t.quote}”`} onClick={() => setOpen(isOpen ? null : t.text)}>
          <span className={`tmark ${t.standing}`} aria-hidden="true">
            {t.standing === 'solid' ? <Icon name="check" /> : <i />}
          </span>
          <span className="grow">{t.text}</span>
          <span className={`tscore ${t.standing}`}>{lastCheckText(t)}</span>
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size="xs" />
        </button>
        {isOpen && (
          <div className="trow-x">
            <div className="tacts">
              {(
                [
                  ['explain', 'bulb', 'Explain'],
                  ['example', 'copy', 'Example'],
                  ['check', 'question', 'Quick check'],
                ] as const
              ).map(([mode, icon, label]) => (
                <button key={mode} type="button" className={mode === 'check' ? 'tact soft' : 'tact'} disabled={help.busy} onClick={() => help.ask(t.text, mode)}>
                  <Icon name={icon} size="sm" />
                  {label}
                </button>
              ))}
            </div>
            <p className="tskip">
              Not needed anymore?{' '}
              <button type="button" className="link" disabled={skip.busy} onClick={() => setSkipped(t.text, true)}>
                Skip it
              </button>
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="topics" aria-label={title}>
      <div className="topics-k">
        <b>{title}</b>
        {topics.status === 'ok' && shown.length > 0 && <span>{summary}</span>}
      </div>
      {topics.status === 'reading' && <p className="topics-note">Loomer is reading the sheet…</p>}
      {topics.status === 'failed' && <p className="topics-note">Loomer couldn’t find topics on the sheet, but you can still ask for help.</p>}
      {topics.status === 'ok' && topics.items.length === 0 && <p className="topics-note">No topics found on the sheet.</p>}
      {topics.status === 'ok' &&
        (grouped
          ? groups.map((g) => (
              <div className="topic-group" key={g ?? 'other'}>
                <p className="topic-group-k">{g ?? 'Other topics'}</p>
                {shown.filter((t) => t.sheet === g).map(row)}
              </div>
            ))
          : shown.map(row))}
      {skipped.map((t) => (
        <p className="tskipped" key={`skipped:${t.text}`}>
          <Icon name="eyeOff" size="xs" />
          <span className="grow">Skipped: {t.text}</span>
          <button type="button" className="link" disabled={skip.busy} onClick={() => setSkipped(t.text, false)}>
            Undo
          </button>
        </p>
      ))}
      {(help.error ?? skip.error) && <p className="status-line error">{help.error ?? skip.error}</p>}
    </section>
  );
}

/**
 * "Working in your own copy?" for practice and study: one quiet line that opens
 * the link step. Only for students who write answers in their own Doc; the
 * teacher's sheets are already read.
 */
function OwnCopy({ assignmentId, candidates, api }: { assignmentId: string; candidates: Extract<DocState, { status: 'not-linked' }>['candidates']; api: PanelApi }) {
  const [open, setOpen] = useState(false);
  if (open) return <LinkDocStep assignmentId={assignmentId} candidates={candidates} api={api} purpose="copy" onSkip={() => setOpen(false)} />;
  return (
    <p className="ownline">
      <Icon name="link" size="sm" />
      <span className="grow">Working in your own copy?</span>
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Link it
      </button>
    </p>
  );
}

/**
 * A quiz or test in a work session: one calm note, no help box. Ask Loomer is
 * paused everywhere until the session ends. End session opens the end sheet.
 */
export function QuizNote({ onEnd }: { onEnd: () => void }) {
  return (
    <section className="state">
      <span className="subject lg gray">
        <Icon name="lock" />
      </span>
      <h2>Loomer doesn’t help during a quiz or test</h2>
      <p>Study for it before you start, and your plan still works.</p>
      <p className="paused-line">
        <Icon name="pauseCircle" size="sm" />
        Ask Loomer is paused while this is open.
      </p>
      <button type="button" className="btn sm" onClick={onEnd}>
        End session
      </button>
    </section>
  );
}

export function WorkHeader({ session, now, tab, onTab, hintWaiting, detail, onChecklist, api }: WorkHeaderProps) {
  const item = session.assignment;
  const topicHelp = useTopicHelp(item.assignmentId, api.send);
  const kind = typeLabel(item);
  const writing = !item.quiz && item.workType.type === 'writing';
  return (
    <>
      <h1 className="w-title">{item.title}</h1>
      <p className="w-meta">
        <span className="wtype">
          <Icon name={kind.icon} size="xs" />
          {kind.word}
        </span>
        {' · '}
        {session.status === 'paused' ? (
          'Paused. Loomer isn’t reading your Doc or saving pages.'
        ) : writing ? (
          <WorkNumbers session={session} detail={detail} now={now} onSources={() => onTab('sources')} onChecklist={onChecklist} />
        ) : (
          (item.courseName ?? 'No class')
        )}
      </p>
      {item.quiz ? null : (
        <>
          {session.focus && <FocusBlock focus={session.focus} sessionId={session.sessionId} handled={session.handledHints} now={now} />}
          {(item.workType.type === 'practice' || item.workType.type === 'study') && (
            <>
              <SheetList sheets={session.teacherSheets} label="From the instructions" requestOrigins={api.requestOrigins} send={api.send} />
              {session.topics?.next && <NextTopic next={session.topics.next} session={session} now={now} help={topicHelp} />}
              {session.topics && <TopicsList topics={session.topics} item={item} help={topicHelp} send={api.send} />}
              {session.doc.status === 'not-linked' && <OwnCopy assignmentId={item.assignmentId} candidates={session.doc.candidates} api={api} />}
            </>
          )}
          <WorkTabs session={session} tab={tab} onTab={onTab} hintWaiting={hintWaiting} />
        </>
      )}
    </>
  );
}

function WorkTabs({ session, tab, onTab, hintWaiting }: { session: ActiveSession; tab: WorkTab; onTab: (t: WorkTab) => void; hintWaiting: boolean }) {
  return (
    <div className="seg" role="tablist" aria-label="Working">
      <button type="button" role="tab" aria-selected={tab === 'help'} onClick={() => onTab('help')}>
        Help
        {hintWaiting && tab !== 'help' && <span className="dot" aria-label="1 hint ready" />}
      </button>
      <button type="button" role="tab" aria-selected={tab === 'sources'} onClick={() => onTab('sources')}>
        Sources <span className="n">{session.sources.length}</span>
      </button>
    </div>
  );
}

/**
 * The session's one direction, picked near the start of a writing session, as
 * a few words. The info button opens why, and the hints that look handled.
 */
function FocusBlock({ focus, sessionId, handled, now }: { focus: NonNullable<ActiveSession['focus']>; sessionId: number; handled: ActiveSession['handledHints']; now: Date }) {
  const [open, setOpen] = useState(false);
  return (
    <AiBlock
      className="focus-block"
      label="Your focus"
      flashKey={`focus:${sessionId}:${focus.text}`}
      right={
        <button type="button" className="icon-btn focus-why" aria-label="Why this focus" title="Why this focus" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name="info" size="sm" />
        </button>
      }
    >
      <p className="focus-text">{focus.text}</p>
      {open && (
        <>
          <p className="ai-sub">{focus.why}</p>
          <HandledHints hints={handled} now={now} />
        </>
      )}
    </AiBlock>
  );
}

/**
 * The draft's numbers inside the line under the title: the student's words
 * (when the draft was read; when it was read is the tooltip), saved sources
 * ("2 of 3" when the teacher asks for a number), and what's open on the
 * checklist from the last draft check. Sources and the checklist open where
 * they live. Before the draft is read, the draft's state says why.
 */
function WorkNumbers({ session, detail, now, onSources, onChecklist }: { session: ActiveSession; detail: AssignmentDetailModel | undefined; now: Date; onSources: () => void; onChecklist: () => void }) {
  const need = session.sourceNeed;
  const saved = session.sources.length;
  const doc = session.doc;
  const words = doc.status === 'linked' && doc.readState === 'ok' && doc.studentWords !== null ? doc.studentWords : null;
  return (
    <>
      {words !== null && doc.status === 'linked' ? <span title={doc.lastReadAt ? `Draft read ${observedAt(doc.lastReadAt, now)}` : undefined}>{words} words</span> : draftLine(doc, now)}
      {' · '}
      <button type="button" className="wnum" onClick={onSources} title={need ? `“${need.quote}”` : undefined}>
        {need ? `${saved} of ${need.required} sources` : saved === 1 ? '1 source' : `${saved} sources`}
      </button>
      {' · '}
      <button type="button" className="wnum wopen" onClick={onChecklist}>
        <ChecklistCount requirements={detail?.status === 'ok' && detail.check ? detail.requirements : null} />
      </button>
    </>
  );
}

/** The checklist in a few words: how many to fix, to check, or all found. Before any check, just "Checklist". */
function ChecklistCount({ requirements }: { requirements: RequirementItem[] | null }) {
  const review = requirements?.filter((r) => r.state === 'needs-review').length ?? 0;
  const unknown = requirements?.filter((r) => r.state === 'unknown').length ?? 0;
  if (requirements && review + unknown === 0) return <span className="ok">All found</span>;
  return <span className={review > 0 ? 'fix' : undefined}>{!requirements ? 'Checklist' : review > 0 ? `${review} to fix` : `${unknown} to check`}</span>;
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
  // The requirement it serves and the line from the draft open from "Show the line".
  const [lineOpen, setLineOpen] = useState(false);
  const hasLine = Boolean(hint.reference || hint.requirement);

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
    <div className={leaving ? 'hint leaving' : 'hint'} aria-hidden={leaving || undefined}>
      <AiBlock
        label="Hint"
        flashKey={`hint:${hint.id}`}
        right={
          <button type="button" className="link muted" onClick={onHide}>
            Hide
          </button>
        }
      >
        <p className="hint-text">{hint.text}</p>
        {lineOpen && (
          <>
            {hint.requirement && <p className="hint-for">For: {hint.requirement}</p>}
            {hint.reference && (
              <p className="reference">
                <mark>“{hint.reference.quote}”</mark> <span className="from">{hint.reference.from}</span>
              </p>
            )}
          </>
        )}
        <p className="hint-links">
          {hasLine && (
            <button type="button" className="link" aria-expanded={lineOpen} onClick={() => setLineOpen((o) => !o)}>
              {lineOpen ? 'Hide the line' : 'Show the line'}
            </button>
          )}
          <button type="button" className="link" onClick={onMoreHelp}>
            More help
          </button>
        </p>
      </AiBlock>
    </div>
  );
}

/** Hints whose passage the student fixed, newest first: a quiet "Looks handled" under the current hint. */
export function HandledHints({ hints, now }: { hints: ActiveSession['handledHints']; now: Date }) {
  if (hints.length === 0) return null;
  return (
    <ul className="handled" aria-label="Hints that look handled">
      {hints.map((h) => (
        <li key={h.id}>
          <Icon name="check" size="xs" />
          <span className="grow">
            <b>Looks handled</b> · {h.text}
          </span>
          <span className="when">{observedAt(h.at, now)}</span>
        </li>
      ))}
    </ul>
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
            : { ok: false as const, error: 'Chrome didn’t allow this site, so nothing was saved.' },
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

/**
 * Asks once which Doc to link. One click per candidate, or paste a link; never
 * links on its own. `draft`: the student's own draft (writing, required for
 * draft help). `copy`: the student's own copy of practice or study work,
 * optional, so it offers Not now and never counts words. Docs from the
 * instructions show by the teacher's link text, not their address.
 */
export function LinkDocStep({
  n,
  assignmentId,
  candidates,
  api,
  purpose = 'draft',
  onSkip,
}: {
  n?: number;
  assignmentId: string;
  candidates: Extract<DocState, { status: 'not-linked' }>['candidates'];
  api: PanelApi;
  purpose?: 'draft' | 'copy';
  onSkip?: () => void;
}) {
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
            : { ok: false as const, error: `Chrome didn’t allow access to Google Docs. Your ${purpose} isn’t linked.` },
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
    <section className="step" aria-label={purpose === 'copy' ? 'Link your copy' : 'Link your draft'}>
      <span className="num">{n ?? <Icon name="doc" size="xs" />}</span>
      <div className="grow">
        <div className="step-t">{purpose === 'copy' ? 'Working in your own copy? Paste its link.' : 'Which Doc is your draft?'}</div>
        <div className="step-s">
          {purpose === 'copy'
            ? 'Only link one if you write your answers in your own Doc.'
            : candidates.length > 0
              ? 'Loomer found these in the instructions, so pick yours.'
              : 'Paste the link to your Google Doc.'}
        </div>
        {candidates.length > 0 && purpose === 'copy' && <p className="pick-k">From the instructions</p>}
        {candidates.map((c) => (
          <div className="pick" key={c.docId}>
            <Icon name="doc" />
            <span className="grow">
              <span className="row-title">{c.label ?? 'Google Doc'}</span>
              <span className="row-sub ellipsis">{c.label ? 'Google Doc from the instructions' : c.url.replace('https://', '')}</span>
            </span>
            <button type="button" className="btn sm accent" disabled={action.busy} aria-busy={linking === c.url} onClick={() => link(c.url)}>
              {linking === c.url ? 'Linking…' : purpose === 'copy' ? 'Link' : 'Use this'}
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
        {onSkip && (
          <button type="button" className="link muted" style={{ marginTop: 8 }} onClick={onSkip}>
            Not now
          </button>
        )}
        {action.error && <p className="status-line error" style={{ marginTop: 6 }}>{action.error}</p>}
      </div>
    </section>
  );
}

export type SessionVerb = 'pause' | 'resume' | 'end';

/** The message for each session verb. */
export function verbMessage(verb: SessionVerb) {
  return { type: verb === 'end' ? 'session:end' : verb === 'pause' ? 'session:pause' : 'session:resume' } as const;
}

/**
 * Pause or Resume, and End, one tap each, in the Working top bar and on Home's
 * session strip. End opens the end sheet rather than ending right away. `run`
 * is the panel's action runner, so errors show at the top of the screen.
 */
export function SessionControls({ session, run, busy }: { session: ActiveSession; run: (verb: SessionVerb) => void; busy: boolean }) {
  const paused = session.status === 'paused';
  return (
    <>
      <button
        type="button"
        className={paused ? 'pp go' : 'pp'}
        aria-label={paused ? 'Resume session' : 'Pause session'}
        title={paused ? 'Resume' : 'Pause'}
        disabled={busy}
        onClick={() => run(paused ? 'resume' : 'pause')}
      >
        <Icon name={paused ? 'play' : 'pause'} size="sm" />
      </button>
      <button type="button" className="end-btn" disabled={busy} onClick={() => run('end')}>
        End
      </button>
    </>
  );
}

/**
 * Home's session strip: "Working", "Paused", or the countdown, the assignment,
 * Pause or Resume, and End. Tapping the strip opens the session.
 */
export function SessionStrip({
  session,
  now,
  hintWaiting,
  onOpen,
  run,
  busy,
}: {
  session: ActiveSession;
  now: Date;
  hintWaiting: boolean;
  onOpen: () => void;
  run: (verb: SessionVerb) => void;
  busy: boolean;
}) {
  const clock = sessionClock(session, now);
  return (
    <div className="sstrip">
      <button type="button" className="ss-open" onClick={onOpen}>
        <span className={clock.paused ? 'dot' : 'dot green'} />
        <b className={clock.warn ? 'warn' : undefined}>{clock.text}</b>
        <span className="ss-n">{session.assignment.title}</span>
        {hintWaiting && <span className="ss-hint">1 hint</span>}
      </button>
      <SessionControls session={session} run={run} busy={busy} />
      <button type="button" className="icon-btn" aria-label="Open the session" onClick={onOpen}>
        <Icon name="chevronRight" size="sm" />
      </button>
    </div>
  );
}

/**
 * The Sources tab: the draft or sheet, saved pages (with how many the teacher
 * asks for, and whether the draft mentions each one), and what happened this session.
 */
export function SourcesBody({ session, now, api }: { session: ActiveSession; now: Date; api: PanelApi }) {
  const kind = docKind(session);
  // Reading has no Doc to link; show one only if it is already linked.
  const showDoc = session.assignment.workType.type !== 'reading' || session.doc.status === 'linked';
  return (
    <>
      {showDoc && (
        <>
          <div className="sec">
            <h2>{kind === 'copy' ? 'Your copy' : 'Your draft'}</h2>
          </div>
          {session.doc.status === 'linked' ? (
            <LinkedDoc doc={session.doc} now={now} api={api} kind={kind} />
          ) : (
            <LinkDocStep assignmentId={session.assignment.assignmentId} candidates={session.doc.candidates} api={api} purpose={kind} />
          )}
        </>
      )}

      <div className="sec">
        <h2>Sources</h2>
        <span className="aside">
          {session.sourceNeed ? `${session.sources.length} of ${session.sourceNeed.required}` : session.sources.length === 0 ? 'None yet' : session.sources.length}
        </span>
      </div>
      {session.sourceNeed && (
        <p className="src-need">
          “{session.sourceNeed.quote}” <span>From your teacher</span>
        </p>
      )}
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

      <div className="row-actions pad" style={{ padding: '16px 18px 18px' }}>
        <DeleteAssignmentData assignmentId={session.assignment.assignmentId} send={api.send} />
      </div>
    </>
  );
}

function LinkedDoc({ doc, now, api, kind }: { doc: Extract<DocState, { status: 'linked' }>; now: Date; api: PanelApi; kind: DocKind }) {
  const trouble = doc.readState === 'no-access' || doc.readState === 'unreadable' || doc.readState === 'rate-limited';
  return (
    <>
      <div className="row-line">
        <Icon name="doc" />
        <span className="grow">
          <span className="row-title">Google Doc</span>
          <span className={trouble ? 'row-sub danger-text' : 'row-sub'}>{draftLine(doc, now, kind)}</span>
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
          {source.inDraft && <InDraft {...source.inDraft} />}
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

/** Whether the linked draft mentions a source, with the words that matched. A quiet fact, not a warning. */
function InDraft({ used, matched }: NonNullable<SourceItem['inDraft']>) {
  if (!used) return <span className="row-sub">Not in your draft yet</span>;
  return (
    <span className="row-sub in-draft">
      <b>
        <Icon name="check" size="xs" />
        In your draft
      </b>
      {matched.length > 0 && ` · mentions ${matched.map((w) => `“${w}”`).join(', ')}`}
    </span>
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
