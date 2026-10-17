import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../model/home';
import { groupByClass } from './group';

function item(id: string, courseKey: string, bucket: WorkItem['bucket'], due: string | null, hidden = false): WorkItem {
  return {
    assignmentId: id,
    title: id,
    courseKey,
    courseName: courseKey.toUpperCase(),
    url: null,
    due: due ? { at: due, source: 'canvas' } : null,
    dueConflict: false,
    effort: { label: 'Unknown', reason: null },
    policy: { state: 'none-found' },
    requirements: 'checked',
    replay: false,
    bucket,
    hidden,
  };
}

describe('groupByClass', () => {
  it('puts the class with the soonest dated work first and keeps undated-only classes', () => {
    const groups = groupByClass([
      item('bio-later', 'bio', 'later', '2026-10-30T12:00:00Z'),
      item('eng-soon', 'eng', 'soon', '2026-10-19T12:00:00Z'),
      item('art-undated', 'art', 'no-date', null),
    ]);
    expect(groups.map((g) => g.courseKey)).toEqual(['eng', 'bio', 'art']);
    expect(groups[2]?.noDate.map((i) => i.assignmentId)).toEqual(['art-undated']);
  });

  it('leaves hidden items out of every class', () => {
    const groups = groupByClass([item('a', 'eng', 'soon', '2026-10-19T12:00:00Z'), item('b', 'eng', 'soon', '2026-10-20T12:00:00Z', true)]);
    expect(groups[0]?.count).toBe(1);
    expect(groups[0]?.soon.map((i) => i.assignmentId)).toEqual(['a']);
  });
});
