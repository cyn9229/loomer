// The side panel shell: header, Home/Chat/Sources tabs, and the Home router.
// Takes a HomeModel from outside (live hook or fixture) so it renders the same
// either way. `onRefresh` is absent in fixture previews.
import { useState } from 'react';
import type { HomeModel, WorkItem } from '../model/home';
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

type Tab = 'home' | 'chat' | 'sources';

const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'sources', label: 'Sources', icon: 'sources' },
];

export type PanelProps = {
  model: HomeModel | undefined;
  now: Date;
  openSettings: () => void;
  onRefresh?: () => Promise<void>;
  /** Shown above the content when the model is a fixture, never for live data. */
  previewLabel?: string;
};

export function Panel({ model, now, openSettings, onRefresh, previewLabel }: PanelProps) {
  const [tab, setTab] = useState<Tab>('home');
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = onRefresh
    ? () => {
        setRefreshing(true);
        void onRefresh().finally(() => setRefreshing(false));
      }
    : undefined;

  const actions: HomeActions = { openSettings, openItem: setOpenId };
  const openItem = model && openId ? findItem(model, openId) : null;

  return (
    <div className="panel">
      <header className="panel-head">
        <LogoMark size={32} />
        <Wordmark />
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={openSettings} aria-label="Settings">
          <Icon name="settings" />
        </button>
      </header>
      <nav className="tabs" role="tablist" aria-label="Loomer">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
      {previewLabel && (
        <p className="preview-banner" role="note">
          {previewLabel}
        </p>
      )}
      <main className="panel-body" role="tabpanel">
        {tab !== 'home' ? (
          <NotYet name={tab === 'chat' ? 'Chat' : 'Sources'} />
        ) : !model ? (
          <p className="caption">Loading</p>
        ) : openItem ? (
          <AssignmentDetail item={openItem} now={now} onBack={() => setOpenId(null)} />
        ) : (
          <>
            <HomeView model={model} now={now} actions={actions} />
            {model.status !== 'not-connected' && (
              <CheckBar lastCheck={model.lastCheck} now={now} onRefresh={refresh} refreshing={refreshing} />
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

function NotYet({ name }: { name: string }) {
  return (
    <Card>
      <p className="card-title">{name} is not built yet</p>
      <p className="lede" style={{ marginTop: 4 }}>
        It arrives with work sessions.
      </p>
    </Card>
  );
}
