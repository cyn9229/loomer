// Options page: Canvas connect onboarding and Privacy & controls (pick 5A).
// Shows only controls that exist. Settings are read and watched here; every
// change goes through the service worker by message.
import { useState, type FormEvent } from 'react';
import type { RunOutcome } from '../core/db';
import type { Exclusion } from '../core/gate';
import { sendMessage } from '../core/messages';
import type { Settings } from '../core/settings';
import { isLoopback, parseSourceUrl } from '../core/url';
import type { CheckInfo } from '../model/home';
import { checkProblem, observedAt } from './format';
import { Icon, type IconName } from './Icon';
import { LogoMark, Wordmark } from './Logo';
import { Pill, ReplayPill } from './parts';

type View = 'start' | 'privacy';

export type OptionsProps = {
  settings: Settings | null;
  lastCheck: CheckInfo | null;
  now: Date;
};

export function OptionsPage({ settings, lastCheck, now }: OptionsProps) {
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
            <Privacy settings={settings} lastCheck={lastCheck} now={now} />
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

function Privacy({ settings, lastCheck, now }: { settings: Settings | null; lastCheck: CheckInfo | null; now: Date }) {
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
