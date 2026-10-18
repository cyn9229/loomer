// The side panel shell: a violet band (logo, tabs or Back, and the screen's
// main message) over a white sheet. Takes the models from outside (live hooks
// or fixtures) and acts only through PanelApi, so it renders the same in both
// modes. Screens: Home, assignment detail, Chat, Sources, and the screenshot
// crop, which takes over while a capture is waiting.
import { useState, type ReactNode } from 'react';
import type { ScreenshotDraft } from '../capture/screenshot';
import type { AssignmentDetailModel } from '../model/detail';
import type { HomeModel, WorkItem } from '../model/home';
import type { SessionModel } from '../model/session';
import { useAction, type PanelApi } from './api';
import { ChatView } from './chat';
import { DetailBody, DetailHero } from './detail';
import { type HomeActions, HomeBody, HomeHero } from './home';
import { Icon, type IconName } from './Icon';
import { LogoMark, Wordmark } from './Logo';
import { SyncFoot } from './parts';
import { ResumeCard } from './resume';
import { ScreenshotBody, ScreenshotHero } from './screenshot';
import { HintCard, SessionHero, sessionPill, SourcesBody, SuggestionRow, type ActiveSession } from './session';
import { useLingering } from './useLingering';

type Tab = 'home' | 'chat' | 'sources';

const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'sources', label: 'Sources', icon: 'sources' },
];

export type PanelProps = {
  home: HomeModel | undefined;
  session: SessionModel | undefined;
  /** Loads the detail model for the open assignment (a hook in the live panel). */
  useDetail: (assignmentId: string | null) => AssignmentDetailModel | undefined;
  /** A screenshot waiting to be cropped and saved, held in memory only. */
  screenshot: ScreenshotDraft | undefined;
  now: Date;
  api: PanelApi;
  /** Absent in fixture previews. */
  onRefresh?: () => Promise<void>;
  /** Shown above the content when the models are fixtures, never for live data. */
  previewLabel?: string;
  /** Loomer is paused in settings (privacy:pause). */
  paused: boolean;
};

export function Panel({ home, session, useDetail, screenshot, now, api, onRefresh, previewLabel, paused }: PanelProps) {
  const [tab, setTab] = useState<Tab>('home');
  const [openId, setOpenId] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [hiddenHintId, setHiddenHintId] = useState<number | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [hidingId, setHidingId] = useState<string | null>(null);
  const start = useAction();
  const detail = useDetail(openId);

  const active: ActiveSession | null = session && session.status !== 'none' ? session : null;
  const hint = active?.hint ?? null;
  // Keep a vanished hint briefly so it fades out instead of disappearing.
  const shownHint = useLingering(hint, 200);
  const shownSuggestion = useLingering(active?.suggestion ?? null, 200);

  const refresh = onRefresh
    ? () => {
        setRefreshing(true);
        void onRefresh().finally(() => setRefreshing(false));
      }
    : undefined;

  const goTab = (t: Tab) => {
    setOpenId(null);
    setTab(t);
  };

  const actions: HomeActions = {
    openSettings: api.openSettings,
    openItem: setOpenId,
    startSession: (assignmentId) => {
      setStartingId(assignmentId);
      start.run(async () => {
        try {
          const reply = await api.send({ type: 'session:start', assignmentId });
          if (reply.ok) goTab('chat');
          return reply;
        } finally {
          setStartingId(null);
        }
      });
    },
    continueSession: () => goTab('chat'),
    sessionAssignmentId: active?.assignment.assignmentId ?? null,
    startingId,
    hidingId,
    send: api.send,
    setHidden: (assignmentId, hidden) => {
      setHidingId(assignmentId);
      start.run(async () => {
        try {
          const reply = await api.send({ type: 'item:hide', assignmentId, hidden });
          if (reply.ok && hidden) setOpenId(null);
          return reply;
        } finally {
          setHidingId(null);
        }
      });
    },
  };

  const openItem = home && openId ? findItem(home, openId) : null;
  const nextId = home?.status === 'ready' ? home.next.item.assignmentId : null;
  // Replay data is labeled once, in the header, instead of on every row.
  const replay = Boolean(home && home.status !== 'not-connected' && (home.lastCheck?.replay || allItems(home).some((i) => i.replay)));
  const pill = paused ? { text: 'Loomer paused', paused: true } : active ? sessionPill(active, now) : null;

  // Each screen is a band message (hero) plus the sheet's content (body).
  let nav: ReactNode = <Tabs tab={tab} hintWaiting={hint !== null} onTab={goTab} />;
  let hero: ReactNode = null;
  let body: ReactNode;

  if (screenshot) {
    nav = null;
    hero = <ScreenshotHero />;
    body = <ScreenshotBody draft={screenshot} now={now} api={api} />;
  } else if (tab === 'home' && openItem) {
    nav = null;
    hero = <DetailHero item={openItem} now={now} onBack={() => setOpenId(null)} />;
    body = <DetailBody item={openItem} detail={detail} now={now} actions={actions} />;
  } else if (tab === 'home') {
    hero = home ? (
      <HomeHero model={home} resume={home.status === 'not-connected' ? null : home.resume} now={now} actions={actions} whyOpen={whyOpen} onWhy={() => setWhyOpen((o) => !o)} />
    ) : null;
    body = !home ? (
      <p className="caption">Loading…</p>
    ) : home.status === 'not-connected' ? (
      <p className="mini">
        <Icon name="lock" />
        Loomer only reads. It never turns anything in or changes Canvas.
      </p>
    ) : (
      <>
        {active ? (
          // The hero already says "Keep going" when the session is for the next step.
          active.assignment.assignmentId !== nextId && (
          <button type="button" className="keep" onClick={actions.continueSession}>
            <span className="keep-icon">
              <Icon name={active.status === 'paused' ? 'pause' : 'doc'} />
            </span>
            <span className="grow">
              <span className="keep-k">
                {active.status === 'paused' ? 'Paused session' : 'Working on'}
              </span>
              <span className="keep-t">
                {active.assignment.title}
              </span>
            </span>
            <span className="go">
              <Icon name="arrowRight" />
            </span>
          </button>
          )
        ) : (
          home.resume && home.resume.assignment.assignmentId !== nextId && <ResumeCard resume={home.resume} now={now} api={api} actions={actions} />
        )}
        <HomeBody model={home} now={now} actions={actions} whyOpen={whyOpen} />
        <SyncFoot lastCheck={home.lastCheck} now={now} onRefresh={refresh} refreshing={refreshing} />
      </>
    );
  } else if (!active) {
    hero = <h1 className="hero-title md">No session yet</h1>;
    body = (
      <div className="block">
        <p className="block-text" style={{ marginTop: 0 }}>
          {tab === 'chat' ? 'Start a session from Home to get hints on an assignment.' : 'Start a session from Home. Your draft and saved pages show up here.'}
        </p>
        <div className="block-act">
          <button type="button" className="btn sm on-tint" onClick={() => goTab('home')}>
            Go to Home
          </button>
        </div>
      </div>
    );
  } else if (tab === 'chat') {
    hero = <SessionHero session={active} now={now} />;
    body = (
      <ChatView
        session={active}
        api={api}
        draft={chatDraft}
        setDraft={setChatDraft}
        hint={
          shownHint.value && (
            <HintCard
              key={shownHint.value.id}
              hint={shownHint.value}
              leaving={shownHint.leaving}
              hidden={hiddenHintId === shownHint.value.id}
              onHide={() => setHiddenHintId(shownHint.value?.id ?? null)}
              onShow={() => setHiddenHintId(null)}
              onMoreHelp={() => setChatDraft('Can you help me more with this hint?')}
              api={api}
            />
          )
        }
        suggestion={
          shownSuggestion.value && (
            <SuggestionRow key={shownSuggestion.value.tabId} suggestion={shownSuggestion.value} leaving={shownSuggestion.leaving} api={api} />
          )
        }
      />
    );
  } else {
    hero = <SessionHero session={active} now={now} />;
    body = <SourcesBody session={active} now={now} api={api} />;
  }

  return (
    <div className="panel">
      {previewLabel && (
        <p className="preview-banner" role="note">
          {previewLabel}
        </p>
      )}
      <header className="band">
        <div className="band-top">
          <LogoMark size={22} light />
          {/* Narrow panels can't fit the wordmark next to two pills; the mark alone is enough. */}
          {!(replay && pill) && <Wordmark />}
          <span className="grow" />
          {replay && <span className="band-pill">Replay data</span>}
          {pill && <span className={pill.paused ? 'live-pill paused' : 'live-pill'}>{pill.text}</span>}
          <button type="button" className="band-btn" onClick={api.openSettings} aria-label="Settings">
            <Icon name="settings" size="sm" />
          </button>
        </div>
        {nav}
        {hero}
      </header>
      <main className="sheet" key={screenshot ? 'shot' : `${tab}:${openId ?? ''}`}>
        {paused && <PausedStrip api={api} />}
        {start.error && (
          <p className="status-line error" role="status">
            {start.error}
          </p>
        )}
        {body}
      </main>
    </div>
  );
}

function Tabs({ tab, hintWaiting, onTab }: { tab: Tab; hintWaiting: boolean; onTab: (t: Tab) => void }) {
  return (
    <nav className="tabs" role="tablist" aria-label="Loomer">
      {tabs.map((t) => {
        // Quiet indicator: a waiting hint marks the Chat tab when another tab is open.
        const marked = t.id === 'chat' && hintWaiting && tab !== 'chat';
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t.id}
            aria-label={marked ? `${t.label}, 1 hint ready` : undefined}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.icon} />
            {t.label}
            {marked && <span className="tab-dot" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}

function allItems(model: HomeModel): WorkItem[] {
  if (model.status === 'not-connected') return [];
  const older = model.olderReview?.items.map((i) => i.item) ?? [];
  return [...(model.status === 'ready' ? [model.next.item] : []), ...model.rest, ...older];
}

function findItem(model: HomeModel, id: string): WorkItem | null {
  return allItems(model).find((i) => i.assignmentId === id) ?? null;
}

/** Loomer is paused: say what stops, and offer to resume. Resuming does not resume a session. */
function PausedStrip({ api }: { api: PanelApi }) {
  const resume = useAction();
  return (
    <div className="block amber" role="status">
      <div className="block-k">
        <Icon name="pause" />
        Loomer is paused
      </div>
      <p className="block-text">It isn’t syncing Canvas, reading your Doc, or saving pages.</p>
      <div className="block-act">
        <button
          type="button"
          className="btn sm on-tint"
          disabled={resume.busy}
          aria-busy={resume.busy}
          onClick={() => resume.run(() => api.send({ type: 'privacy:pause', paused: false }))}
        >
          {resume.busy ? 'Turning back on…' : 'Turn Loomer back on'}
        </button>
      </div>
      {resume.error && <p className="status-line error">{resume.error}</p>}
    </div>
  );
}
