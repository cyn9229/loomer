// Canvas-shaped replay. It answers only the API routes the extension's Canvas
// adapter reads, with the same response shapes, so the demo runs the real
// adapter code. Every response carries x-loomer-replay so it cannot pass as live.
import { Hono } from 'hono';
import { dueAt, fixtureAssignments, fixtureCourses, fixtureUser, type FixtureAssignment, type FixtureContext } from './fixture.ts';

export function replayRoutes(demoDocUrl: string) {
  let ctx: FixtureContext = { anchor: Date.now(), demoDocUrl };

  const origin = (url: string) => new URL(url).origin;
  const assignmentJson = (a: FixtureAssignment, base: string) => ({
    id: a.id,
    course_id: a.courseId,
    name: a.name,
    description: a.description(ctx),
    due_at: dueAt(a, ctx.anchor),
    points_possible: a.points,
    html_url: `${base}/courses/${a.courseId}/assignments/${a.id}`,
    updated_at: new Date(ctx.anchor).toISOString(),
    submission_types: ['online_text_entry'],
    ...(a.rubric ? { rubric: a.rubric } : {}),
  });

  return new Hono()
    .use('*', async (c, next) => {
      await next();
      c.header('x-loomer-replay', '1');
    })
    .post('/replay/reset', (c) => {
      ctx = { ...ctx, anchor: Date.now() };
      return c.json({ ok: true, anchor: new Date(ctx.anchor).toISOString() });
    })
    .get('/api/v1/users/self', (c) => c.json(fixtureUser))
    .get('/api/v1/courses', (c) => c.json(fixtureCourses.map(({ id, name }) => ({ id, name }))))
    .get('/api/v1/planner/items', (c) => {
      const start = Date.parse(c.req.query('start_date') ?? '') || -Infinity;
      const end = Date.parse(c.req.query('end_date') ?? '') || Infinity;
      const items = fixtureAssignments.flatMap((a) => {
        const due = dueAt(a, ctx.anchor);
        if (!due || Date.parse(due) < start || Date.parse(due) > end) return [];
        return [
          {
            plannable_id: a.id,
            plannable_type: 'assignment',
            course_id: a.courseId,
            plannable_date: due,
            html_url: `/courses/${a.courseId}/assignments/${a.id}`,
            context_name: fixtureCourses.find((course) => course.id === a.courseId)?.name,
            plannable: { title: a.name, due_at: due, points_possible: a.points, updated_at: new Date(ctx.anchor).toISOString() },
            submissions: { submitted: a.submitted, excused: false, missing: false, late: false, graded: false },
          },
        ];
      });
      return c.json(items);
    })
    .get('/api/v1/courses/:courseId', (c) => {
      const course = fixtureCourses.find((x) => x.id === Number(c.req.param('courseId')));
      return course ? c.json({ id: course.id, name: course.name, syllabus_body: course.syllabus }) : c.json({ errors: [] }, 404);
    })
    .get('/api/v1/courses/:courseId/assignments', (c) => {
      const courseId = Number(c.req.param('courseId'));
      const bucket = c.req.query('bucket');
      const base = origin(c.req.url);
      const list = fixtureAssignments.filter((a) => a.courseId === courseId && (bucket !== 'undated' || a.dueInDays === null));
      return c.json(list.map((a) => assignmentJson(a, base)));
    })
    .get('/api/v1/courses/:courseId/assignments/:id', (c) => {
      const a = fixtureAssignments.find((x) => x.courseId === Number(c.req.param('courseId')) && x.id === Number(c.req.param('id')));
      return a ? c.json(assignmentJson(a, origin(c.req.url))) : c.json({ errors: [] }, 404);
    });
}
