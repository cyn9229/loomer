// Privacy actions shared by the panel and options: an inline confirm step, the
// "Never read" action for a site or a Doc, and per-assignment delete. Every
// action states its exact scope before anything is sent.
import { useState, type ReactNode } from 'react';
import type { Exclusion } from '../core/gate';
import type { Message, Reply } from '../core/messages';
import { useAction } from './api';
import { Icon } from './Icon';

type Send = (message: Message) => Promise<Reply>;

/** Inline confirmation: what will happen, optional extra choice, then confirm or cancel. */
export function ConfirmBox({
  title,
  children,
  confirmLabel,
  busyLabel,
  busy,
  error,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={danger ? 'confirm danger' : 'confirm'} role="group" aria-label={title}>
      <p className="confirm-title">{title}</p>
      {children}
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className={danger ? 'btn sm danger-btn' : 'btn sm'} onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
        <button type="button" className="link" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="status-line error">{error}</p>}
    </div>
  );
}

/** Plain sentence for what a rule blocks. */
export function exclusionScope(rule: Exclusion): string {
  if (rule.kind === 'page') return `Blocks only this page: ${new URL(rule.origin).host}${rule.path}`;
  return rule.includeSubdomains
    ? `Blocks ${rule.host} and every subdomain of it.`
    : `Blocks only ${rule.host}, not its subdomains.`;
}

export function hostRule(url: string): Exclusion | null {
  try {
    return { kind: 'host', host: new URL(url).hostname, includeSubdomains: false };
  } catch {
    return null;
  }
}

export function docRule(docId: string): Exclusion {
  return { kind: 'page', origin: 'https://docs.google.com', path: `/document/d/${docId}/` };
}

/**
 * "Never read this site/Doc": a link that opens a confirm with the exact scope
 * and an "also delete what was saved" choice, then sends exclusion:add.
 */
export function NeverRead({
  rule,
  label,
  deleteLabel,
  send,
}: {
  rule: Exclusion;
  label: string;
  deleteLabel: string;
  send: Send;
}) {
  const [open, setOpen] = useState(false);
  const [deleteSaved, setDeleteSaved] = useState(false);
  const action = useAction();
  const name = rule.kind === 'host' ? rule.host : 'this Doc';

  if (!open) {
    return (
      <button type="button" className="link subtle" onClick={() => setOpen(true)}>
        <Icon name="eyeOff" size="xs" />
        {label}
      </button>
    );
  }
  return (
    <ConfirmBox
      title={`Never read ${name}?`}
      confirmLabel="Never read"
      busyLabel="Saving…"
      busy={action.busy}
      error={action.error}
      onCancel={() => setOpen(false)}
      onConfirm={() => action.run(() => send({ type: 'exclusion:add', rule, deleteSaved }))}
    >
      <p className="confirm-body">{exclusionScope(rule)} You can still visit it; Loomer will not read it.</p>
      <label className="check">
        <input type="checkbox" checked={deleteSaved} onChange={(e) => setDeleteSaved(e.target.checked)} />
        {deleteLabel}
      </label>
    </ConfirmBox>
  );
}

/** "Delete Loomer's data for this assignment" with a confirm step. */
export function DeleteAssignmentData({ assignmentId, send }: { assignmentId: string; send: Send }) {
  const [open, setOpen] = useState(false);
  const action = useAction();
  if (!open) {
    return (
      <button type="button" className="link subtle" onClick={() => setOpen(true)}>
        <Icon name="trash" size="xs" />
        Delete Loomer’s data for this assignment
      </button>
    );
  }
  return (
    <ConfirmBox
      title="Delete Loomer’s data for this assignment?"
      confirmLabel="Delete"
      busyLabel="Deleting…"
      busy={action.busy}
      error={action.error}
      danger
      onCancel={() => setOpen(false)}
      onConfirm={() => action.run(() => send({ type: 'data:delete-assignment', assignmentId }))}
    >
      <p className="confirm-body">
        This removes Loomer’s notes, chat, pages, and draft copy, but nothing changes in Canvas or your Doc.
      </p>
    </ConfirmBox>
  );
}
