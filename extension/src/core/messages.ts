// Typed messages from extension pages to the service worker. The worker parses
// every message with this schema and ignores senders outside the extension.
import { z } from 'zod';

export const messageSchema = z.discriminatedUnion('type', [
  /** Sent after the page's own permissions.request succeeded for this origin. */
  z.object({ type: z.literal('canvas:connect'), origin: z.string() }),
  z.object({ type: z.literal('canvas:refresh') }),
  /** Sent after the page's permissions.request for the broker origin succeeded (when enabling). */
  z.object({ type: z.literal('ai:set'), enabled: z.boolean() }),
  /** The student's answer about the teacher's AI policy, for one assignment or a whole course. */
  z.object({
    type: z.literal('policy:answer'),
    key: z.string(),
    value: z.enum(['teacher-allows-help', 'teacher-forbids-ai', 'not-sure']),
  }),
  /** Starts (or switches to) the one active work session and opens the linked Doc. */
  z.object({ type: z.literal('session:start'), assignmentId: z.string() }),
  z.object({ type: z.literal('session:pause') }),
  z.object({ type: z.literal('session:resume') }),
  /** Stops all Doc reads and capture for the session. */
  z.object({ type: z.literal('session:end') }),
  /** Sent after the page's permissions.request for DOCS_ORIGINS succeeded. */
  z.object({ type: z.literal('doc:link'), assignmentId: z.string(), docUrl: z.string() }),
  z.object({ type: z.literal('source:remove'), id: z.string() }),
  z.object({ type: z.literal('help:ask'), assignmentId: z.string(), text: z.string().min(1).max(2_000) }),
  z.object({ type: z.literal('help:review'), assignmentId: z.string() }),
  z.object({ type: z.literal('hint:dismiss'), id: z.number() }),
]);

/** Origins a page must request (in the click handler) before sending doc:link. */
export const DOCS_ORIGINS = ['https://docs.google.com/*', 'https://*.googleusercontent.com/*'];

export type Message = z.infer<typeof messageSchema>;
export type Reply = { ok: true } | { ok: false; error: string };

export function sendMessage(message: Message): Promise<Reply> {
  return browser.runtime.sendMessage(message);
}
