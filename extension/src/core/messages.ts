// Typed messages from extension pages to the service worker. The worker parses
// every message with this schema and ignores senders outside the extension.
import { z } from 'zod';

const exclusionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('host'), host: z.string().min(1).max(253), includeSubdomains: z.boolean() }),
  z.object({ kind: z.literal('page'), origin: z.string().url(), path: z.string().startsWith('/') }),
]);

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
  /** Dismiss a proactive hint; its issue type is not raised again for this assignment. */
  z.object({ type: z.literal('hint:dismiss'), id: z.number() }),
  /** The panel showed the hint; clears the toolbar badge. */
  z.object({ type: z.literal('hint:seen') }),
  z.object({ type: z.literal('proactive:set'), enabled: z.boolean(), delaySec: z.number().int().min(30).max(600) }),
  z.object({ type: z.literal('resume:dismiss'), assignmentId: z.string() }),
  /** Turning discovery on is sent after the page's permissions.request({ permissions: ['tabs'] }) succeeded. */
  z.object({ type: z.literal('discovery:set'), enabled: z.boolean() }),
  /** Sent after the page's permissions.request for that tab's origin succeeded. */
  z.object({ type: z.literal('suggestion:add'), tabId: z.number() }),
  /** Stops suggestions for the rest of this session. */
  z.object({ type: z.literal('suggestion:dismiss') }),
  /** Pause all observation: Canvas checks, Doc reads, capture, discovery. Never auto-resumes a session. */
  z.object({ type: z.literal('privacy:pause'), paused: z.boolean() }),
  /** Block a host or page. deleteSaved also removes saved pages it covers. */
  z.object({ type: z.literal('exclusion:add'), rule: exclusionSchema, deleteSaved: z.boolean() }),
  z.object({ type: z.literal('exclusion:remove'), rule: exclusionSchema }),
  /** Remove Loomer's data for one assignment (analysis, chat, hints, pages, Doc link, sessions). */
  z.object({ type: z.literal('data:delete-assignment'), assignmentId: z.string() }),
  /** Remove everything Loomer stored and the access it was granted, then return to setup. */
  z.object({ type: z.literal('data:clear-all') }),
  /** Check the linked draft against the requirements (AI on the student's work; needs work-help permission). */
  z.object({ type: z.literal('requirements:check'), assignmentId: z.string() }),
  /** Student corrections. done-offline leaves the queue; kept-active keeps it ranked; null clears. */
  z.object({
    type: z.literal('context:set'),
    assignmentId: z.string(),
    correction: z.enum(['done-offline', 'kept-active']).nullable(),
    note: z.string().max(500).optional(),
  }),
  /** The student chose what to work on; kept until relevant evidence changes. */
  z.object({ type: z.literal('choice:set'), assignmentId: z.string() }),
  /** Ask Loomer to reconsider: drop the remembered choice. */
  z.object({ type: z.literal('choice:clear') }),
  /** The older-work review was seen; these items will not be raised again without new evidence. */
  z.object({ type: z.literal('older:reviewed'), assignmentIds: z.array(z.string()) }),
  /** Desktop notifications: sent after the page's permissions.request({ permissions: ['notifications'] }) when enabling. */
  z.object({ type: z.literal('notify:set'), enabled: z.boolean() }),
  /** Crop (in image pixels) and save the pending screenshot, or discard it. Nothing is saved before this. */
  z.object({
    type: z.literal('screenshot:save'),
    crop: z.object({ x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive() }),
  }),
  z.object({ type: z.literal('screenshot:cancel') }),
  /** Ask Loomer: send a message in a thread ("general" or an assignment id). The reply streams into the store. */
  z.object({ type: z.literal('chat:send'), threadKey: z.string().min(1), text: z.string().min(1).max(4_000) }),
  /** Stop the reply being written in this thread. */
  z.object({ type: z.literal('chat:stop'), threadKey: z.string().min(1) }),
  /** Delete this thread's messages from this computer. */
  z.object({ type: z.literal('chat:clear'), threadKey: z.string().min(1) }),
  /** Re-check whether the local AI service is running (for example when the panel opens). */
  z.object({ type: z.literal('ai:check') }),
  /** Hide today's brief; it returns tomorrow. */
  z.object({ type: z.literal('brief:dismiss') }),
  /** Hide or restore an item in "Other work". Never affects Canvas. */
  z.object({ type: z.literal('item:hide'), assignmentId: z.string(), hidden: z.boolean() }),
]);

/** Origins a page must request (in the click handler) before sending doc:link. */
export const DOCS_ORIGINS = ['https://docs.google.com/*', 'https://*.googleusercontent.com/*'];

export type Message = z.infer<typeof messageSchema>;
export type Reply = { ok: true } | { ok: false; error: string };

export function sendMessage(message: Message): Promise<Reply> {
  return browser.runtime.sendMessage(message);
}
