// What kind of work an assignment is, and whether it is a quiz taken in Canvas.
// The student's own choice wins, then the AI's reading of the instructions,
// then local rules over the Canvas kind, submission type, and title.
import type { Analysis, Assignment, StudentContext } from '../core/db';
import type { WorkItem, WorkType } from '../model/home';

/** Title words, checked in order. A word must stand alone ("read" matches, "ready" does not). */
const TITLE_RULES: [RegExp, WorkType][] = [
  [/(?<![a-z])(study guide|test|exam|midterm|vocab|vocabulary|flash ?cards?)(?![a-z])/i, 'study'],
  [/(?<![a-z])(worksheet|problem set|problems|practice|corrections?|corr\.|homework|hw|exercises?|packet)(?![a-z])/i, 'practice'],
  [/(?<![a-z])(essay|paper|response|reflection|report|journal|draft|paragraph|letter|summary|write|writing)(?![a-z])/i, 'writing'],
  [/(?<![a-z])(read|reading|chapter|ch\.|article|annotate|annotations?)(?![a-z])/i, 'reading'],
];
const TEST_WORDS = /(?<![a-z])(test|exam|quiz|midterm|final)(?![a-z])/i;

/** A quiz or test the student takes online: a Canvas quiz, an online-quiz submission, or a test run in an outside tool. */
export function isQuiz(a: Assignment): boolean {
  const types = a.detail?.submissionTypes ?? [];
  return a.kind === 'quiz' || types.includes('online_quiz') || (types.includes('external_tool') && TEST_WORDS.test(a.title));
}

function ruleType(a: Assignment): WorkType {
  if (isQuiz(a)) return 'study';
  if (a.kind === 'discussion_topic') return 'writing';
  const byTitle = TITLE_RULES.find(([re]) => re.test(a.title));
  if (byTitle) return byTitle[1];
  const types = a.detail?.submissionTypes ?? [];
  if (types.includes('online_text_entry') || types.includes('online_upload')) return 'writing';
  return types.length > 0 ? 'practice' : 'writing';
}

export function workTypeFor(a: Assignment, analysis: Extract<Analysis, { status: 'ok' }> | null, ctx: StudentContext | undefined): WorkItem['workType'] {
  if (ctx?.workType) return { type: ctx.workType, source: 'student' };
  // A quiz is always study work around the quiz itself, whatever its instructions say.
  if (!isQuiz(a) && analysis?.workType) return { type: analysis.workType, source: 'ai' };
  return { type: ruleType(a), source: 'rule' };
}

export const WORK_TYPE_WORDS: Record<WorkType, string> = { writing: 'Writing', practice: 'Practice', study: 'Study', reading: 'Reading' };
