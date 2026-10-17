// Demonstration material for the labeled Canvas replay. Every name says
// "(Replay)". Dates are relative to the last reset so the demo never expires.

const DAY_MS = 86_400_000;

export type FixtureAssignment = {
  id: number;
  courseId: number;
  name: string;
  /** Days from reset; null means no due date in Canvas. Due times are 23:59 UTC. */
  dueInDays: number | null;
  points: number;
  submitted: boolean;
  description: (ctx: FixtureContext) => string;
  rubric?: { description: string; long_description?: string; points: number }[];
};

export type FixtureContext = { anchor: number; demoDocUrl: string };

export const fixtureUser = { id: 900001 };

export const fixtureCourses = [
  { id: 101, name: 'English 10 (Replay)', syllabus: '<p>Essays are drafted in Google Docs. Cite every source you use.</p>' },
  { id: 102, name: 'Biology (Replay)', syllabus: '<p>Weekly lab notes and short responses.</p>' },
];

export const fixtureAssignments: FixtureAssignment[] = [
  {
    id: 5001,
    courseId: 101,
    name: 'Urban heat islands: comparative essay',
    dueInDays: 5,
    points: 100,
    submitted: false,
    description: ({ demoDocUrl }) => `
      <p>Write a 900 to 1200 word essay comparing how two sources explain urban heat islands and the role of tree cover.</p>
      <ul>
        <li>Summarize the main claim of each source.</li>
        <li>Compare the evidence each source uses. Explain where they agree and where they differ.</li>
        <li>Develop your own argument about what a city should prioritize.</li>
        <li>Cite both sources in MLA format.</li>
      </ul>
      <p>Draft in the linked document: <a href="${demoDocUrl}">Heat island essay draft</a>.</p>
      <p>A full draft is due for peer review on the day before the final deadline.</p>`,
    rubric: [
      { description: 'Accurate summary of both sources', points: 20 },
      { description: 'Comparison of evidence', long_description: 'Explains how the evidence in each source supports or weakens its claim.', points: 30 },
      { description: 'Original argument', points: 30 },
      { description: 'Citations and conventions', points: 20 },
    ],
  },
  {
    id: 5002,
    courseId: 102,
    name: 'Photosynthesis short response',
    dueInDays: 1,
    points: 10,
    submitted: false,
    description: () => '<p>Answer in 3 to 5 sentences: why do leaves change color in autumn? Use the term chlorophyll.</p>',
  },
  {
    id: 5003,
    courseId: 101,
    name: 'Research proposal',
    dueInDays: null,
    points: 20,
    submitted: false,
    description: ({ anchor }) =>
      `<p>Submit a one-paragraph proposal for your next research topic. The proposal is due ${new Date(anchor + 9 * DAY_MS).toDateString()}.</p>`,
  },
  {
    id: 5004,
    courseId: 102,
    name: 'Lab reflection',
    dueInDays: -3,
    points: 15,
    submitted: false,
    description: () => '<p>Reflect on the enzyme lab in one paragraph.</p>',
  },
  {
    id: 5005,
    courseId: 101,
    name: 'Personal narrative',
    dueInDays: 8,
    points: 50,
    submitted: false,
    description: () =>
      '<p>Write a 600 word personal narrative about a place that matters to you.</p><p>Do not use AI tools such as ChatGPT for any part of this assignment.</p>',
  },
];

export function dueAt(a: FixtureAssignment, anchor: number): string | null {
  if (a.dueInDays === null) return null;
  const d = new Date(anchor + a.dueInDays * DAY_MS);
  d.setUTCHours(23, 59, 0, 0);
  return d.toISOString();
}
