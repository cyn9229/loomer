// The study trail (round 47: 1B, 2B, 3A, 4A, with the student picking the
// sites). During a session, Loomer notices which of the assignment's topics
// come up on the study sites the student picked, so they never have to keep
// Loomer up to date. No AI, no page text kept, nothing leaves the computer;
// only the results stay. The first time a known study site is in front, a
// quiet row asks (TrailAsk); Pick sites opens a checklist where the student
// ticks the sites and adds their own (SitePicker), and Chrome then asks for
// exactly those. What Loomer took shows as one line in Help that opens to
// each site, with Pause and Remove (TrailFold). The end card's recap and the
// test's topic lines come from the model as finished sentences.
import { useState } from 'react';
import { useAction, type PanelApi } from './api';
import { Icon } from './Icon';

/** A study site: its domain and the name students know it by. */
export type StudySite = { origin: string; name: string };

/**
 * SessionModel.trail, mirrored from the contract sent to the logic session;
 * the model's own type replaces it when it lands.
 */
export type Trail = {
  /** A known study site in front that isn't picked yet: shows the row. */
  ask: StudySite | null;
  /** An unknown site that matches the assignment, with what matched. */
  other: { origin: string; matched: string } | null;
  /** The student's own list. */
  picked: (StudySite & { paused: boolean })[];
  /** What Loomer took from each site this session. `took` is one sentence. */
  noticed: (StudySite & { minutes: number; took: string; paused: boolean })[];
};

/** What a message to the worker resolves to; the panel maps each callback to its trail: message. */
type Reply = ReturnType<PanelApi['send']>;
type RequestOrigins = PanelApi['requestOrigins'];

/** Chrome match patterns for a site and its subdomains. */
const patternsOf = (origin: string) => [`https://${origin}/*`, `https://*.${origin}/*`];

/** "brainscape.com" from what the student typed ("https://www.brainscape.com/flashcards"), or null when it isn't a site. */
export function siteOf(typed: string): string | null {
  const t = typed.trim().toLowerCase();
  if (!t) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** The site's first letter in a quiet square. Never a brand logo. */
function SiteMark({ name }: { name: string }) {
  return (
    <span className="site-mark" aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const PRIVACY = 'Page text never leaves this computer, and Loomer keeps only the topics that came up.';

/** The first time a known study site is in front during a session: one quiet row that asks. */
export function TrailAsk({ ask, onPick, onDismiss }: { ask: StudySite; onPick: () => void; onDismiss: () => Reply }) {
  const dismiss = useAction();
  return (
    <section className="trail-row" aria-label="Study sites">
      <p className="trail-row-t">
        <SiteMark name={ask.name} />
        <span className="grow">
          <b>You’re on {ask.name}</b>
          <span>Pick the study sites Loomer can notice during your sessions.</span>
        </span>
      </p>
      <p className="trail-acts">
        <button type="button" className="btn-primary sm" onClick={onPick}>
          Pick sites
        </button>
        <button type="button" className="btn sm" disabled={dismiss.busy} onClick={() => dismiss.run(onDismiss)}>
          Not now
        </button>
      </p>
      {dismiss.error && <p className="status-line error">{dismiss.error}</p>}
    </section>
  );
}

/**
 * The sites Loomer may notice: the known study sites (only the one in front
 * and any already picked are ticked, so the student chooses the rest), plus
 * any site they add. Allow asks Chrome for exactly the ticked sites inside
 * the click, then saves the list.
 */
export function SitePicker({
  sites,
  picked,
  current,
  requestOrigins,
  onSave,
  onDone,
}: {
  sites: StudySite[];
  picked: StudySite[];
  current: StudySite | null;
  requestOrigins: RequestOrigins;
  /** Saves the whole list (trail:sites-set), after Chrome granted it. */
  onSave: (origins: string[]) => Reply;
  onDone: () => void;
}) {
  const save = useAction();
  const known = new Set(sites.map((s) => s.origin));
  const [added, setAdded] = useState<StudySite[]>(() => picked.filter((p) => !known.has(p.origin)));
  const [ticked, setTicked] = useState<Set<string>>(() => new Set([...picked.map((p) => p.origin), ...(current ? [current.origin] : [])]));
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const toggle = (origin: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(origin)) next.delete(origin);
      else next.add(origin);
      return next;
    });
  const add = () => {
    const origin = siteOf(typed);
    if (!origin) return setBad(true);
    setBad(false);
    setTyped('');
    if (!known.has(origin) && !added.some((a) => a.origin === origin)) setAdded((a) => [...a, { origin, name: origin }]);
    setTicked((t) => new Set(t).add(origin));
  };
  const origins = [...ticked];
  const allow = () => {
    // Chrome shows its prompt only for a request made inside the click, before any await.
    const granted = origins.length > 0 ? requestOrigins(origins.flatMap(patternsOf)) : Promise.resolve(true);
    save.run(async () => {
      if (!(await granted)) return { ok: false, error: 'Chrome didn’t allow these sites, so Loomer won’t notice them.' };
      const reply = await onSave(origins);
      if (reply.ok) onDone();
      return reply;
    });
  };
  const row = (s: StudySite, removable: boolean) => (
    <label className={ticked.has(s.origin) ? 'trail-pick on' : 'trail-pick'} key={s.origin}>
      <input type="checkbox" checked={ticked.has(s.origin)} onChange={() => toggle(s.origin)} />
      <SiteMark name={s.name} />
      <span className="grow">{s.name}</span>
      {removable ? (
        <button
          type="button"
          className="icon-btn"
          aria-label={`Remove ${s.name}`}
          title="Remove"
          onClick={(e) => {
            e.preventDefault();
            setAdded((a) => a.filter((x) => x.origin !== s.origin));
            setTicked((t) => {
              const next = new Set(t);
              next.delete(s.origin);
              return next;
            });
          }}
        >
          <Icon name="x" size="xs" />
        </button>
      ) : (
        <i>{current?.origin === s.origin ? 'Open now' : s.origin}</i>
      )}
    </label>
  );
  return (
    <section className="trail-picker" aria-label="Your study sites">
      <p className="trail-t">Your study sites</p>
      <p className="trail-p">Loomer notices which of your topics come up on the sites you pick, only while a session is open.</p>
      {sites.map((s) => row(s, false))}
      {added.map((s) => row(s, true))}
      <form
        className="trail-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="trail-in" value={typed} placeholder="Add another site" aria-label="Add another site" aria-invalid={bad} onChange={(e) => (setTyped(e.target.value), setBad(false))} />
        <button type="submit" className="btn sm">
          <Icon name="plus" size="xs" />
          Add
        </button>
      </form>
      {bad && <p className="trail-bad">Type a site like brainscape.com, without the rest of the address.</p>}
      <p className="trail-priv">
        <Icon name="lock" size="xs" />
        <span>{PRIVACY}</span>
      </p>
      <p className="trail-acts">
        <button type="button" className="btn-primary sm" disabled={save.busy} aria-busy={save.busy} onClick={allow}>
          {origins.length === 0 ? 'Notice no sites' : origins.length === 1 ? 'Allow 1 site' : `Allow ${origins.length} sites`}
        </button>
        <button type="button" className="btn sm" onClick={onDone}>
          Not now
        </button>
      </p>
      {save.error && <p className="status-line error">{save.error}</p>}
    </section>
  );
}

/** An unknown site that matches the assignment: asked once. Chrome then asks for that one site. */
export function OtherSiteAsk({ other, requestOrigins, onAnswer }: { other: NonNullable<Trail['other']>; requestOrigins: RequestOrigins; onAnswer: (read: boolean) => Reply }) {
  const act = useAction();
  const answer = (read: boolean) => {
    // Inside the click, before any await, so Chrome shows its prompt.
    const granted = read ? requestOrigins(patternsOf(other.origin)) : Promise.resolve(false);
    act.run(async () => onAnswer(read && (await granted)));
  };
  return (
    <section className="trail-row" aria-label="Another study site">
      <p className="trail-row-t">
        <SiteMark name={other.origin} />
        <span className="grow">
          <b>Read this site too?</b>
          <span>{other.matched}</span>
        </span>
      </p>
      <p className="trail-acts">
        <button type="button" className="btn-primary sm" disabled={act.busy} onClick={() => answer(true)}>
          Read it too
        </button>
        <button type="button" className="btn sm" disabled={act.busy} onClick={() => answer(false)}>
          No
        </button>
      </p>
      {act.error && <p className="status-line error">{act.error}</p>}
    </section>
  );
}

/**
 * What Loomer noticed, as one quiet line in Help that opens in place: each
 * site with its minutes and what Loomer took, Pause (or Resume) and Remove,
 * and Change your study sites. The line changes only when a site is added.
 */
export function TrailFold({
  noticed,
  onPause,
  onRemove,
  onChange,
}: {
  noticed: Trail['noticed'];
  onPause: (origin: string, paused: boolean) => Reply;
  /** Removes what Loomer took from that site. */
  onRemove: (origin: string) => Reply;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const act = useAction();
  if (noticed.length === 0) return null;
  return (
    <section className="trail-fold" aria-label="What Loomer noticed">
      <button type="button" className="trail-fold-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="globe" size="sm" />
        <span className="grow">Loomer noticed {noticed.length === 1 ? '1 study site' : `${noticed.length} study sites`}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size="sm" />
      </button>
      {open && (
        <div className="trail-list">
          {noticed.map((s) => (
            <div className={s.paused ? 'trail-site paused' : 'trail-site'} key={s.origin}>
              <SiteMark name={s.name} />
              <span className="grow">
                <span className="trail-site-h">
                  <b>{s.name}</b>
                  <i>{s.minutes} min</i>
                </span>
                <span className="trail-site-s">{s.paused ? 'Paused, so Loomer isn’t noticing this site right now.' : s.took}</span>
                <span className="trail-site-a">
                  <button type="button" className="link muted" disabled={act.busy} onClick={() => act.run(() => onPause(s.origin, !s.paused))}>
                    <Icon name={s.paused ? 'play' : 'pause'} size="xs" />
                    {s.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button type="button" className="link muted" disabled={act.busy} onClick={() => act.run(() => onRemove(s.origin))}>
                    <Icon name="trash" size="xs" />
                    Remove
                  </button>
                </span>
              </span>
            </div>
          ))}
          <button type="button" className="link trail-change" onClick={onChange}>
            <Icon name="edit" size="xs" />
            Change your study sites
          </button>
          {act.error && <p className="status-line error">{act.error}</p>}
        </div>
      )}
    </section>
  );
}
