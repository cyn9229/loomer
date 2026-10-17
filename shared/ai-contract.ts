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
