// Adding an assignment by hand, for work that isn't on Canvas (paper work,
// another class site, something the teacher said in class), and editing or
// deleting one. A sheet with the name and due date up front and the rest under
// More. Without a time, it is due at 11:59 PM that day. Hand-added work ranks
// and gets help like any Canvas item; the student marks it done themselves.
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { EditableFields } from '../model/detail';
import type { AddDraft } from '../model/chat';
import type { CourseOption, WorkType } from '../model/home';
import { useAction, type PanelApi } from './api';
import { dueWhen, ymd } from './format';
import { Icon, type IconName } from './Icon';
import { Sheet } from './sheet';
import { workTypeWord } from './workType';

type AddSheetProps = {
  /** Add a new one (null), or edit one the student added before. */
  editing: EditableFields | null;
  /** Prefill for a new one, e.g. from an Ask Loomer card's Edit first. */
  draft?: Partial<EditableFields>;
  courses: CourseOption[];
  now: Date;
  /** Saves; resolves to an error to show, or null when it worked. */
  save: (fields: EditableFields) => Promise<string | null>;
  /** Editing only: deletes it; resolves to an error to show, or null when it worked. */
  remove?: () => Promise<string | null>;
  onClose: () => void;
};

const DOC_LINK = /^https:\/\/docs\.google\.com\/document\/d\/[\w-]+/;
const KINDS: WorkType[] = ['writing', 'practice', 'study', 'reading'];

/** Splits a due date into the day and, unless it is the 11:59 PM default, the time. */
function splitDue(iso: string | null): { day: string | null; time: string | null } {
  if (!iso) return { day: null, time: null };
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { day: ymd(d), time: time === '23:59' ? null : time };
}

/** The local day and time as an ISO instant; no time means 11:59 PM. */
function joinDue(day: string | null, time: string | null): string | null {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = (time ?? '23:59').split(':').map(Number);
  return new Date(y!, m! - 1, d!, h!, min!).toISOString();
}

export function AddSheet({ editing, draft, courses, now, save, remove, onClose }: AddSheetProps) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const initial = editing ?? draft ?? {};
  const start = splitDue(initial.dueAt ?? null);
  const [title, setTitle] = useState(initial.title ?? '');
  const [day, setDay] = useState<string | null>(start.day);
  const [time, setTime] = useState<string | null>(start.time);
  const [picking, setPicking] = useState(false);
  const [courseKey, setCourseKey] = useState<string | null>(initial.courseKey ?? null);
  const [workType, setWorkType] = useState<WorkType | null>(initial.workType ?? null);
  const [instructions, setInstructions] = useState(initial.instructions ?? '');
  const [docUrl, setDocUrl] = useState(initial.docUrl ?? '');
  // More starts open when the item already uses one of its fields.
  const [more, setMore] = useState(Boolean(initial.courseKey || initial.workType || initial.instructions || initial.docUrl));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; doc?: string; save?: string }>({});

  // Today, tomorrow, and the next three days by name; any other day comes from the date picker.
  const quickDays = [0, 1, 2, 3, 4].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return { key: ymd(d), label: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short' }) };
  });
  const pickedOther = day !== null && !quickDays.some((q) => q.key === day);

  const run = (job: () => Promise<string | null>) => {
    setBusy(true);
    void job().then((err) => {
      setBusy(false);
      if (err) setErrors({ save: err });
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    const link = docUrl.trim();
    const next = {
      title: name ? undefined : 'Give this assignment a name so it’s easy to find on your plan.',
      doc: link && !DOC_LINK.test(link) ? 'That doesn’t look like a Google Doc link.' : undefined,
    };
    setErrors(next);
    if (next.title) {
      nameRef.current?.focus();
      return;
    }
    if (next.doc) {
      setMore(true);
      return;
    }
    run(() => save({ title: name, courseKey, dueAt: joinDue(day, time), workType, instructions: instructions.trim() || null, docUrl: link || null }));
  };

  if (confirmDelete && remove) {
    return (
      <Sheet labelledBy={titleId} onClose={() => setConfirmDelete(false)} busy={busy}>
        <div className="af">
          <p id={titleId} className="af-title">
            Delete {editing?.title ?? 'this assignment'}?
          </p>
          <p className="af-sub">This removes the assignment from your plan, along with Loomer’s notes and chat for it.</p>
          <div className="af-row2">
            <button type="button" className="btn danger-btn" disabled={busy} aria-busy={busy} onClick={() => run(remove)}>
              <Icon name="trash" size="sm" />
              {busy ? 'Deleting…' : 'Delete'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
          {errors.save && <p className="status-line error">{errors.save}</p>}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet labelledBy={titleId} onClose={onClose} busy={busy}>
      <form className="af" onSubmit={submit} noValidate>
        <div className="af-head">
          <p id={titleId} className="af-title">
            {editing ? 'Edit this assignment' : 'Add an assignment'}
          </p>
          <button type="button" className="icon-btn" aria-label="Close" title="Close" disabled={busy} onClick={onClose}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <p className="af-sub">{editing ? 'You added this one, so you can change anything here.' : 'For work that isn’t on Canvas, like a paper worksheet or something your teacher said in class.'}</p>

        <Field icon="edit" label="What is it?" htmlFor={`${titleId}-name`} error={errors.title}>
          <input
            id={`${titleId}-name`}
            ref={nameRef}
            className={errors.title ? 'af-in bad' : 'af-in'}
            autoFocus
            value={title}
            placeholder="Like “Bio lab report”"
            aria-invalid={Boolean(errors.title)}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        <Field icon="calendar" label="When is it due?" hint={day ? undefined : 'Leave it empty if there’s no due date.'}>
          <div className="af-chips" role="group" aria-label="Due day">
            {quickDays.map((q) => (
              <button key={q.key} type="button" className={day === q.key ? 'af-chip on' : 'af-chip'} aria-pressed={day === q.key} onClick={() => setDay(day === q.key ? null : q.key)}>
                {q.label}
              </button>
            ))}
            <button type="button" className={pickedOther || picking ? 'af-chip on' : 'af-chip'} aria-pressed={pickedOther} onClick={() => setPicking((p) => !p)}>
              <Icon name="calendarRange" size="xs" />
              {pickedOther ? new Date(joinDue(day, null)!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Pick a day'}
            </button>
          </div>
          {picking && <input type="date" className="af-in af-date" aria-label="Due day" value={day ?? ''} min={ymd(now)} onChange={(e) => setDay(e.target.value || null)} />}
          {day &&
            (time === null ? (
              <button type="button" className="af-link" onClick={() => setTime('15:00')}>
                <Icon name="clock" size="xs" />
                Due at 11:59 PM · Add a time
              </button>
            ) : (
              <div className="af-time">
                <Icon name="clock" size="xs" />
                <input type="time" className="af-in" aria-label="Due time" value={time} onChange={(e) => setTime(e.target.value || null)} />
                <button type="button" className="af-link" onClick={() => setTime(null)}>
                  Use 11:59 PM
                </button>
              </div>
            ))}
        </Field>

        {!more ? (
          <button type="button" className="af-more" onClick={() => setMore(true)}>
            <Icon name="chevronDown" size="xs" />
            More: class, kind of work, instructions, Google Doc
          </button>
        ) : (
          <>
            <Field icon="book" label="Class" htmlFor={`${titleId}-class`}>
              <select id={`${titleId}-class`} className="af-in" value={courseKey ?? ''} onChange={(e) => setCourseKey(e.target.value || null)}>
                <option value="">No class, or one that isn’t on Canvas</option>
                {courses.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field icon="layers" label="Kind of work" hint={workType ? undefined : 'Skip this and Loomer guesses from the name.'}>
              <div className="af-kinds" role="group" aria-label="Kind of work">
                {KINDS.map((k) => (
                  <button key={k} type="button" className={workType === k ? 'af-kind on' : 'af-kind'} aria-pressed={workType === k} onClick={() => setWorkType(workType === k ? null : k)}>
                    <Icon name={k} size="sm" />
                    {workTypeWord[k]}
                  </button>
                ))}
              </div>
            </Field>
            <Field icon="doc" label="Instructions" htmlFor={`${titleId}-instr`} hint="Loomer reads these like Canvas instructions, so you get the same help.">
              <textarea id={`${titleId}-instr`} className="af-in af-area" rows={3} value={instructions} placeholder="Paste them here if you have them" onChange={(e) => setInstructions(e.target.value)} />
            </Field>
            <Field icon="link" label="Google Doc" htmlFor={`${titleId}-doc`} error={errors.doc}>
              <input
                id={`${titleId}-doc`}
                className={errors.doc ? 'af-in bad' : 'af-in'}
                inputMode="url"
                value={docUrl}
                placeholder="Link your draft or your copy"
                aria-invalid={Boolean(errors.doc)}
                onChange={(e) => setDocUrl(e.target.value)}
              />
            </Field>
          </>
        )}

        <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>
          <Icon name={editing ? 'check' : 'plus'} />
          {busy ? (editing ? 'Saving…' : 'Adding…') : editing ? 'Save changes' : 'Add to plan'}
        </button>
        {errors.save && <p className="status-line error">{errors.save}</p>}
        {editing && remove && (
          <button type="button" className="af-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size="xs" />
            Delete this assignment
          </button>
        )}
      </form>
    </Sheet>
  );
}

/** One labeled field with its icon, an optional error (red) or hint (gray). */
function Field({ icon, label, htmlFor, hint, error, children }: { icon: IconName; label: string; htmlFor?: string; hint?: string; error?: string; children: ReactNode }) {
  const text = (
    <>
      <Icon name={icon} size="xs" />
      {label}
    </>
  );
  return (
    <div className="af-f">
      {htmlFor ? (
        <label className="af-l" htmlFor={htmlFor}>
          {text}
        </label>
      ) : (
        <p className="af-l">{text}</p>
      )}
      {children}
      {error ? <p className="af-err">{error}</p> : hint && <p className="af-hint">{hint}</p>}
    </div>
  );
}

/**
 * Ask Loomer's card for work the student mentioned in chat: add it as is, edit
 * it first in the add sheet, or leave it. The AI never adds anything itself.
 * Once added (ChatModel.added has the draft), it says so with a link.
 */
export function AddDraftCard({ draftId, draft, addedId, now, send, onEdit, onOpen }: {
  draftId: string;
  draft: AddDraft;
  /** The new assignment's id once added. */
  addedId: string | undefined;
  now: Date;
  send: PanelApi['send'];
  onEdit: () => void;
  onOpen: (assignmentId: string) => void;
}) {
  const add = useAction();
  const [skipped, setSkipped] = useState(false);
  const facts = [draft.courseName, draft.workType && workTypeWord[draft.workType], draft.dueAt ? `due ${dueWhen(draft.dueAt, now)}` : 'no due date'].filter(Boolean).join(' · ');
  return (
    <section className="adc" aria-label="Add to your plan">
      <p className="adc-k">
        <Icon name={addedId ? 'checkCircle' : 'plus'} size="xs" />
        {addedId ? 'Added to your plan' : 'Add to your plan'}
      </p>
      <p className="adc-t">{draft.title}</p>
      <p className="adc-s">{facts}</p>
      {addedId ? (
        <button type="button" className="link adc-open" onClick={() => onOpen(addedId)}>
          Open it
          <Icon name="chevronRight" size="xs" />
        </button>
      ) : skipped ? (
        <p className="adc-skip">
          Not added.{' '}
          <button type="button" className="link" onClick={() => setSkipped(false)}>
            Add it after all
          </button>
        </p>
      ) : (
        <>
          <div className="adc-btns">
            <button
              type="button"
              className="btn-primary sm"
              disabled={add.busy}
              aria-busy={add.busy}
              onClick={() => add.run(() => send({ type: 'assignment:add', title: draft.title, courseKey: draft.courseKey, dueAt: draft.dueAt, workType: draft.workType, instructions: null, docUrl: null, draftId }))}
            >
              {add.busy ? 'Adding…' : 'Add it'}
            </button>
            <button type="button" className="btn" disabled={add.busy} onClick={onEdit}>
              Edit first
            </button>
          </div>
          <button type="button" className="adc-not" disabled={add.busy} onClick={() => setSkipped(true)}>
            Not now
          </button>
        </>
      )}
      {add.error && <p className="status-line error">{add.error}</p>}
    </section>
  );
}
