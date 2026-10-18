// The "working on this?" nudge: one quiet line at the bottom of a screen when
// the worker noticed the student working (typing in a linked Doc, or one
// assignment open in the panel for a few minutes). Start, Resume or Switch is
// the only way a session starts from it; Not now mutes that assignment for 2
// hours (nudge:dismiss). Nothing moves or repaints while it shows.
import { useEffect } from 'react';
import type { WorkNudge } from '../model/session';
import { useAction, type PanelApi } from './api';
import { Icon } from './Icon';

type NudgeProps = {
  nudge: NonNullable<WorkNudge>;
  /** The panel is already on this assignment, so "this" is enough. */
  here: boolean;
  onStart: (assignmentId: string) => void;
  onResume: () => void;
  send: PanelApi['send'];
};

const verb = { start: 'Start', resume: 'Resume', switch: 'Switch' } as const;

export function NudgeLine({ nudge, here, onStart, onResume, send }: NudgeProps) {
  const dismiss = useAction();
  const question =
    nudge.action === 'resume' ? `Resume your ${nudge.title} session?` : nudge.action === 'switch' ? `Switch to ${nudge.title}?` : here ? 'Working on this?' : `Working on ${nudge.title}?`;
  return (
    <div className="nudge" role="status">
      <Icon name={nudge.reason === 'typing' ? 'keyboard' : 'eye'} size="sm" />
      <b className="grow">{question}</b>
      <button type="button" className="btn-primary sm" onClick={() => (nudge.action === 'resume' ? onResume() : onStart(nudge.assignmentId))}>
        {verb[nudge.action]}
      </button>
      <button type="button" className="link" disabled={dismiss.busy} onClick={() => dismiss.run(() => send({ type: 'nudge:dismiss', assignmentId: nudge.assignmentId }))}>
        Not now
      </button>
    </div>
  );
}

/**
 * While the panel is visible on one assignment (its detail or its chat), tells
 * the worker once a minute (presence:viewing). It feeds only the nudge rules,
 * and only runs while nudges are on; a hidden panel sends nothing.
 */
export function usePresence(assignmentId: string | null, send: PanelApi['send']): void {
  useEffect(() => {
    if (!assignmentId) return;
    const ping = () => {
      if (document.visibilityState === 'visible') void send({ type: 'presence:viewing', assignmentId });
    };
    ping();
    const id = setInterval(ping, 60_000);
    return () => clearInterval(id);
  }, [assignmentId, send]);
}
