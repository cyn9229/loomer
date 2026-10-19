// The teacher's sheets: Google Docs embedded in the Canvas instructions, which
// Loomer reads on its own (up to three). Shown by name, never by address: one
// read sheet is a single line; otherwise a short list with each sheet's state
// (read with its topic count, needs Google Docs, or why it couldn't be read)
// and Open. Used on the Working screen and the assignment.
import { DOCS_ORIGINS } from '../core/messages';
import type { TeacherSheet } from '../model/session';
import { useAction, type PanelApi } from './api';
import { Icon } from './Icon';

type SheetProps = {
  sheets: TeacherSheet[];
  /** The list's small heading, e.g. "From the instructions". */
  label: string;
  requestOrigins: PanelApi['requestOrigins'];
  send: PanelApi['send'];
};

export function sheetName(sheet: TeacherSheet): string {
  return sheet.title ?? 'Sheet in the instructions';
}

const topicCount = (n: number | null) => (n === null ? '' : ` · ${n} ${n === 1 ? 'topic' : 'topics'}`);

export function SheetList({ sheets, label, requestOrigins, send }: SheetProps) {
  if (sheets.length === 0) return null;
  const [only] = sheets;
  if (sheets.length === 1 && only?.state === 'ok') {
    return (
      <p className="readline">
        <Icon name="checkCircle" size="sm" />
        <span className="grow">
          Loomer read the sheet in the instructions: <b>{sheetName(only)}</b>
          {topicCount(only.topics)}
        </span>
        <a className="link" href={only.url} target="_blank" rel="noreferrer">
          Open
        </a>
      </p>
    );
  }
  return (
    <section className="sheets" aria-label={label}>
      <p className="sheets-k">{label}</p>
      {sheets.map((s) => (
        <SheetRow key={s.docId} sheet={s} requestOrigins={requestOrigins} send={send} />
      ))}
    </section>
  );
}

const trouble: Record<Exclude<TeacherSheet['state'], 'ok' | 'needs-permission'>, string> = {
  'no-access': 'Google didn’t let Loomer read it, so you might need to sign in.',
  unreadable: 'Loomer couldn’t read it and will try again on the next check.',
  'rate-limited': 'Google asked Loomer to slow down. It reads it on the next check.',
};

/** One sheet: its name, what Loomer could do with it, and Open (or Allow when it needs Google Docs). */
function SheetRow({ sheet, requestOrigins, send }: { sheet: TeacherSheet; requestOrigins: PanelApi['requestOrigins']; send: PanelApi['send'] }) {
  const allow = useAction();
  return (
    <div className="sheet-row">
      <Icon name="doc" size="sm" />
      <span className="grow">
        <span className="sheet-t">{sheetName(sheet)}</span>
        <span className="sheet-s">
          {sheet.state === 'ok' ? (
            <>
              <span className="ok">
                <Icon name="check" size="xs" />
                Read
              </span>
              {topicCount(sheet.topics)}
            </>
          ) : sheet.state === 'needs-permission' ? (
            'Loomer needs Google Docs to read it'
          ) : (
            <span className="warn">{trouble[sheet.state]}</span>
          )}
        </span>
        {allow.error && <span className="sheet-s danger-text">{allow.error}</span>}
      </span>
      {sheet.state === 'needs-permission' ? (
        <button
          type="button"
          className="btn-primary sm"
          disabled={allow.busy}
          aria-busy={allow.busy}
          onClick={() =>
            allow.run(() =>
              // requestOrigins runs synchronously inside this click, before any await.
              requestOrigins(DOCS_ORIGINS).then((granted) =>
                granted ? send({ type: 'canvas:refresh' }) : { ok: false as const, error: 'Chrome didn’t allow Google Docs, so Loomer can’t read it.' },
              ),
            )
          }
        >
          {allow.busy ? 'Allowing…' : 'Allow'}
        </button>
      ) : (
        <a className="link" href={sheet.url} target="_blank" rel="noreferrer">
          Open
        </a>
      )}
    </div>
  );
}
