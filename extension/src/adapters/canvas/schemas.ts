// Zod schemas for the Canvas API responses the adapter reads. z.object strips
// unknown keys, so names, emails, scores, and other fields never reach storage.
import { z } from 'zod';

const id = z.union([z.number(), z.string()]).transform(String);

export const selfSchema = z.object({ id });

export const courseSchema = z.object({ id, name: z.string() });

export const courseSyllabusSchema = courseSchema.extend({ syllabus_body: z.string().nullish() });

export const plannerItemSchema = z.object({
  plannable_id: id,
  plannable_type: z.string(),
  course_id: id.optional(),
  plannable_date: z.string(),
  html_url: z.string().nullish(),
  context_name: z.string().nullish(),
  plannable: z.object({
    title: z.string(),
    due_at: z.string().nullish(),
    points_possible: z.number().nullish(),
    updated_at: z.string().nullish(),
  }),
  // Canvas sends `false` when submissions do not apply.
  submissions: z
    .union([
      z.literal(false),
      z.object({
        submitted: z.boolean().default(false),
        excused: z.boolean().default(false),
        missing: z.boolean().default(false),
        late: z.boolean().default(false),
      }),
    ])
    .optional(),
});

export const assignmentSchema = z.object({
  id,
  course_id: id,
  name: z.string(),
  description: z.string().nullish(),
  due_at: z.string().nullish(),
  points_possible: z.number().nullish(),
  html_url: z.string().nullish(),
  updated_at: z.string().nullish(),
  submission_types: z.array(z.string()).default([]),
  rubric: z
    .array(z.object({ description: z.string().nullish(), long_description: z.string().nullish(), points: z.number().nullish() }))
    .optional(),
});

export type PlannerItem = z.infer<typeof plannerItemSchema>;
export type CanvasAssignment = z.infer<typeof assignmentSchema>;

/** Classic quiz: the description holds the teacher's instructions. */
export const quizSchema = z.object({
  id,
  title: z.string(),
  description: z.string().nullish(),
  due_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});

/** Discussion topic: `message` is the teacher's prompt. Replies are a different route and never read. */
export const discussionSchema = z.object({
  id,
  title: z.string(),
  message: z.string().nullish(),
  updated_at: z.string().nullish(),
});
