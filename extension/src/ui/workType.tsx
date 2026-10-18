// Work types in the UI: the word and icon for each, the help prompts and
// composer text each one gets, and the menu on the assignment that changes the
// type (plan:set work_type, which shows in Your changes with Undo). A quiz or
// test shows as "Quiz" whatever its type, because AI help on it is always off.
import type { WorkItem, WorkType } from '../model/home';
import { useAction, type PanelApi } from './api';
import { Icon, type IconName } from './Icon';
import { usePopover } from './usePopover';

export const workTypeWord: Record<WorkType, string> = { writing: 'Writing', practice: 'Practice', study: 'Study', reading: 'Reading' };

const workTypeHint: Record<WorkType, string> = {
  writing: 'Essays, responses. Links your draft.',
  practice: 'Worksheets, problem sets.',
  study: 'Test prep, review.',
  reading: 'Chapters, articles.',
};

/** What the student sees for an item's kind of work. */
export function typeLabel(item: WorkItem): { icon: IconName; word: string } {
  return item.quiz ? { icon: 'quiz', word: 'Quiz' } : { icon: item.workType.type, word: workTypeWord[item.workType.type] };
}

/** Ready questions under Help for each type. Writing keeps its own follow-ups (Explain more, Smaller step, Check my draft). */
export const typePrompts: Record<Exclude<WorkType, 'writing'>, string[]> = {
  practice: ['Explain this topic', 'Show an example like this one', 'Quiz me'],
  study: ['Quiz me', 'Explain this topic', 'Make me a practice question'],
  reading: ['Explain a term', 'Check my understanding', 'Sum up a chapter'],
};

/** The help box's placeholder for each type. */
export const askHint: Record<WorkType, string> = {
  writing: 'Ask for a hint',
  practice: 'Ask about a topic',
  study: 'Ask about the test',
  reading: 'Ask about the reading',
};

/** One line on what help looks like for each type, before the first question. */
export const typeCaption: Record<WorkType, string> = {
  writing: 'Stuck? Ask about this assignment. Loomer starts with a small hint and never writes it for you.',
  practice: 'Loomer explains the idea and shows a similar example. It won’t do your problems.',
  study: 'Get ready for the test: quiz yourself or ask about a topic.',
  reading: 'Stuck on a word or a part? Ask here.',
};

/** The type next to the class on the assignment. Opens a menu to change it; a quiz has no menu. */
export function TypeMenu({ item, send }: { item: WorkItem; send: PanelApi['send'] }) {
  const { open, setOpen, ref } = usePopover<HTMLDivElement>();
  const save = useAction();
  const label = typeLabel(item);
  if (item.quiz) {
    return (
      <span className="tmenu static">
        <Icon name="quiz" size="xs" />
        Quiz or test
      </span>
    );
  }
  const pick = (type: WorkType) => {
    setOpen(false);
    if (type !== item.workType.type) save.run(() => send({ type: 'plan:set', changes: [{ kind: 'work_type', assignment_id: item.assignmentId, type }] }));
  };
  return (
    <div className="threads" ref={ref}>
      <button type="button" className="tmenu" aria-haspopup="listbox" aria-expanded={open} disabled={save.busy} aria-busy={save.busy} onClick={() => setOpen((o) => !o)}>
        <Icon name={label.icon} size="xs" />
        {label.word}
        <Icon name="chevronDown" size="xs" />
      </button>
      {open && (
        <div className="pop" role="listbox" aria-label="Kind of work">
          {(Object.keys(workTypeWord) as WorkType[]).map((type) => (
            <button key={type} type="button" role="option" aria-selected={type === item.workType.type} className="th" onClick={() => pick(type)}>
              <span className="subject gen">
                <Icon name={type} />
              </span>
              <span className="item-body">
                <span className="item-title">{workTypeWord[type]}</span>
                <span className="item-sub">{workTypeHint[type]}</span>
              </span>
              {type === item.workType.type && <Icon name="check" size="sm" />}
            </button>
          ))}
          <p className="pop-k">{item.workType.source === 'student' ? 'You set this. Undo it in Your changes.' : 'Loomer’s pick. Change it if it’s wrong.'}</p>
        </div>
      )}
      {save.error && <p className="status-line error">{save.error}</p>}
    </div>
  );
}
