// Options page: Canvas connect onboarding and Privacy & controls (pick 5A).
// Shows only controls that exist. Settings are read and watched here; every
// change goes through the service worker by message.
import { useState, type FormEvent } from 'react';
import type { RunOutcome } from '../core/db';
import type { Exclusion } from '../core/gate';
import { sendMessage } from '../core/messages';
import type { AiSettings, ProactiveSettings, Settings } from '../core/settings';
import { isLoopback, parseSourceUrl } from '../core/url';
import type { CheckInfo } from '../model/home';
import { checkProblem, observedAt } from './format';
import { Icon, type IconName } from './Icon';
import { LogoMark, Wordmark } from './Logo';
import { Pill, ReplayPill } from './parts';
import { ConfirmBox, exclusionScope } from './privacy';
import { useAction } from './api';

type View = 'start' | 'privacy';

export type OptionsProps = {
  settings: Settings | null;
  ai: AiSettings | null;
  proactive: ProactiveSettings | null;
  discovery: { enabled: boolean } | null;
  notify: { enabled: boolean } | null;
  lastCheck: CheckInfo | null;
  now: Date;
};

export function OptionsPage({ settings, ai, proactive, discovery, notify, lastCheck, now }: OptionsProps) {
  const connected = Boolean(settings?.canvasOrigin);
  const [view, setView] = useState<View | null>(null);
  const current: View = view ?? (connected ? 'privacy' : 'start');

  return (
    <div className="options">
      <aside className="options-side">
        <div className="options-brand">
          <LogoMark size={24} />
          <Wordmark />
        </div>
        <nav aria-label="Settings">
          <NavItem icon="link" label="Get started" active={current === 'start'} onClick={() => setView('start')} />
          <NavItem icon="lock" label="Privacy & controls" active={current === 'privacy'} onClick={() => setView('privacy')} />
        </nav>
      </aside>
      <main className="options-main">
        <div className="options-inner">
          {current === 'start' ? (
            <GetStarted settings={settings} onDone={() => setView('privacy')} />
          ) : (
            <Privacy
              settings={settings}
              ai={ai}
              proactive={proactive}
              discovery={discovery}
              notify={notify}
              lastCheck={lastCheck}
              now={now}
              onCleared={() => setView('start')}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className="nav-item" aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon name={icon} />
      {label}
    </button>
  );
}

function GetStarted({ settings, onDone }: { settings: Settings | null; onDone: () => void }) {
  return (
    <>
      <p className="kicker">WELCOME</p>
      <h1 className="page-title">Less managing. More learning.</h1>
      <p className="page-lede">Know what you’re getting into, and pick up where you left off.</p>
      <ul className="steps">
        <Step icon="list" title="Understand" text="Reads each assignment’s instructions and rubric from Canvas." />
        <Step icon="sparkle" title="Prioritize" text="Suggests one next step and shows the sources behind it." />
        <Step icon="chat" title="Guide" text="Offers hints and questions, never finished answers." />
      </ul>
      <div className="grid-2">
        <section className="ocard" aria-label="Connect Canvas">
          <div className="ocard-head">
            <span className="tile lg">
              <Icon name="link" />
            </span>
            <div className="grow">
              <h2 className="ocard-title">Connect your school’s Canvas</h2>
              <p className="ocard-desc">
                {settings?.canvasOrigin ? `Connected to ${new URL(settings.canvasOrigin).host}.` : 'Step one. Everything else builds on this.'}
              </p>
            </div>
          </div>
          <ConnectForm onConnected={onDone} />
        </section>
        <section className="ocard" aria-label="What connecting means">
          <h2 className="ocard-title">What connecting means</h2>
          <ul className="steps" style={{ marginTop: 12 }}>
            <Step icon="globe" title="One site" text="Chrome asks you to allow this one address. Loomer reads only assignment pages it supports." />
            <Step icon="lock" title="No passwords" text="Your Canvas sign-in stays in Chrome. No school API keys." />
            <Step icon="database" title="Stored here" text="What Loomer reads is stored in this Chrome profile." />
          </ul>
        </section>
      </div>
    </>
  );
}

function Step({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <li>
      <span className="tile">
        <Icon name={icon} size="sm" />
      </span>
      <span>
        <b>{title}</b>
        <span>{text}</span>
      </span>
    </li>
  );
}

type FormState = { kind: 'idle' } | { kind: 'working' } | { kind: 'error'; text: string } | { kind: 'ok'; text: string };

/** Canvas address form. permissions.request runs first in the submit handler to keep the user gesture. */
function ConnectForm({ onConnected }: { onConnected?: () => void }) {
  const [address, setAddress] = useState('');
  const [state, setState] = useState<FormState>({ kind: 'idle' });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = parseSourceUrl(address.trim());
    if (!url) {
      setState({ kind: 'error', text: 'Use your school’s https Canvas address, like https://yourschool.instructure.com.' });
      return;
    }
    setState({ kind: 'working' });
    browser.permissions
      .request({ origins: [`${url.origin}/*`] })
      .then(async (granted) => {
        if (!granted) {
          setState({ kind: 'error', text: 'Chrome access was not granted. Loomer stays in limited mode.' });
          return;
        }
        const reply = await sendMessage({ type: 'canvas:connect', origin: url.origin });
        if (!reply.ok) {
          setState({ kind: 'error', text: reply.error });
          return;
        }
        setState({
          kind: 'ok',
          text: isLoopback(url) ? 'Connected to the local replay. Checking it now.' : 'Connected. Loomer is checking Canvas now.',
        });
        onConnected?.();
      })
      .catch((error: unknown) => setState({ kind: 'error', text: String(error) }));
  };

  return (
    <form onSubmit={submit}>
      <div className="form-row">
        <label className="grow">
          <span className="field-label">Canvas address</span>
          <input
            className="field"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="https://yourschool.instructure.com"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="cta" disabled={state.kind === 'working'}>
          {state.kind === 'working' ? 'Connecting' : 'Connect Canvas'}
        </button>
      </div>
      <p className={`status-line ${state.kind === 'error' ? 'error' : state.kind === 'ok' ? 'ok' : ''}`} role="status">
        {state.kind === 'error' || state.kind === 'ok' ? state.text : ''}
      </p>
    </form>
  );
}

function Privacy({
  settings,
  ai,
  proactive,
  discovery,
  notify,
  lastCheck,
  now,
  onCleared,
}: {
  settings: Settings | null;
  ai: AiSettings | null;
  proactive: ProactiveSettings | null;
  discovery: { enabled: boolean } | null;
  notify: { enabled: boolean } | null;
  lastCheck: CheckInfo | null;
  now: Date;
  onCleared: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const origin = settings?.canvasOrigin ? new URL(settings.canvasOrigin) : null;
  return (
    <>
      <div className="headline">
        <div>
          <p className="kicker">SETTINGS</p>
          <h1 className="page-title">Privacy &amp; controls</h1>
          <p className="page-lede">Loomer reads only what you approve here.</p>
        </div>
        <div className="hero">
          <span className="tile lg">
            <Icon name="shield" />
          </span>
          <div>
            <b>You decide what Loomer reads</b>
            <span>Approvals are per site. Gmail, Outlook mail, and Google sign-in pages are never read.</span>
          </div>
        </div>
      </div>
      <div className="grid-2">
        <section className="ocard" aria-label="Approved sources">
          <div className="ocard-head">
            <span className="tile lg">
              <Icon name="globe" />
            </span>
            <div className="grow">
              <h2 className="ocard-title">Approved sources</h2>
              <p className="ocard-desc">Loomer only reads from what you approve.</p>
            </div>
          </div>
          {origin ? (
            <div className="setting">
              <span className="tile">
                <Icon name="link" size="sm" />
              </span>
              <span className="grow">
                <span className="setting-title">Canvas · {origin.host}</span>
                <span className="setting-sub">
                  <CheckSummary lastCheck={lastCheck} now={now} />
                </span>
              </span>
              {isLoopback(origin) ? <ReplayPill /> : <Pill tone="green">Approved</Pill>}
            </div>
          ) : (
            <p className="ocard-desc">No source approved yet.</p>
          )}
          <div style={{ marginTop: 14 }}>
            {changing || !origin ? (
              <ConnectForm onConnected={() => setChanging(false)} />
            ) : (
              <button type="button" className="btn" onClick={() => setChanging(true)}>
                Change Canvas address
              </button>
            )}
          </div>
        </section>
        {ai && <AiHelpCard ai={ai} />}
        {proactive && <ProactiveCard proactive={proactive} />}
        {notify && <NotificationsCard enabled={notify.enabled} />}
        {discovery && <DiscoveryCard enabled={discovery.enabled} />}
        {settings && <PauseCard paused={settings.paused} />}
        {settings && <NeverReadCard exclusions={settings.exclusions} />}
        <DataCard onCleared={onCleared} />
      </div>
    </>
  );
}

/**
 * Cloud AI consent. Off by default. Turning it on asks Chrome for access to the
 * local broker first, inside the click, then tells the worker.
 */
function AiHelpCard({ ai }: { ai: AiSettings }) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const toggle = () => {
    setError(null);
    if (ai.enabled) {
      setWorking(true);
      void sendMessage({ type: 'ai:set', enabled: false })
        .then((reply) => !reply.ok && setError(reply.error))
        .finally(() => setWorking(false));
      return;
    }
    setWorking(true);
    browser.permissions
      .request({ origins: [`${ai.brokerOrigin}/*`] })
      .then(async (granted) => {
        if (!granted) {
          setError('Chrome access to the local AI service was not granted. AI help stays off.');
          return;
        }
        const reply = await sendMessage({ type: 'ai:set', enabled: true });
        if (!reply.ok) setError(reply.error);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setWorking(false));
  };

  return (
    <section className="ocard" aria-label="AI help">
      <div className="ocard-head">
        <span className="tile lg">
          <Icon name="sparkle" />
        </span>
        <div className="grow">
          <h2 className="ocard-title">AI help</h2>
          <p className="ocard-desc">Off by default. You choose.</p>
        </div>
      </div>
      <div className="setting">
        <span className="grow">
          <span className="setting-title" id="ai-switch-label">
            Read assignment requirements with AI
          </span>
          <span className="setting-sub" aria-live="polite">
            {working ? (ai.enabled ? 'Turning off…' : 'Turning on…') : ai.enabled ? 'On' : 'Off'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={ai.enabled}
          aria-labelledby="ai-switch-label"
          disabled={working}
          onClick={toggle}
        />
      </div>
      <div className="callout accent" style={{ marginTop: 12 }}>
        <span className="tile">
          <Icon name="info" size="sm" />
        </span>
        <p className="callout-body">
          When on, an assignment’s instructions and rubric go to OpenRouter (model openai/gpt-6-luna) through a local
          service on this computer. Providers are asked not to collect or retain the data. Loomer does not send your
          drafts for this step. A teacher’s no-AI rule always turns AI off for that assignment.
        </p>
      </div>
      {error && (
        <p className="status-line error" role="status">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Research suggestions: off by default. Turning on asks Chrome for the tabs
 * permission inside the click, then tells the worker; turning off needs no prompt.
 */
function DiscoveryCard({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const toggle = () => {
    setError(null);
    setWorking(true);
    const done = () => setWorking(false);
    if (enabled) {
      sendMessage({ type: 'discovery:set', enabled: false })
        .then((reply) => !reply.ok && setError(reply.error))
        .catch((e: unknown) => setError(String(e)))
        .finally(done);
      return;
    }
    browser.permissions
      .request({ permissions: ['tabs'] })
      .then(async (granted) => {
        if (!granted) {
          setError('Chrome did not grant tab access. Research suggestions stay off.');
          return;
        }
        const reply = await sendMessage({ type: 'discovery:set', enabled: true });
        if (!reply.ok) setError(reply.error);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(done);
  };

  return (
    <section className="ocard" aria-label="Research suggestions">
      <div className="ocard-head">
        <span className="tile lg">
          <Icon name="globe" />
        </span>
        <div className="grow">
          <h2 className="ocard-title">Research suggestions</h2>
          <p className="ocard-desc">Off by default. You choose.</p>
        </div>
      </div>
      <div className="setting">
        <span className="grow">
          <span className="setting-title" id="discovery-switch-label">
            Suggest pages to add during a session
          </span>
          <span className="setting-sub" aria-live="polite">
            {working ? (enabled ? 'Turning off…' : 'Turning on…') : enabled ? 'On' : 'Off'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={enabled}
          aria-labelledby="discovery-switch-label"
          disabled={working}
          onClick={toggle}
        />
      </div>
      <div className="callout accent" style={{ marginTop: 12 }}>
        <span className="tile">
          <Icon name="info" size="sm" />
        </span>
        <p className="callout-body">
          Chrome will call this “Read your browsing history”. Loomer only looks at the title and address of the tab in
          front, only during an active session, on this device, without AI. It never reads a page until you choose Save,
          and it keeps no list of sites you visit. Turning this off gives the access back.
        </p>
      </div>
      {error && (
        <p className="status-line error" role="status">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Desktop notifications: off by default. Turning on asks Chrome for the
 * notifications permission inside the click, then tells the worker; turning
 * off gives the permission back.
 */
function NotificationsCard({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const toggle = () => {
    setError(null);
    setWorking(true);
    const done = () => setWorking(false);
    if (enabled) {
      sendMessage({ type: 'notify:set', enabled: false })
        .then((reply) => !reply.ok && setError(reply.error))
        .catch((e: unknown) => setError(String(e)))
        .finally(done);
      return;
    }
    browser.permissions
      .request({ permissions: ['notifications'] })
      .then(async (granted) => {
        if (!granted) {
          setError('Chrome didn’t allow notifications. They stay off.');
          return;
        }
        const reply = await sendMessage({ type: 'notify:set', enabled: true });
        if (!reply.ok) setError(reply.error);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(done);
  };

  return (
    <section className="ocard" aria-label="Notifications">
      <div className="ocard-head">
        <span className="tile lg">
          <Icon name="bell" />
        </span>
        <div className="grow">
          <h2 className="ocard-title">Notifications</h2>
          <p className="ocard-desc">Off by default. You choose.</p>
        </div>
      </div>
      <div className="setting">
        <span className="grow">
          <span className="setting-title" id="notify-switch-label">
            Ping me about due dates
          </span>
          <span className="setting-sub" aria-live="polite">
            {working ? (enabled ? 'Turning off…' : 'Turning on…') : 'When a teacher moves a due date in Canvas, and at most one research reminder per session.'}
          </span>
        </span>
        <button type="button" role="switch" className="switch" aria-checked={enabled} aria-labelledby="notify-switch-label" disabled={working} onClick={toggle} />
      </div>
      <p className="ocard-desc" style={{ marginTop: 8 }}>
        Hints never send notifications. Your computer might mute these.
      </p>
      {error && (
        <p className="status-line error" role="status">
          {error}
        </p>
      )}
    </section>
  );
}

const DELAYS = [60, 90, 120] as const;

/** Proactive hints: on/off and the pause before a hint may appear. */
function ProactiveCard({ proactive }: { proactive: ProactiveSettings }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const save = (next: ProactiveSettings, label: string) => {
    setError(null);
    setSaving(label);
    sendMessage({ type: 'proactive:set', enabled: next.enabled, delaySec: next.delaySec })
      .then((reply) => !reply.ok && setError(reply.error))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setSaving(null));
  };

  return (
    <section className="ocard" aria-label="Proactive hints">
      <div className="ocard-head">
        <span className="tile lg">
          <Icon name="sparkle" />
        </span>
        <div className="grow">
          <h2 className="ocard-title">Proactive hints</h2>
          <p className="ocard-desc">
            Hints appear only after you pause, and only about what you have written. A review you ask for runs right away.
          </p>
        </div>
      </div>
      <div className="setting">
        <span className="grow">
          <span className="setting-title" id="proactive-switch-label">
            Show a hint when I pause
          </span>
          <span className="setting-sub" aria-live="polite">
            {saving === 'toggle' ? 'Saving…' : proactive.enabled ? 'On' : 'Off'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={proactive.enabled}
          aria-labelledby="proactive-switch-label"
          disabled={saving !== null}
          onClick={() => save({ ...proactive, enabled: !proactive.enabled }, 'toggle')}
        />
      </div>
      <div className="setting">
        <span className="grow">
          <span className="setting-title" id="proactive-delay-label">
            Pause before a hint
          </span>
          <span className="setting-sub">{saving === 'delay' ? 'Saving…' : `${proactive.delaySec} seconds without edits`}</span>
        </span>
        <div className="seg-opt" role="radiogroup" aria-labelledby="proactive-delay-label">
          {DELAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={proactive.delaySec === d}
              disabled={!proactive.enabled || saving !== null}
              onClick={() => save({ ...proactive, delaySec: d }, 'delay')}
            >
              {d} s
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="status-line error" role="status">
          {error}
        </p>
      )}
    </section>
  );
}

function CheckSummary({ lastCheck, now }: { lastCheck: CheckInfo | null; now: Date }) {
  if (!lastCheck) return <>No check has finished yet.</>;
  const outcome: RunOutcome = lastCheck.partial && lastCheck.outcome === 'ok' ? 'partial' : lastCheck.outcome;
  const problem = checkProblem(outcome);
  return (
    <>
      {lastCheck.courses} {lastCheck.courses === 1 ? 'course' : 'courses'} · {problem ? 'tried' : 'checked'}{' '}
      {observedAt(lastCheck.at, now)}
      {problem && <> · {problem}</>}
    </>
  );
}



/** Pause or resume everything Loomer reads. Resuming does not resume a work session. */
function PauseCard({ paused }: { paused: boolean }) {
  const action = useAction();
  return (
    <section className="ocard" aria-label="Pause Loomer">
      <div className="ocard-head">
        <span className={paused ? 'tile lg amber' : 'tile lg'}>
          <Icon name="pause" />
        </span>
        <div className="grow">
          <h2 className="ocard-title">{paused ? 'Loomer is paused' : 'Pause Loomer'}</h2>
          <p className="ocard-desc">
            Pausing stops Canvas checks, reading your Doc, adding pages, and suggestions. It also pauses your work session.
            Resuming Loomer does not resume the session; press Resume in the session for that.
          </p>
        </div>
      </div>
      <div className="setting">
        <span className={paused ? 'tile amber' : 'tile green'}>
          <Icon name={paused ? 'pause' : 'check'} size="sm" />
        </span>
        <span className="grow">
          <span className="setting-title">{paused ? 'Paused' : 'Running'}</span>
          <span className="setting-sub">{paused ? 'Loomer is not reading anything.' : 'Loomer reads only what you approved.'}</span>
        </span>
        <button
          type="button"
          className="btn"
          disabled={action.busy}
          aria-busy={action.busy}
          onClick={() => action.run(() => sendMessage({ type: 'privacy:pause', paused: !paused }))}
        >
          {action.busy ? (paused ? 'Resuming…' : 'Pausing…') : paused ? 'Resume Loomer' : 'Pause Loomer'}
        </button>
      </div>
      {action.error && <p className="status-line error">{action.error}</p>}
    </section>
  );
}

/** Parses "news.example.com" or a full URL into a lowercase hostname. */
function parseHost(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const host = new URL(text.includes('://') ? text : `https://${text}`).hostname.toLowerCase();
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** The student's "Never read" list with Remove, an add form that shows scope first, and the built-in list. */
function NeverReadCard({ exclusions }: { exclusions: Exclusion[] }) {
  const [input, setInput] = useState('');
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [deleteSaved, setDeleteSaved] = useState(false);
  const add = useAction();
  const host = parseHost(input);
  const rule: Exclusion | null = host ? { kind: 'host', host, includeSubdomains } : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!rule) {
      add.setError('Enter a site address, like news.example.com.');
      return;
    }
    add.run(async () => {
      const reply = await sendMessage({ type: 'exclusion:add', rule, deleteSaved });
      if (reply.ok) {
        setInput('');
        setIncludeSubdomains(false);
        setDeleteSaved(false);
      }
      return reply;
    });
  };

  return (
    <section className="ocard" aria-label="Never read">
      <div className="ocard-head">
        <span className="tile lg">
          <Icon name="eyeOff" />
        </span>
        <div className="grow">
          <h2 className="ocard-title">Never read</h2>
          <p className="ocard-desc">These block Loomer, not you. You can still visit them.</p>
        </div>
      </div>
      {exclusions.map((x) => (
        <ExclusionRow key={x.kind === 'host' ? `h:${x.host}:${x.includeSubdomains}` : `p:${x.origin}${x.path}`} rule={x} />
      ))}
      <form onSubmit={submit} className="exclusion-form">
        <label>
          <span className="field-label">Add site</span>
          <input
            className="field sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="news.example.com"
            inputMode="url"
            spellCheck={false}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={includeSubdomains} onChange={(e) => setIncludeSubdomains(e.target.checked)} />
          Include subdomains
        </label>
        <label className="check">
          <input type="checkbox" checked={deleteSaved} onChange={(e) => setDeleteSaved(e.target.checked)} />
          Also delete pages already saved from this site
        </label>
        <p className="scope-line" aria-live="polite">
          {rule ? exclusionScope(rule) : 'Type a site to see exactly what it blocks.'}
        </p>
        <button type="submit" className="btn" disabled={!rule || add.busy} aria-busy={add.busy}>
          {add.busy ? 'Saving…' : rule ? `Never read ${rule.host}` : 'Never read'}
        </button>
        {add.error && <p className="status-line error">{add.error}</p>}
      </form>
      <div className="setting" style={{ marginTop: 14 }}>
        <span className="grow">
          <span className="setting-title">Always excluded</span>
          <span className="setting-sub">
            Gmail, Google sign-in and account pages, Google Chat and Messages, and Outlook mail. Sign-in, account,
            settings, payment, inbox, message, and grade pages are never saved as research.
          </span>
        </span>
        <Pill>Built in</Pill>
      </div>
    </section>
  );
}

function ExclusionRow({ rule }: { rule: Exclusion }) {
  const remove = useAction();
  return (
    <div className="setting">
      <span className="grow">
        <span className="setting-title">{rule.kind === 'host' ? rule.host : `${new URL(rule.origin).host}${rule.path}`}</span>
        <span className="setting-sub">{exclusionScope(rule)}</span>
        {remove.error && <span className="setting-sub danger-text">{remove.error}</span>}
      </span>
      <button
        type="button"
        className="link"
        disabled={remove.busy}
        aria-busy={remove.busy}
        onClick={() => remove.run(() => sendMessage({ type: 'exclusion:remove', rule }))}
      >
        {remove.busy ? 'Removing…' : 'Remove'}
      </button>
    </div>
  );
}

/** Local data facts and "Clear all Loomer data" with a confirm step. */
function DataCard({ onCleared }: { onCleared: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const clear = useAction();
  return (
    <section className="ocard" aria-label="Your data">
      <div className="ocard-head">
        <span className="tile lg red">
          <Icon name="database" />
        </span>
        <div className="grow">
          <h2 className="ocard-title">Your data</h2>
          <p className="ocard-desc">Saved in this Chrome profile. Not encrypted. Anyone with access to this profile can read it.</p>
        </div>
      </div>
      <div className="setting">
        <span className="grow">
          <span className="setting-title">Chrome site access</span>
          <span className="setting-sub">Review it at chrome://extensions › loomer › Details.</span>
        </span>
      </div>
      <div style={{ marginTop: 14 }}>
        {confirming ? (
          <ConfirmBox
            title="Clear all Loomer data?"
            confirmLabel="Clear all data"
            busyLabel="Clearing…"
            busy={clear.busy}
            error={clear.error}
            danger
            onCancel={() => setConfirming(false)}
            onConfirm={() =>
              clear.run(async () => {
                const reply = await sendMessage({ type: 'data:clear-all' });
                if (reply.ok) onCleared();
                return reply;
              })
            }
          >
            <p className="confirm-body">
              Removes everything Loomer stored on this computer and gives back the site access Loomer was given. It
              cannot undo AI processing that already happened at the provider. Nothing changes in Canvas or your Docs.
            </p>
          </ConfirmBox>
        ) : (
          <button type="button" className="btn danger-btn" onClick={() => setConfirming(true)}>
            <Icon name="trash" size="sm" />
            Clear all Loomer data
          </button>
        )}
      </div>
    </section>
  );
}
