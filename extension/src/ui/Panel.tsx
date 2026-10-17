// The side panel shell: header, Home/Chat/Sources tabs, and routing. Takes the
// Home and Session models from outside (live hooks or fixtures) and acts only
// through PanelApi, so it renders the same in both modes.
import { useState } from 'react';
import type { HomeModel, WorkItem } from '../model/home';
import type { SessionModel } from '../model/session';
import { useAction, type PanelApi } from './api';
import { ChatView } from './chat';
import {
  AssignmentDetail,
  CannotCompareView,
  CheckingView,
  EmptyView,
  type HomeActions,
  NotConnectedView,
  ReadyView,
} from './home';
import { Icon, type IconName } from './Icon';
import { LogoMark, Wordmark } from './Logo';
import { Card, CheckBar } from './parts';
import { ResumeCard } from './resume';
import { useLingering } from './useLingering';
import { ActivityCard, DocCard, HintCard, SessionCard, SourcesCard, type ActiveSession } from './session';

type Tab = 'home' | 'chat' | 'sources';

const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'sources', label: 'Sources', icon: 'sources' },
];

export type PanelProps = {
  home: HomeModel | undefined;
  session: SessionModel | undefined;
  now: Date;
  api: PanelApi;
  /** Absent in fixture previews. */
  onRefresh?: () => Promise<void>;
  /** Shown above the content when the models are fixtures, never for live data. */
  previewLabel?: string;
};

export function Panel({ home, session, now, api, onRefresh, previewLabel }: PanelProps) {
  const [tab, setTab] = useState<Tab>('home');
  const [openId, setOpenId] = useState<string | null>(null);
  const [hiddenHintId, setHiddenHintId] = useState<number | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [hidingId, setHidingId] = useState<string | null>(null);
  const start = useAction();

  const active: ActiveSession | null = session && session.status !== 'none' ? session : null;
  const hint = active?.hint ?? null;
  // Keep a vanished hint briefly so it fades out instead of disappearing.
  const shownHint = useLingering(hint, 200);

  const refresh = onRefresh
    ? () => {
        setRefreshing(true);
        void onRefresh().finally(() => setRefreshing(false));
      }
    : undefined;

  const actions: HomeActions = {
    openSettings: api.openSettings,
    openItem: setOpenId,
    startSession: (assignmentId) => {
      setStartingId(assignmentId);
      start.run(async () => {
        try {
          const reply = await api.send({ type: 'session:start', assignmentId });
          if (reply.ok) {
            setOpenId(null);
            setTab('sources');
          }
          return reply;
        } finally {
          setStartingId(null);
        }
      });
    },
    continueSession: () => {
      setOpenId(null);
      setTab('sources');
    },
    sessionAssignmentId: active?.assignment.assignmentId ?? null,
    startingId,
    hidingId,
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

  return (
    <div className="panel">
      <header className="panel-head">
        <LogoMark size={32} />
        <Wordmark />
        <span className="grow" />
        {active && (
          <span className={active.status === 'paused' ? 'state-pill paused' : 'state-pill'}>
            {active.status === 'paused' ? 'Paused' : 'Session'}
          </span>
        )}
        <button type="button" className="icon-btn" onClick={api.openSettings} aria-label="Settings">
          <Icon name="settings" />
        </button>
      </header>
      <nav className="tabs" role="tablist" aria-label="Loomer">
        {tabs.map((t) => {
          // Quiet indicator: a waiting hint marks the Sources tab when another tab is open.
          const marked = t.id === 'sources' && hint !== null && tab !== 'sources';
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t.id}
              aria-label={marked ? `${t.label}, 1 hint ready` : undefined}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} />
              {t.label}
              {marked && <span className="tab-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </nav>
      {previewLabel && (
        <p className="preview-banner" role="note">
          {previewLabel}
        </p>
      )}
      <main className="panel-body" role="tabpanel" key={`${tab}:${openId ?? ''}`}>
        {start.error && (
          <p className="status-line error" role="status">
            {start.error}
          </p>
        )}
        {tab === 'chat' ? (
          active ? (
            <ChatView session={active} api={api} draft={chatDraft} setDraft={setChatDraft} />
          ) : (
            <NoSession text="Start a session from Home to ask for help with an assignment." onHome={() => setTab('home')} />
          )
        ) : tab === 'sources' ? (
          active ? (
            <>
              {shownHint.value && (
                <HintCard
                  key={shownHint.value.id}
                  hint={shownHint.value}
                  leaving={shownHint.leaving}
                  hidden={hiddenHintId === shownHint.value.id}
                  onHide={() => setHiddenHintId(shownHint.value?.id ?? null)}
                  onShow={() => setHiddenHintId(null)}
                  onMoreHelp={() => {
                    setChatDraft('Can you help me more with this hint?');
                    setTab('chat');
                  }}
                  api={api}
                />
              )}
              <SessionCard session={active} now={now} api={api} />
              <DocCard session={active} now={now} api={api} />
              <SourcesCard sources={active.sources} now={now} api={api} />
              <ActivityCard session={active} now={now} />
            </>
          ) : (
            <NoSession
              text="Start a session from Home. Your draft and the pages you save show up here."
              onHome={() => setTab('home')}
            />
          )
        ) : !home ? (
          <p className="caption">Loading</p>
        ) : openItem ? (
          <AssignmentDetail item={openItem} now={now} onBack={() => setOpenId(null)} actions={actions} />
        ) : (
          <>
            {active && (
              <button type="button" className="session-strip" onClick={actions.continueSession}>
                <span className={active.status === 'paused' ? 'tile amber' : 'tile green'}>
                  <Icon name={active.status === 'paused' ? 'pause' : 'doc'} size="sm" />
                </span>
                <span className="row-body">
                  <span className="row-sub">{active.status === 'paused' ? 'Paused session' : 'Current session'}</span>
                  <span className="row-title">{active.assignment.title}</span>
                </span>
                <Icon name="chevronRight" size="sm" />
              </button>
            )}
            {home.status !== 'not-connected' && home.resume && (
              <>
                <p className="hello">Welcome back</p>
                <ResumeCard resume={home.resume} now={now} api={api} actions={actions} />
              </>
            )}
            <HomeView model={home} now={now} actions={actions} />
            {home.status !== 'not-connected' && (
              <CheckBar lastCheck={home.lastCheck} now={now} onRefresh={refresh} refreshing={refreshing} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function HomeView({ model, now, actions }: { model: HomeModel; now: Date; actions: HomeActions }) {
  switch (model.status) {
    case 'not-connected':
      return <NotConnectedView actions={actions} />;
    case 'checking':
      return <CheckingView model={model} now={now} actions={actions} />;
    case 'cannot-compare':
      return <CannotCompareView model={model} now={now} actions={actions} />;
    case 'ready':
      return <ReadyView model={model} now={now} actions={actions} />;
    case 'empty':
      return <EmptyView model={model} now={now} actions={actions} />;
  }
}

function findItem(model: HomeModel, id: string): WorkItem | null {
  if (model.status === 'not-connected') return null;
  const items = model.status === 'ready' ? [model.next.item, ...model.rest] : model.rest;
  return items.find((i) => i.assignmentId === id) ?? null;
}

function NoSession({ text, onHome }: { text: string; onHome: () => void }) {
  return (
    <Card>
      <p className="card-title">No session yet</p>
      <p className="lede" style={{ marginTop: 4 }}>
        {text}
      </p>
      <button type="button" className="btn sm" style={{ marginTop: 12 }} onClick={onHome}>
        Go to Home
      </button>
    </Card>
  );
}
