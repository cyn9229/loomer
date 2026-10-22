import { describe, expect, it } from 'vitest';
import type { Analysis, Assignment, Course, WaitRecord } from '../core/db';
import { assignmentPolicy, effectiveDue } from './facts';
import { readStateOf } from './read';

const now = new Date(2026, 9, 22, 12, 0);
const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  id: 'a', sourceKey: 'k', origin: 'https://s.test', replay: false, kind: 'assignment', canvasId: 'a', courseId: '1', courseName: 'History',
  title: 'Imperialism essay', url: null, dueAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(), pointsPossible: null, submission: null,
  firstSeenAt: '', lastSeenAt: '', presence: 'seen-in-last-check',
  detail: { observedAt: '', hash: 'h1', text: 'Compare two cases of imperialism.', links: [], rubric: [], submissionTypes: [], canvasUpdatedAt: null },
  detailError: null,
  ...over,
});
const ok = (hash: string): Analysis => ({
  assignmentId: 'a', detailHash: hash, status: 'ok', createdAt: '2026-10-22T10:00:00.000Z', model: 'm', version: 3, effort: 'Moderate',
  effortReason: { text: '', quote: '' }, deliverables: [{ text: 'An essay', quote: 'q' }, { text: 'A source list', quote: 'q' }],
  milestones: [{ text: 'Outline', quote: 'q', date: null, daysBeforeDue: 2 }], firstStep: 'Pick your two cases',
});
const reading = (startedAt: string): WaitRecord => ({ key: 'analysis:a', task: 'analysis', startedAt, failed: null });
const course: Course = { id: 'k#course:1', sourceKey: 'k', canvasId: '1', name: 'History', syllabus: { observedAt: '', hash: 's', text: 'Welcome to world history.' }, syllabusError: null };
const stateOf = (a: Assignment, stored: Analysis | undefined, wait?: WaitRecord, aiEnabled = true) =>
  readStateOf(a, stored, assignmentPolicy(a, course), undefined, effectiveDue(a, now), { aiEnabled, wait, times: new Map() }, now);

describe('read state', () => {
  it('reads, then says what it found', () => {
    expect(stateOf(assignment(), undefined)).toMatchObject({ state: 'waiting', reason: null });
    expect(stateOf(assignment(), undefined, reading(new Date(now.getTime() - 5_000).toISOString()))).toMatchObject({ state: 'reading', pending: { title: 'Reading the instructions', usualSec: [14, 90] } });
    expect(stateOf(assignment(), ok('h1'))).toMatchObject({ state: 'read', at: '2026-10-22T10:00:00.000Z', found: 'Found 2 things to hand in and 1 checkpoint' });
  });

  it('says changed when the teacher edited the instructions', () => {
    expect(stateOf(assignment(), ok('old'))).toMatchObject({ state: 'changed', pending: null });
    expect(stateOf(assignment(), ok('old'), reading(now.toISOString()))).toMatchObject({ state: 'changed', pending: { title: 'Reading the new instructions' } });
  });

  it('fails a read that ran past three times its usual high, and gives a retry time after a failed reply', () => {
    expect(stateOf(assignment(), undefined, reading(new Date(now.getTime() - 300_000).toISOString()))).toMatchObject({ state: 'failed', retryAt: null });
    const failed: Analysis = { assignmentId: 'a', detailHash: 'h1', status: 'failed', createdAt: new Date(now.getTime() - 60_000).toISOString(), error: 'x' };
    expect(stateOf(assignment(), failed)).toMatchObject({ state: 'failed', retryAt: new Date(now.getTime() + 540_000).toISOString() });
  });

  it('names why it will not or cannot read', () => {
    expect(stateOf(assignment(), undefined, undefined, false)).toMatchObject({ state: 'blocked', reason: 'ai-off' });
    expect(stateOf(assignment({ detail: null, detailError: 'denied' }), undefined)).toMatchObject({ state: 'empty', reason: 'page-closed' });
    expect(stateOf(assignment({ dueAt: new Date(now.getTime() + 30 * 86_400_000).toISOString() }), undefined)).toMatchObject({ state: 'waiting', reason: 'later' });
    expect(stateOf(assignment({ addedBy: 'student' }), undefined)).toBeNull();
  });
});
