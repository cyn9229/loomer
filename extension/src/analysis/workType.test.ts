import { describe, expect, it } from 'vitest';
import type { Analysis, Assignment } from '../core/db';
import { isQuiz, workTypeFor } from './workType';

const a = (title: string, over: Partial<Assignment> = {}, submissionTypes: string[] = []): Assignment => ({
  id: title,
  sourceKey: 'k',
  origin: 'https://s.test',
  replay: false,
  kind: 'assignment',
  canvasId: '1',
  courseId: '1',
  courseName: null,
  title,
  url: null,
  dueAt: null,
  pointsPossible: null,
  submission: null,
  firstSeenAt: '',
  lastSeenAt: '',
  presence: 'seen-in-last-check',
  detail: { observedAt: '', hash: 'h', text: '', links: [], rubric: [], submissionTypes, canvasUpdatedAt: null },
  detailError: null,
  ...over,
});
const type = (x: Assignment) => workTypeFor(x, null, undefined).type;

describe('work type rules', () => {
  it('reads title words, as whole words only', () => {
    expect(type(a('Unit 1 Corr.'))).toBe('practice');
    expect(type(a('Ch. 6 vocabulary check'))).toBe('study');
    expect(type(a('Lab reflection'))).toBe('writing');
    expect(type(a('Read Ch. 5 of Gatsby'))).toBe('reading');
    expect(type(a('Ready, set, go'))).toBe('writing');
  });

  it('falls back to the submission type, and treats discussions as writing', () => {
    expect(type(a('Unit 2: Conic Sections', {}, ['on_paper']))).toBe('practice');
    expect(type(a('Unit 2: Conic Sections', {}, ['online_upload']))).toBe('writing');
    expect(type(a('Week 3 thread', { kind: 'discussion_topic' }))).toBe('writing');
  });

  it('lets the student beat the AI, and the AI beat the rules', () => {
    const sheet = a('Unit 2: Conic Sections', {}, ['online_upload']);
    const analysis = { ...okAnalysis, workType: 'practice' as const };
    expect(workTypeFor(sheet, analysis, undefined)).toEqual({ type: 'practice', source: 'ai' });
    expect(workTypeFor(sheet, analysis, { key: sheet.id, workType: 'study' })).toEqual({ type: 'study', source: 'student' });
  });
});

describe('quiz rule', () => {
  it('marks Canvas quizzes, online-quiz submissions, and tests in outside tools', () => {
    expect(isQuiz(a('Unit 2 Quiz', { kind: 'quiz' }))).toBe(true);
    expect(isQuiz(a('Checkpoint', {}, ['online_quiz']))).toBe(true);
    expect(isQuiz(a('Unit 3 Test', {}, ['external_tool']))).toBe(true);
    expect(isQuiz(a('Desmos activity', {}, ['external_tool']))).toBe(false);
    expect(isQuiz(a('Unit 3 Test review', {}, ['on_paper']))).toBe(false);
  });

  it('keeps a quiz as study work even if the AI read it differently', () => {
    expect(workTypeFor(a('Unit 2 Quiz', { kind: 'quiz' }), { ...okAnalysis, workType: 'writing' }, undefined)).toEqual({ type: 'study', source: 'rule' });
  });
});

const okAnalysis: Extract<Analysis, { status: 'ok' }> = {
  assignmentId: 'x',
  detailHash: 'h',
  status: 'ok',
  createdAt: '',
  model: 'm',
  effort: 'Moderate',
  effortReason: { text: '', quote: '' },
  deliverables: [],
  milestones: [],
  firstStep: '',
};
