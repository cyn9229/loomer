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

type View = 'start' | 'privacy';

export type OptionsProps = {
  settings: Settings | null;
  ai: AiSettings | null;
  proactive: ProactiveSettings | null;
  lastCheck: CheckInfo | null;
  now: Date;
};

export function OptionsPage({ settings, ai, proactive, lastCheck, now }: OptionsProps) {
  const connected = Boolean(settings?.canvasOrigin);
  const [view, setView] = useState<View | null>(null);
  const current: View = view ?? (connected ? 'privacy' : 'start');

  return (
    <div className="options">
      <aside className="options-side">
        <div className="options-brand">
          <LogoMark size={34} />
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
            <Privacy settings={settings} ai={ai} proactive={proactive} lastCheck={lastCheck} now={now} />
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
  lastCheck,
  now,
}: {
  settings: Settings | null;
  ai: AiSettings | null;
  proactive: ProactiveSettings | null;
  lastCheck: CheckInfo | null;
  now: Date;
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
          {settings && (
            <div className="setting">
              <span className={settings.paused ? 'tile amber' : 'tile green'}>
                <Icon name={settings.paused ? 'pause' : 'check'} size="sm" />
              </span>
              <span className="grow">
                <span className="setting-title">{settings.paused ? 'Paused' : 'Observing'}</span>
                <span className="setting-sub">
                  {settings.paused ? 'Loomer is not reading anything.' : 'Loomer reads approved sources while Chrome is open.'}
                </span>
              </span>
            </div>
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
        <section className="ocard" aria-label="Never read">
          <div className="ocard-head">
            <span className="tile lg">
              <Icon name="lock" />
            </span>
            <div className="grow">
              <h2 className="ocard-title">Never read</h2>
              <p className="ocard-desc">These block Loomer, not you.</p>
            </div>
          </div>
          {settings?.exclusions.map((x) => (
            <div className="setting" key={exclusionKey(x)}>
              <span className="grow">
                <span className="setting-title">{x.kind === 'host' ? x.host : `${new URL(x.origin).host}${x.path}`}</span>
                <span className="setting-sub">{exclusionScope(x)}</span>
              </span>
            </div>
          ))}
          <div className="setting">
            <span className="grow">
              <span className="setting-title">Always excluded</span>
              <span className="setting-sub">Gmail, Google sign-in and account pages, Google Chat and Messages, Outlook mail</span>
            </span>
            <Pill>Built in</Pill>
          </div>
        </section>
        <section className="ocard" aria-label="Your data">
          <div className="ocard-head">
            <span className="tile lg red">
              <Icon name="database" />
            </span>
            <div className="grow">
              <h2 className="ocard-title">Your data</h2>
              <p className="ocard-desc">
                Saved in this Chrome profile. Not encrypted. Anyone with access to this profile can read it.
              </p>
            </div>
          </div>
          <div className="setting">
            <span className="grow">
              <span className="setting-title">Chrome site access</span>
              <span className="setting-sub">Removing Loomer’s access to a site happens in Chrome’s extension settings.</span>
            </span>
          </div>
        </section>
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
        <div className="seg" role="radiogroup" aria-labelledby="proactive-delay-label">
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

function exclusionKey(x: Exclusion): string {
  return x.kind === 'host' ? `h:${x.host}` : `p:${x.origin}${x.path}`;
}

function exclusionScope(x: Exclusion): string {
  if (x.kind === 'page') return 'This page only';
  return x.includeSubdomains ? 'This site and its subdomains' : 'This host only';
}
