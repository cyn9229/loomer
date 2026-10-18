// The request and response contract between the extension and the local AI
// broker. Both sides import this file so the shapes cannot drift. It may only
// import zod.
import { z } from 'zod';

export const WORK_TYPES = ['writing', 'practice', 'study', 'reading'] as const;
export type WorkKind = (typeof WORK_TYPES)[number];

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

/**
 * An earlier checkpoint. The model reports only what the text states: an explicit
 * date (YYYY-MM-DD) or a number of days before the final deadline. Loomer computes
 * the actual date.
 */
const milestone = z.strictObject({
  text: z.string(),
  quote: z.string(),
  date: z.string().nullable(),
  daysBeforeDue: z.number().int().nullable(),
});

export const requirementsResponseSchema = z.strictObject({
  effort: z.enum(['Short', 'Moderate', 'Substantial', 'Unknown']),
  effortReason: quoted,
  deliverables: z.array(quoted),
  milestones: z.array(milestone),
  /** What the assignment asks, in 2 or 3 plain sentences. Explains the task; never starts it. */
  plainWords: z.string(),
  /** One concrete first step, at most about 9 words, that starts with a verb and does not do the work. */
  firstStep: z.string(),
  /** What kind of work it is, so the session can help the right way. */
  workType: z.enum(WORK_TYPES),
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

/** How to help with each kind of work. Shared by session help and Ask Loomer so both teach the same way. */
export const WORK_TYPE_GUIDANCE: Record<WorkKind, string> = {
  writing: 'This is writing work. Help with ideas, structure, evidence, and clarity through hints and questions about their own draft.',
  practice:
    'This is practice work: problems or exercises to solve. Explain the concept behind a problem, show a worked example with different numbers or a different problem of the same kind, or ask a guiding question about the step they are on. Never give the answer or the steps for their own problem. Offer a quick check on the topic.',
  study:
    'This is study work: preparing for a test or quiz. Help them see what to review, explain topics, and offer to check their understanding. Never answer the actual test or quiz questions.',
  reading:
    'This is reading work. Explain key terms and background, and ask questions that check understanding. Never write their annotations or answers, and never replace the reading with a full summary.',
};

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
  workType: z.enum(WORK_TYPES),
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

export const REQUIREMENTS_CHECK_ROUTE = '/ai/requirements-check';

/** Check the student's draft against a numbered list of requirements. Needs the work-help AI check. */
export const requirementsCheckRequestSchema = z.strictObject({
  title: z.string().max(300),
  instructions: z.string().max(12_000),
  studentWork: z.string().max(15_000),
  workScope,
  requirements: z.array(z.strictObject({ index: z.number().int().min(0), text: z.string().max(1_000) })).max(20),
});

export const requirementsCheckResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      index: z.number().int().min(0),
      /** observed: relevant content found; needs-review: a specific possible issue; unknown: not enough to say. */
      state: z.enum(['observed', 'needs-review', 'unknown']),
      /** Exact passage from the draft for observed or needs-review; empty for unknown. */
      quote: z.string(),
      /** One short sentence; for needs-review, the specific issue. Never replacement text. */
      note: z.string(),
    }),
  ),
});

export type RequirementsCheckRequest = z.infer<typeof requirementsCheckRequestSchema>;
export type RequirementsCheckResponse = z.infer<typeof requirementsCheckResponseSchema>;

export const TOPICS_ROUTE = '/ai/topics';

/** The topics a practice or study sheet covers. Needs the work-help AI check: the sheet may hold the student's answers. */
export const topicsRequestSchema = z.strictObject({
  title: z.string().max(300),
  workType: z.enum(WORK_TYPES),
  /** One to three sheets, in page order; together at most about 15,000 characters. */
  sheets: z.array(z.strictObject({ title: z.string().max(80).nullable(), text: z.string().max(15_000) })).min(1).max(3),
});

export const topicsResponseSchema = z.strictObject({
  topics: z
    .array(
      z.strictObject({
        /** 1 to 5 words naming the topic, e.g. "Ellipses: foci". */
        text: z.string(),
        /** Exact passage from the sheet that shows the topic: a heading or the start of a problem. */
        quote: z.string(),
        /** Which sheet it is on: its position in the request, from 0. */
        sheet: z.number().int().min(0),
      }),
    )
    .max(15),
});

export type TopicsRequest = z.infer<typeof topicsRequestSchema>;
export type TopicsResponse = z.infer<typeof topicsResponseSchema>;
