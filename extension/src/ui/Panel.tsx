// The side panel shell. No tabs: Home is the start, starting work opens the
// Working screen (Help | Sources), tapping an assignment opens its detail, the
// Ask bar opens Ask Loomer, and a waiting screenshot takes over until it is
// saved or discarded. Each screen has a slim top bar. Takes the models from outside (live hooks or fixtures) and
// acts only through PanelApi, so it renders the same in both modes.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenshotDraft } from '../capture/screenshot';
import { GENERAL_THREAD, type AddDraft, type ChatModel } from '../model/chat';
import { DOCS_ORIGINS } from '../core/messages';
import type { AssignmentDetailModel, EditableFields } from '../model/detail';
import type { HomeModel, WorkItem } from '../model/home';
import type { SessionModel, WorkNudge } from '../model/session';
import { useAction, type PanelApi } from './api';
import { AddSheet } from './addAssignment';
import { AskView, SetAsideSheet, shortTitle, ThreadMenu } from './ask';
import { ChatView } from './chat';
import { DetailView } from './detail';
import { EndSheet } from './endSheet';
import { type HomeActions, HomeView } from './home';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { NudgeLine, usePresence } from './nudge';
import type { PlanMode } from './planView';
import { ScreenshotView } from './screenshot';
import { HandledHints, HintCard, QuizNote, SessionControls, sessionClock, SessionTime, SourcesBody, SuggestionRow, verbMessage, WorkHeader, type ActiveSession, type WorkTab } from './session';
import { useLingering } from './useLingering';

export type PanelProps = {
  home: HomeModel | undefined;
  session: SessionModel | undefined;
  /** Loads the detail model for the open assignment (a hook in the live panel). */
  useDetail: (assignmentId: string | null) => AssignmentDetailModel | undefined;
  /** Loads one Ask Loomer thread: "general" or an assignment id (a hook in the live panel). */
  useChat: (threadKey: string) => ChatModel | undefined;
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
  /** The local AI service's last health check; null when AI is off or not checked yet. */
  aiService: { up: boolean; checkedAt: string } | null | undefined;
  /** "Working on this?" from the worker (useNudge), or null. */
  nudge: WorkNudge;
  /** Nudges are on in settings; only then does the panel report which assignment it shows. */
  nudgesEnabled: boolean;
  /** The chat Ask Loomer last showed (askThreadItem); reason 'topic' when topic help opened it. Absent in previews. */
  lastThread?: LastThread | null;
};

type LastThread = { threadKey: string; at: string; reason: 'student' | 'topic' };
/** A line at the top of Ask Loomer about the chat in view. */
type ChatNotice = { kind: 'topic' | 'set-aside'; threadKey: string };

export function Panel({ home, session, useDetail, useChat, screenshot, now, api, onRefresh, previewLabel, paused, aiService, nudge, nudgesEnabled, lastThread }: PanelProps) {
  const [view, setView] = useState<'home' | 'work' | 'ask'>('home');
  const [askThread, setAskThread] = useState<string>(GENERAL_THREAD);
  const [chatNotice, setChatNotice] = useState<ChatNotice | null>(null);
  const [showSetAside, setShowSetAside] = useState(false);
  const [planMode, setPlanMode] = useState<PlanMode>('list');
  // After "Done for today", Home asks roughly how much is left (only when the item has a guess).
  const [askLeft, setAskLeft] = useState<WorkItem | null>(null);
  // End opens the end sheet over the Working screen; the session runs until the student picks.
  const [endOpen, setEndOpen] = useState(false);
  // After "I turned it in", Home says so once, with Undo.
  const [turnedIn, setTurnedIn] = useState<{ assignmentId: string; noun: string; mine: boolean } | null>(null);
  // The add/edit sheet for work that isn't on Canvas: a new one (with an optional prefill and Ask Loomer draft), or one to edit.
  const [addSheet, setAddSheet] = useState<{ editId: string | null; fields: EditableFields | null; draft?: Partial<EditableFields>; draftId?: string } | null>(null);
  const [workTab, setWorkTab] = useState<WorkTab>('help');
  const [openId, setOpenId] = useState<string | null>(null);
  const [hiddenHintId, setHiddenHintId] = useState<number | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [hidingId, setHidingId] = useState<string | null>(null);
  const start = useAction();

  const active: ActiveSession | null = session && session.status !== 'none' ? session : null;
  // One detail model at a time: the open assignment, or the session's own (for the stat strip).
  const detail = useDetail(openId ?? (view === 'work' ? (active?.assignment.assignmentId ?? null) : null));
  const chat = useChat(askThread);
  // The session's Help shows the same thread Ask Loomer shows for its assignment.
  const sessionChat = useChat(active?.assignment.assignmentId ?? GENERAL_THREAD);

  /** Shows a chat and remembers it (chat:open), so the panel reopens on it. */
  const openThread = (threadKey: string) => {
    setAskThread(threadKey);
    setChatNotice((n) => (n?.threadKey === threadKey ? n : null));
    void api.send({ type: 'chat:open', threadKey });
  };

  /** Opens the add sheet with an Ask Loomer card's draft, to change it before adding. */
  const editDraft = (draftId: string, draft: AddDraft) =>
    setAddSheet({ editId: null, fields: null, draft: { title: draft.title, courseKey: draft.courseKey, dueAt: draft.dueAt, workType: draft.workType }, draftId });

  // Topic help opens the assignment's chat from the worker (askThreadItem with reason 'topic'):
  // switch to it and say so. A stale 'topic' from before this panel opened is ignored.
  const mountedAt = useRef(Date.now());
  const seenTopic = useRef<string | null>(null);
  useEffect(() => {
    if (lastThread?.reason !== 'topic' || lastThread.at === seenTopic.current || Date.parse(lastThread.at) < mountedAt.current - 5000) return;
    seenTopic.current = lastThread.at;
    setOpenId(null);
    setAskThread(lastThread.threadKey);
    setView('ask');
    setChatNotice({ kind: 'topic', threadKey: lastThread.threadKey });
    // Back to 'student', so reopening the panel doesn't switch again.
    void api.send({ type: 'chat:open', threadKey: lastThread.threadKey });
  }, [lastThread, api]);
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

  const goWork = () => {
    setOpenId(null);
    setWorkTab('help');
    setView('work');
  };

  const actions: HomeActions = {
    openSettings: api.openSettings,
    openItem: setOpenId,
    startSession: (assignmentId, minutes) => {
      setStartingId(assignmentId);
      start.run(async () => {
        try {
          const reply = await api.send({ type: 'session:start', assignmentId, minutes });
          if (reply.ok) goWork();
          return reply;
        } finally {
          setStartingId(null);
        }
      });
    },
    continueSession: goWork,
    sessionVerb: (verb) => {
      // End asks where the assignment stands first, from Home's strip too.
      if (verb === 'end') {
        goWork();
        setEndOpen(true);
        return;
      }
      start.run(() => api.send(verbMessage(verb)));
    },
    requestOrigins: api.requestOrigins,
    sessionBusy: start.busy,
    openAsk: (threadKey) => {
      // Refresh the service status so a down service is said before the student types.
      void api.send({ type: 'ai:check' });
      setOpenId(null);
      // No thread named: the one the student used last, or General.
      openThread(threadKey ?? lastThread?.threadKey ?? GENERAL_THREAD);
      setView('ask');
    },
    addAssignment: () => setAddSheet({ editId: null, fields: null }),
    editAssignment: (assignmentId, fields) => setAddSheet({ editId: assignmentId, fields }),
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
  // The assignment on screen (its detail, or its Ask thread) feeds the viewing nudge.
  const viewingId = openId ?? (view === 'ask' && askThread !== GENERAL_THREAD ? askThread : null);
  usePresence(nudgesEnabled && !screenshot ? viewingId : null, api.send);
  const nudgeLine = nudge && !screenshot && (
    <NudgeLine
      nudge={nudge}
      here={viewingId === nudge.assignmentId}
      onStart={(id) => actions.startSession(id)}
      onResume={() =>
        start.run(async () => {
          const reply = await api.send({ type: 'session:resume' });
          if (reply.ok) goWork();
          return reply;
        })
      }
      send={api.send}
    />
  );
  // Replay data is labeled once, in the top bar, instead of on every row.
  const replay = Boolean(home && home.status !== 'not-connected' && (home.lastCheck?.replay || allItems(home).some((i) => i.replay)));
  const settings = (
    <button type="button" className="icon-btn" onClick={api.openSettings} aria-label="Settings">
      <Icon name="settings" size="sm" />
    </button>
  );
  const brand = (
    <>
      <Logo />
      <span className="grow" />
      {replay && <span className="tag">Replay data</span>}
    </>
  );

  let bar: ReactNode;
  let body: ReactNode;
  // Ask Loomer and the Working screen keep their top bar in reach while a long chat scrolls.
  const chatScreen = !screenshot && !openItem && (view === 'ask' || (view === 'work' && Boolean(active)));
  if (screenshot) {
    bar = (
      <>
        {brand}
        {settings}
      </>
    );
    body = <ScreenshotView draft={screenshot} now={now} api={api} />;
  } else if (openItem) {
    bar = (
      <>
        <button type="button" className="back" onClick={() => setOpenId(null)}>
          <Icon name="chevronLeft" />
          Back
        </button>
        <span className="grow" />
        {settings}
      </>
    );
    body = <DetailView item={openItem} detail={detail} now={now} actions={actions} nudge={nudgeLine} />;
  } else if (view === 'ask') {
    const threads = home ? askThreads(home) : [];
    // The thread switcher is the bar's title, between Home and settings.
    bar = (
      <>
        <button type="button" className="back" onClick={() => setView('home')}>
          <Icon name="chevronLeft" />
          Home
        </button>
        <ThreadMenu
          threadKey={askThread}
          threads={chat?.threads ?? []}
          now={now}
          onThread={openThread}
          onStartFresh={
            chat && chat.turns.length > 0 && !chat.streaming
              ? () =>
                  start.run(async () => {
                    const reply = await api.send({ type: 'chat:set-aside', threadKey: askThread });
                    if (reply.ok) setChatNotice({ kind: 'set-aside', threadKey: askThread });
                    return reply;
                  })
              : undefined
          }
          setAsideCount={chat?.setAside.length ?? 0}
          onShowSetAside={() => setShowSetAside(true)}
        />
        {settings}
      </>
    );
    body = (
      <AskView
        model={chat}
        threadKey={askThread}
        onThread={setAskThread}
        threads={threads}
        now={now}
        api={api}
        onOpenItem={setOpenId}
        aiDown={aiService?.up === false}
        room={home && home.status !== 'not-connected' ? home.room : []}
        quizOpen={Boolean(active?.assignment.quiz)}
        onEndQuiz={goWork}
        nudge={nudgeLine}
        onEditDraft={editDraft}
        notice={chatNotice?.threadKey === askThread && <ChatNoticeLine notice={chatNotice} chat={chat} send={api.send} onDone={() => setChatNotice(null)} />}
      />
    );
  } else if (view === 'work' && active) {
    const clock = sessionClock(active, now);
    bar = (
      <>
        <button type="button" className="back" onClick={() => setView('home')}>
          <Icon name="chevronLeft" />
          Home
        </button>
        <span className="grow" />
        <span className={clock.paused ? 'live paused' : clock.warn ? 'live warn' : 'live'}>{clock.text}</span>
        <SessionControls session={active} run={actions.sessionVerb} busy={start.busy} />
        {settings}
      </>
    );
    body = (
      <>
        <WorkHeader
          session={active}
          now={now}
          tab={workTab}
          onTab={setWorkTab}
          hintWaiting={hint !== null}
          detail={detail}
          onChecklist={() => setOpenId(active.assignment.assignmentId)}
          api={api}
        />
        <SessionTime key={active.plannedUntil ?? 'none'} session={active} now={now} api={api} onStop={() => setEndOpen(true)} />
        {endOpen && (
          <EndSheet
            session={active}
            noun={active.recap.noun}
            requestNextStep={() => api.send({ type: 'session:next-step' })}
            close={async (outcome, nextStep) => {
              const item = active.assignment;
              const noun = active.recap.noun;
              const reply = await api.send({ type: 'session:close', outcome, nextStep });
              if (!reply.ok) return reply.error;
              setEndOpen(false);
              setView('home');
              if (outcome === 'turned-in') setTurnedIn({ assignmentId: item.assignmentId, noun, mine: item.source === 'student' });
              else if (item.guessMinutes !== null) setAskLeft(item);
              return null;
            }}
            onKeepGoing={() => setEndOpen(false)}
          />
        )}
        {active.assignment.quiz ? (
          <QuizNote onEnd={() => setEndOpen(true)} />
        ) : workTab === 'help' ? (
          <ChatView
            session={active}
            chat={sessionChat}
            api={api}
            now={now}
            items={home ? askThreads(home) : []}
            room={home && home.status !== 'not-connected' ? home.room : []}
            onOpenItem={setOpenId}
            onEditDraft={editDraft}
            onOpenAsk={() => actions.openAsk(active.assignment.assignmentId)}
            draft={chatDraft}
            setDraft={setChatDraft}
            hint={
              (shownHint.value || active.handledHints.length > 0) && (
                <>
                  {shownHint.value && (
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
                  )}
                  <HandledHints hints={active.handledHints} now={now} />
                </>
              )
            }
            suggestion={
              <>
                {nudgeLine}
                {shownSuggestion.value && <SuggestionRow key={shownSuggestion.value.tabId} suggestion={shownSuggestion.value} leaving={shownSuggestion.leaving} api={api} />}
              </>
            }
          />
        ) : (
          <SourcesBody session={active} now={now} api={api} />
        )}
      </>
    );
  } else {
    bar = (
      <>
        {brand}
        <span className="bar-date">{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        {settings}
      </>
    );
    body = home ? (
      <HomeView
        model={home}
        now={now}
        actions={actions}
        active={active}
        hintWaiting={hint !== null}
        onRefresh={refresh}
        refreshing={refreshing}
        planMode={planMode}
        onPlanMode={setPlanMode}
        aiDown={aiService?.up === false}
        askLeft={askLeft}
        onAskLeftDone={() => setAskLeft(null)}
        turnedIn={turnedIn}
        onTurnedInDone={() => setTurnedIn(null)}
        nudge={nudgeLine}
      />
    ) : (
      <p className="caption">Loading…</p>
    );
  }

  /**
   * Saves the add/edit sheet. Chrome's Google Docs permission is asked first,
   * inside the click, before any await. A failed Doc link still adds the
   * assignment, so the sheet closes and the message shows at the top instead of
   * inviting a second add.
   */
  const saveAssignment = (fields: EditableFields): Promise<string | null> => {
    const target = addSheet;
    const allowDocs = fields.docUrl ? api.requestOrigins(DOCS_ORIGINS) : Promise.resolve(true);
    return allowDocs.then(async (granted) => {
      const sent = { ...fields, docUrl: granted ? fields.docUrl : null };
      const reply = target?.editId
        ? await api.send({ type: 'assignment:edit', assignmentId: target.editId, ...sent })
        : await api.send({ type: 'assignment:add', ...sent, draftId: target?.draftId });
      if (!reply.ok && !reply.error.startsWith('Loomer added this assignment')) return reply.error;
      setAddSheet(null);
      if (!reply.ok) start.setError(reply.error);
      else if (!granted) start.setError('Loomer saved this assignment, but Chrome didn’t allow Google Docs, so link the Doc from its page.');
      return null;
    });
  };

  const deleteAssignment = (assignmentId: string) => async (): Promise<string | null> => {
    const reply = await api.send({ type: 'assignment:delete', assignmentId });
    if (!reply.ok) return reply.error;
    setAddSheet(null);
    setOpenId(null);
    return null;
  };

  return (
    <div className="panel">
      {previewLabel && (
        <p className="preview-banner" role="note">
          {previewLabel}
        </p>
      )}
      <header className={chatScreen ? 'bar sticky' : 'bar'}>{bar}</header>
      <main className="screen" key={screenshot ? 'shot' : openItem ? `item:${openItem.assignmentId}` : view}>
        {paused && <PausedLine api={api} />}
        {start.error && (
          <p className="status-line error pad" role="status">
            {start.error}
          </p>
        )}
        {body}
        {showSetAside && (
          <SetAsideSheet
            chats={chat?.setAside ?? []}
            onRestore={async (c) => {
              const reply = await api.send({ type: 'chat:restore', id: c.id });
              if (!reply.ok) return reply.error;
              setShowSetAside(false);
              openThread(c.threadKey);
              return null;
            }}
            onClose={() => setShowSetAside(false)}
          />
        )}
        {addSheet && (
          <AddSheet
            editing={addSheet.fields}
            draft={addSheet.draft}
            courses={home && home.status !== 'not-connected' ? home.courses : []}
            now={now}
            save={saveAssignment}
            remove={addSheet.editId ? deleteAssignment(addSheet.editId) : undefined}
            onClose={() => setAddSheet(null)}
          />
        )}
      </main>
    </div>
  );
}

/**
 * One line at the top of Ask Loomer about the chat in view: it just opened for
 * a topic, or its last conversation was set aside (Undo brings back the newest
 * set-aside chat of this thread with chat:restore).
 */
function ChatNoticeLine({ notice, chat, send, onDone }: { notice: ChatNotice; chat: ChatModel | undefined; send: PanelApi['send']; onDone: () => void }) {
  const undo = useAction();
  const title = chat?.threads.find((t) => t.threadKey === notice.threadKey)?.title;
  const name = notice.threadKey === GENERAL_THREAD ? 'General' : title ? `your ${shortTitle(title)}` : 'this';
  const latest = chat?.setAside.find((c) => c.threadKey === notice.threadKey);
  return (
    <p className="chat-note" role="status">
      <Icon name={notice.kind === 'topic' ? 'chat' : 'undo'} size="sm" />
      <span className="grow">
        {notice.kind === 'topic' ? `Opened ${name} chat for this topic.` : `Your last ${notice.threadKey === GENERAL_THREAD ? 'General chat' : 'chat about this'} is set aside, not deleted.`}
      </span>
      {notice.kind === 'set-aside' && latest && (
        <button
          type="button"
          className="link"
          disabled={undo.busy}
          aria-busy={undo.busy}
          onClick={() =>
            undo.run(async () => {
              const reply = await send({ type: 'chat:restore', id: latest.id });
              if (reply.ok) onDone();
              return reply;
            })
          }
        >
          {undo.busy ? 'Undoing…' : 'Undo'}
        </button>
      )}
      {undo.error && <span className="danger-text">{undo.error}</span>}
    </p>
  );
}

function allItems(model: HomeModel): WorkItem[] {
  if (model.status === 'not-connected') return [];
  const older = model.olderReview?.items.map((i) => i.item) ?? [];
  return [...(model.status === 'ready' ? [model.next.item] : []), ...model.rest, ...older];
}

/** Assignments Ask Loomer can talk about: visible and not past due, earliest start first. */
function askThreads(model: HomeModel): WorkItem[] {
  const at = (i: WorkItem) => Date.parse(i.startBy?.at ?? i.due?.at ?? '') || Infinity;
  return allItems(model)
    .filter((i) => !i.hidden && i.bucket !== 'past')
    .sort((a, b) => at(a) - at(b));
}

function findItem(model: HomeModel, id: string): WorkItem | null {
  return allItems(model).find((i) => i.assignmentId === id) ?? null;
}

/** Loomer is paused: say what stops, and offer to turn it back on. Doesn't resume a session. */
function PausedLine({ api }: { api: PanelApi }) {
  const resume = useAction();
  return (
    <div className="notices" style={{ marginTop: 14 }} role="status">
      <div className="notice">
        <span className="dot" />
        <span className="grow">
          Loomer is paused
          <span className="notice-sub">It isn’t syncing Canvas, reading your Doc, or saving pages.</span>
          {resume.error && <span className="notice-sub danger-text">{resume.error}</span>}
        </span>
        <button type="button" className="link" disabled={resume.busy} aria-busy={resume.busy} onClick={() => resume.run(() => api.send({ type: 'privacy:pause', paused: false }))}>
          {resume.busy ? 'Turning on…' : 'Turn on'}
        </button>
      </div>
    </div>
  );
}
