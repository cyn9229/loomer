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
]);

export type Message = z.infer<typeof messageSchema>;
export type Reply = { ok: true } | { ok: false; error: string };

export function sendMessage(message: Message): Promise<Reply> {
  return browser.runtime.sendMessage(message);
}
