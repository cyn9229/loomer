// The request and response contract between the extension and the local AI
// broker. Both sides import this file so the shapes cannot drift. It may only
// import zod.
import { z } from 'zod';

export const REQUIREMENTS_ROUTE = '/ai/requirements';

/** Only bounded school-provided text. Never the student's draft. */
export const requirementsRequestSchema = z.strictObject({
  title: z.string().max(300),
  courseName: z.string().max(200).nullable(),
  dueAt: z.string().nullable(),
  instructions: z.string().max(12_000),
  rubric: z.array(z.strictObject({ description: z.string().max(1_000), points: z.number().nullable() })).max(30),
});

const quoted = z.strictObject({
  /** Loomer's plain-language statement. */
  text: z.string(),
  /** Exact passage copied from the instructions or rubric that supports it. */
  quote: z.string(),
});

export const requirementsResponseSchema = z.strictObject({
  effort: z.enum(['Short', 'Moderate', 'Substantial', 'Unknown']),
  effortReason: quoted,
  deliverables: z.array(quoted),
  milestones: z.array(quoted),
  /** One concrete first step that starts with a verb and does not do the work. */
  firstStep: z.string(),
});

export type RequirementsRequest = z.infer<typeof requirementsRequestSchema>;
export type RequirementsResponse = z.infer<typeof requirementsResponseSchema>;

/** Broker reply envelope. `model` is reported so the evidence can name it. */
export type BrokerReply<T> = { ok: true; model: string; result: T } | { ok: false; error: string };

/** Client-side check of the envelope; `result` is then parsed with the task's own schema. */
export const brokerEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), model: z.string(), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

const rubricItems = z.array(z.strictObject({ description: z.string().max(1_000), points: z.number().nullable() })).max(30);

/** How much of the student's work was readable and sent. Reviews must state it. */
export const workScope = z.enum(['full', 'partial', 'none']);

export const HELP_ROUTE = '/ai/help';

/** Hint-first help on the student's own work. Requires the work-help AI check. */
export const helpRequestSchema = z.strictObject({
  title: z.string().max(300),
  instructions: z.string().max(12_000),
  rubric: rubricItems,
  studentWork: z.string().max(15_000),
  workScope,
  history: z.array(z.strictObject({ role: z.enum(['student', 'loomer']), text: z.string().max(2_000) })).max(8),
  question: z.string().max(2_000),
});

const reference = z.strictObject({ quote: z.string(), from: z.enum(['your draft', 'the instructions']) });

export const helpResponseSchema = z.strictObject({
  /** redirect: Loomer declined to do the work and offers a teaching alternative. */
  kind: z.enum(['hint', 'explanation', 'question', 'example', 'redirect']),
  reply: z.string(),
  references: z.array(reference),
});

export const REVIEW_ROUTE = '/ai/review';

export const reviewRequestSchema = z.strictObject({
  title: z.string().max(300),
  instructions: z.string().max(12_000),
  rubric: rubricItems,
  studentWork: z.string().max(15_000),
  workScope,
});

export const reviewResponseSchema = z.strictObject({
  /** One sentence naming what was reviewed and its scope. */
  summary: z.string(),
  findings: z
    .array(
      z.strictObject({
        issue: z.string(),
        /** Exact passage from the student's draft the issue concerns. */
        quote: z.string(),
        criterion: z.string(),
        /** A revision question for the student. Never replacement text. */
        question: z.string(),
      }),
    )
    .max(3),
});

export type HelpRequest = z.infer<typeof helpRequestSchema>;
export type HelpResponse = z.infer<typeof helpResponseSchema>;
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

export const HINT_ROUTE = '/ai/hint';

/** Fixed issue types, so a reworded hint about a dismissed issue is still recognized. */
export const HINT_ISSUES = [
  'claim-unsupported',
  'evidence-unexplained',
  'comparison-missing',
  'summary-without-analysis',
  'citation-missing',
  'unclear-sentence',
  'organization',
  'requirement-not-addressed',
  'other',
] as const;

/** One unprompted hint after a pause. Only sent when the proactive rules allow it. */
export const hintRequestSchema = z.strictObject({
  title: z.string().max(300),
  instructions: z.string().max(12_000),
  rubric: rubricItems,
  studentWork: z.string().max(15_000),
  workScope,
  /** Lines the student added since the last check; the hint should concern these. */
  recentChange: z.string().max(3_000),
  /** Issue types the student dismissed; never raise them again. */
  dismissedIssues: z.array(z.enum(HINT_ISSUES)).max(HINT_ISSUES.length),
});

export const hintResponseSchema = z.strictObject({
  /** False when there is no clearly useful hint right now. That is the expected common case. */
  useful: z.boolean(),
  hint: z.string(),
  /** Exact passage from the student's draft the hint points to. */
  quote: z.string(),
  issueKey: z.enum(HINT_ISSUES),
});

export type HintRequest = z.infer<typeof hintRequestSchema>;
export type HintResponse = z.infer<typeof hintResponseSchema>;
