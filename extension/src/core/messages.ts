// Typed messages from extension pages to the service worker. The worker parses
// every message with this schema and ignores senders outside the extension.
import { z } from 'zod';
import { planChangeItemSchema } from '../../../shared/chat-contract';
import { PREP_FORMATS } from '../../../shared/ai-contract';

const exclusionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('host'), host: z.string().min(1).max(253), includeSubdomains: z.boolean() }),
  z.object({ kind: z.literal('page'), origin: z.string().url(), path: z.string().startsWith('/') }),
]);

/** What the student can set on work they add by hand. dueAt is an ISO time; a day with no time is 11:59 PM local. */
const addedFieldsSchema = {
  title: z.string().trim().min(1).max(200),
  courseKey: z.string().max(400).nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  workType: z.enum(['writing', 'practice', 'study', 'reading']).nullable(),
  instructions: z.string().max(20_000).nullable(),
  /** Send only after the page's permissions.request for DOCS_ORIGINS succeeded, as for doc:link. */
  docUrl: z.string().max(2_000).nullable(),
};

const attachmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), name: z.string().max(300), dataUrl: z.string().startsWith('data:image/').max(8_000_000), width: z.number().int().positive(), height: z.number().int().positive(), thumb: z.string().startsWith('data:image/').max(500_000) }),
  z.object({ kind: z.literal('pdf'), name: z.string().max(300), dataUrl: z.string().startsWith('data:application/pdf;base64,').max(14_000_000), bytes: z.number().int().positive() }),
  z.object({ kind: z.literal('text'), name: z.string().max(300), text: z.string().max(100_000), truncated: z.boolean() }),
]);

export const messageSchema = z.discriminatedUnion('type', [
  /** Add work that isn't on Canvas. draftId: the Ask Loomer card it came from, if any. */
  z.object({ type: z.literal('assignment:add'), ...addedFieldsSchema, draftId: z.string().max(100).optional() }),
  /** Change hand-added work. Canvas items can't be edited. */
  z.object({ type: z.literal('assignment:edit'), assignmentId: z.string(), ...addedFieldsSchema }),
  /** Remove hand-added work and everything Loomer kept about it. */
  z.object({ type: z.literal('assignment:delete'), assignmentId: z.string() }),
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
  /** `minutes`: the optional "How much time do you have?" chip. Skipping it sends none. */
  z.object({ type: z.literal('session:start'), assignmentId: z.string(), minutes: z.number().int().min(5).max(600).optional() }),
  /** Set the time the student has from now, or null to clear it ("Keep going"). */
  z.object({ type: z.literal('session:time'), minutes: z.number().int().min(5).max(600).nullable() }),
  z.object({ type: z.literal('session:pause') }),
  z.object({ type: z.literal('session:resume') }),
  /** Stops all Doc reads and capture for the session. */
  z.object({ type: z.literal('session:end') }),
  /** End card, "Done for today": pick one step for next time (SessionModel.nextStep). */
  z.object({ type: z.literal('session:next-step') }),
  /** End card: end the session with where the assignment stands. The kept step feeds Home's Continue line. */
  z.object({
    type: z.literal('session:close'),
    outcome: z.enum(['turned-in', 'for-today']),
    nextStep: z.object({ text: z.string().max(300), aiGenerated: z.boolean() }).optional(),
  }),
  /** Sent after the page's permissions.request for DOCS_ORIGINS succeeded. */
  z.object({ type: z.literal('doc:link'), assignmentId: z.string(), docUrl: z.string() }),
  z.object({ type: z.literal('source:remove'), id: z.string() }),
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
  /** Student corrections. done-offline and turned-in leave the queue (turned-in is "Mark as done" for hand-added work); kept-active keeps it ranked; null clears. */
  z.object({
    type: z.literal('context:set'),
    assignmentId: z.string(),
    correction: z.enum(['done-offline', 'kept-active', 'turned-in']).nullable(),
    note: z.string().max(500).optional(),
  }),
  /** Test prep: start today's practice for this test (written ahead when possible), or `mistakeId`: practice on one earlier wrong answer. The practice view reads usePracticeModel. */
  z.object({ type: z.literal('prep:start'), assignmentId: z.string(), mistakeId: z.string().optional() }),
  /** "Build my plan": set up prep now (or retry a failed setup). */
  z.object({ type: z.literal('prep:setup'), assignmentId: z.string() }),
  /** An answer: choice for multiple choice, text for math and written answers, knew for a flashcard. */
  z.object({ type: z.literal('prep:answer'), practiceId: z.string(), questionId: z.string(), choice: z.number().int().min(0).max(9).optional(), text: z.string().max(8_000).optional(), knew: z.boolean().optional(), confidence: z.enum(['sure', 'guessing']).optional() }),
  /** "Try one like it": a new question on the same idea, shown next. */
  z.object({ type: z.literal('prep:like'), practiceId: z.string(), questionId: z.string() }),
  /** "How much time can you give this test today?" (15, 30, 60, or 90 for More). */
  z.object({ type: z.literal('prep:time'), assignmentId: z.string(), minutes: z.number().int().min(5).max(600) }),
  /** A reminder for a later-today session. Request Chrome's notifications permission first when turning it on. */
  z.object({ type: z.literal('prep:remind'), assignmentId: z.string(), sessionId: z.string(), on: z.boolean() }),
  z.object({ type: z.literal('prep:next'), practiceId: z.string() }),
  /** End now; the summary shows, and one line goes into the test's chat. */
  z.object({ type: z.literal('prep:end'), practiceId: z.string() }),
  /** Close the finished practice view. */
  z.object({ type: z.literal('prep:close'), practiceId: z.string() }),
  z.object({ type: z.literal('prep:topics-edit'), assignmentId: z.string(), remove: z.array(z.string()).optional(), add: z.array(z.string().max(120)).max(10).optional(), keep: z.array(z.string()).optional() }),
  z.object({ type: z.literal('prep:format-set'), assignmentId: z.string(), formats: z.array(z.enum(PREP_FORMATS)).max(5) }),
  /** Photos of paper notes (image attachments from readAttachment). Sent to the AI once, not kept. */
  z.object({ type: z.literal('prep:notes'), assignmentId: z.string(), attachments: z.array(attachmentSchema).min(1).max(6) }),
  /** "What got in the way?" for the start missed on `missedOn` (NextAction.slip), or dismissed. */
  z.object({
    type: z.literal('slip:answer'),
    assignmentId: z.string(),
    missedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.enum(['too-big', 'not-sure', 'no-time', 'not-feeling-it', 'dismissed']),
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
  /** A message, with up to 5 attachments from readAttachment / captureScreen. Text may be empty when something is attached. */
  z
    .object({ type: z.literal('chat:send'), threadKey: z.string().min(1), text: z.string().max(4_000), attachments: z.array(attachmentSchema).max(5).optional() })
    .refine((m) => m.text.trim().length > 0 || (m.attachments?.length ?? 0) > 0),
  /** The composer took the screenshots waiting in chatInboxItem (or the student removed them). */
  z.object({ type: z.literal('chat:inbox-clear') }),
  /** Stop the reply being written in this thread. */
  z.object({ type: z.literal('chat:stop'), threadKey: z.string().min(1) }),
  /** Delete this thread's messages from this computer. */
  z.object({ type: z.literal('chat:clear'), threadKey: z.string().min(1) }),
  /** The student opened this thread; Ask Loomer opens on it next time (askThreadItem). */
  z.object({ type: z.literal('chat:open'), threadKey: z.string().min(1) }),
  /** "Start fresh": set the thread's conversation aside (kept, out of the AI's history). Undo is chat:restore. */
  z.object({ type: z.literal('chat:set-aside'), threadKey: z.string().min(1) }),
  /** Bring a set-aside conversation back into its thread, in time order. */
  z.object({ type: z.literal('chat:restore'), id: z.string().min(1) }),
  /** Re-check whether the local AI service is running (for example when the panel opens). */
  z.object({ type: z.literal('ai:check') }),
  /** Hide today's brief; it returns tomorrow. */
  z.object({ type: z.literal('brief:dismiss') }),
  /** Apply a proposed plan change. Fails with a new preview if the plan moved since the card was made. */
  z.object({ type: z.literal('plan:apply'), changeId: z.string().max(100) }),
  /** "Not now" on a proposed plan change. */
  z.object({ type: z.literal('plan:dismiss'), changeId: z.string().max(100) }),
  /** Put back what an applied change replaced. */
  z.object({ type: z.literal('plan:undo'), changeId: z.string().max(100) }),
  /** A panel control (workload picker, "Roughly how much is left?"): check and apply at once. Listed in Your changes with Undo. */
  z.object({ type: z.literal('plan:set'), changes: z.array(planChangeItemSchema).min(1).max(10) }),
  /** Settings: minutes a "some" or "little" day gives work with a time guess. */
  z.object({ type: z.literal('room:minutes'), some: z.number().int().min(0).max(1_440), little: z.number().int().min(0).max(1_440) }),
  /** The panel is visible on this assignment (detail or its chat). Sent once a minute; feeds the nudge rules only. */
  z.object({ type: z.literal('presence:viewing'), assignmentId: z.string() }),
  /** "Not now" on a nudge: mutes nudges for this assignment for 2 hours. */
  z.object({ type: z.literal('nudge:dismiss'), assignmentId: z.string() }),
  /** Settings: nudges on or off. */
  z.object({ type: z.literal('nudge:set'), enabled: z.boolean() }),
  /** Skip a sheet topic (for example the teacher dropped it), or bring it back. */
  z.object({ type: z.literal('topic:skip'), assignmentId: z.string(), topic: z.string().min(1).max(60), skipped: z.boolean() }),
  /** One tap on a sheet topic: ask in that assignment's Ask Loomer thread. The reply streams there. */
  z.object({ type: z.literal('topic:help'), assignmentId: z.string(), topic: z.string().min(1).max(60), mode: z.enum(['explain', 'example', 'check']) }),
  /** A quick-check answer was checked in the panel: right or wrong only. Sets the topic's standing. */
  z.object({ type: z.literal('quiz:answer'), quizId: z.string().max(100), questionIndex: z.number().int().min(0).max(10), correct: z.boolean() }),
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
