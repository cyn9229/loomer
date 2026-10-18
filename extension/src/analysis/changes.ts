// Plan changes: the student's own facts about their time and their work ("Thu
// is busy", "the essay is Heavy", "I have 40 min"). The AI or a panel control
// proposes edits; this module checks them, previews them with the real planner,
// and writes them only on apply. Every write keeps the value it replaced, so
// undo puts it back. Due dates and the teacher's AI rule are never editable.
import type { PlanChangeItem } from '../../../shared/chat-contract';
import type { DayRoomRecord, LoomerDb, PlanChangeRecord, PlanContextField, PlanEdit, PlanWrite, StudentContext, StudentWorkload } from '../core/db';
import type { DayRoom, RoomLevel, WorkItem } from '../model/home';
import type { PlanPreview } from '../model/plan';
import { loadHomeData, type HomeData } from '../model/homeData';
import { isOpen } from './facts';
import { dayOfDate, localDay, minutesWords, WORKLOAD_WORDS } from './plan';
import { buildHomeModel, type RecommendInput } from './recommend';
import { roomDays, roomKey, roomLookup, weekdayOf } from './room';
import { WORK_TYPE_WORDS } from './workType';

/** Settings the planner needs besides the store. */
export type PlanSettings = Pick<RecommendInput, 'ai' | 'choice' | 'snapshot' | 'levelMinutes'> & { connected: boolean };
export type CheckResult = { ok: true; edits: PlanEdit[] } | { ok: false; error: string };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const LEVEL_WORDS: Record<RoomLevel, string> = { free: 'free', some: 'some room', little: 'little room', busy: 'busy' };

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const;
const STUDENT_WORKLOAD = { Light: 'Short', Medium: 'Moderate', Heavy: 'Substantial' } as const satisfies Record<string, StudentWorkload>;

/** The tool's change, in the store's terms. Room by weekday without repeat means its next date. */
export function editFromItem(c: PlanChangeItem, now: Date): PlanEdit | string {
  switch (c.kind) {
    case 'room': {
      if ((c.date === null) === (c.weekday === null)) return 'Give either a date or a weekday for a room change.';
      const key = c.date
        ? c.repeat
          ? roomKey.weekday(weekdayOf(c.date))
          : roomKey.date(c.date)
        : c.repeat
          ? roomKey.weekday(WEEKDAY_INDEX[c.weekday!])
          : roomKey.date(nextDateFor(WEEKDAY_INDEX[c.weekday!], now));
      // A busy day has no starts, so a number with it is not the student's; drop it.
      return { kind: 'room', key, level: c.level, minutes: c.level === 'busy' ? null : c.minutes };
    }
    case 'workload':
      return { kind: 'workload', assignmentId: c.assignment_id, label: STUDENT_WORKLOAD[c.label] };
    case 'start_on':
      return { kind: 'start-on', assignmentId: c.assignment_id, date: c.date };
    case 'guess':
      return { kind: 'guess', assignmentId: c.assignment_id, minutes: c.minutes };
    case 'work_type':
      return { kind: 'work-type', assignmentId: c.assignment_id, type: c.type };
    case 'normal_day':
      return { kind: 'normal-day', minutes: c.minutes };
    case 'time_left':
      return { kind: 'time-left', minutes: c.minutes };
    case 'mark':
      return { kind: c.as === 'hidden' ? 'hide' : c.as === 'done_offline' ? 'done-offline' : 'keep-active', assignmentId: c.assignment_id };
  }
}

const isRealDate = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
};

const dateWords = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

/**
 * Checks edits against the store as it is now: the assignment exists in the
 * current school account, dates are real and not past, a start day is not after
 * the due date, and a session time limit needs an active session.
 */
export async function checkEdits(db: LoomerDb, edits: PlanEdit[], now: Date): Promise<CheckResult> {
  const today = localDay(now);
  const lastRun = await db.runs.orderBy('startedAt').last();
  for (const e of edits) {
    if ('assignmentId' in e) {
      const a = await db.assignments.get(e.assignmentId);
      if (!a || a.sourceKey !== lastRun?.sourceKey) return { ok: false, error: `No assignment with id ${e.assignmentId}. Use list_work first.` };
      if (e.kind !== 'hide' && !isOpen(a)) return { ok: false, error: `${a.title} is already turned in.` };
      if (e.kind === 'start-on') {
        if (!isRealDate(e.date)) return { ok: false, error: `${e.date} is not a real date.` };
        if (e.date < today) return { ok: false, error: `${e.date} has already passed.` };
        if (a.dueAt && e.date > localDay(new Date(a.dueAt))) return { ok: false, error: `${a.title} is due before ${e.date}.` };
      }
    }
    if (e.kind === 'room' && e.key.startsWith('date:')) {
      const date = e.key.slice('date:'.length);
      if (!isRealDate(date)) return { ok: false, error: `${date} is not a real date.` };
      if (date < today) return { ok: false, error: `${date} has already passed.` };
    }
    if (e.kind === 'time-left' && !(await db.sessions.where('state').equals('active').count())) {
      return { ok: false, error: 'There is no active work session to set a time for.' };
    }
  }
  return { ok: true, edits };
}

type Overlay = { room: Map<string, DayRoomRecord | null>; context: Map<string, StudentContext> };

/** What applying the edits would write, each with the value it replaces. Reads only. */
async function writesFor(db: LoomerDb, edits: PlanEdit[], now: Date): Promise<PlanWrite[]> {
  const at = now.toISOString();
  const overlay: Overlay = { room: new Map(), context: new Map() };
  const writes: PlanWrite[] = [];
  const room = async (key: string, after: DayRoomRecord | null) => {
    const before = overlay.room.has(key) ? overlay.room.get(key)! : ((await db.dayRoom.get(key)) ?? null);
    overlay.room.set(key, after);
    writes.push({ slot: 'room', key, before, after });
  };
  const context = async <F extends PlanContextField>(key: string, field: F, after: StudentContext[F] | null) => {
    const ctx = overlay.context.get(key) ?? (await db.studentContext.get(key)) ?? { key };
    const before = (ctx[field] ?? null) as StudentContext[F] | null;
    overlay.context.set(key, { ...ctx, [field]: after ?? undefined });
    writes.push({ slot: 'context', key, field, before, after } as PlanWrite);
  };

  for (const e of edits) {
    switch (e.kind) {
      case 'room':
        // A weekly "free" is the same as no weekly rule; a dated "free" must stay, to beat a weekly rule.
        await room(e.key, e.level === 'free' && e.minutes === null && e.key.startsWith('weekday:') ? null : { key: e.key, level: e.level, minutes: e.minutes, setAt: at });
        break;
      case 'normal-day':
        await room(roomKey.default, { key: roomKey.default, level: 'free', minutes: e.minutes, setAt: at });
        break;
      case 'workload':
        await context(e.assignmentId, 'workload', e.label);
        break;
      case 'start-on':
        await context(e.assignmentId, 'startOn', e.date);
        break;
      case 'guess':
        await context(e.assignmentId, 'guessMinutes', e.minutes);
        break;
      case 'work-type':
        await context(e.assignmentId, 'workType', e.type);
        break;
      case 'hide':
        await context(e.assignmentId, 'hidden', true);
        break;
      case 'done-offline':
      case 'keep-active':
        await context(e.assignmentId, 'correction', e.kind === 'done-offline' ? 'done-offline' : 'kept-active');
        break;
      case 'time-left': {
        const s = await db.sessions.where('state').equals('active').last();
        if (s) writes.push({ slot: 'session', id: s.id, before: s.plannedUntil ?? null, after: new Date(now.getTime() + e.minutes * 60_000).toISOString() });
        break;
      }
    }
  }
  return writes;
}

/** The store's inputs with the writes laid over them, for the "after" plan. */
function withWrites(data: HomeData, writes: PlanWrite[]): HomeData {
  const room = new Map(data.room.map((r) => [r.key, r]));
  const context = new Map(data.context.map((c) => [c.key, c]));
  for (const w of writes) {
    if (w.slot === 'room') {
      if (w.after) room.set(w.key, w.after);
      else room.delete(w.key);
    } else if (w.slot === 'context') {
      context.set(w.key, { ...(context.get(w.key) ?? { key: w.key }), [w.field]: w.after ?? undefined });
    }
  }
  return { ...data, room: [...room.values()], context: [...context.values()] };
}

function itemsOf(input: RecommendInput): WorkItem[] {
  const home = buildHomeModel(input);
  if (home.status === 'not-connected') return [];
  return home.status === 'ready' ? [home.next.item, ...home.rest] : home.rest;
}

/** Before-and-after with the real planner: changed day room, moved start days, and one line per edit. */
async function previewFor(db: LoomerDb, edits: PlanEdit[], writes: PlanWrite[], settings: PlanSettings, now: Date): Promise<PlanPreview> {
  const data = await loadHomeData(db);
  const base = { ...settings, briefDismissedOn: null, now };
  const beforeInput: RecommendInput = { ...data, ...base };
  const afterInput: RecommendInput = { ...withWrites(data, writes), ...base };
  const beforeItems = new Map(itemsOf(beforeInput).map((i) => [i.assignmentId, i]));
  const afterItems = itemsOf(afterInput);

  const day = (iso: string | null | undefined) => (iso ? localDay(new Date(iso)) : null);
  const moves = afterItems.flatMap((i) => {
    const was = beforeItems.get(i.assignmentId);
    const from = was?.startBy?.at ?? null;
    const to = i.hidden || i.correction === 'done-offline' ? null : (i.startBy?.at ?? null);
    return day(from) === day(to) ? [] : [{ assignmentId: i.assignmentId, title: i.title, from, to }];
  });

  const today = localDay(now);
  const beforeRoom = roomDays(roomLookup(beforeInput.room), today);
  const afterRoom = roomDays(roomLookup(afterInput.room), today);
  const same = (a: DayRoom, b: DayRoom) => a.level === b.level && a.minutes === b.minutes && a.repeating === b.repeating;
  const days = afterRoom.flatMap((after, i) => (same(beforeRoom[i]!, after) ? [] : [{ date: after.date, before: beforeRoom[i]!, after }]));

  const title = (id: string) => beforeItems.get(id)?.title ?? afterItems.find((i) => i.assignmentId === id)?.title ?? 'This assignment';
  const lines = edits.map((e): string => {
    switch (e.kind) {
      case 'room': {
        const own = e.minutes !== null ? ` (you have ${minutesWords(e.minutes)})` : '';
        if (e.key.startsWith('weekday:')) return `${WEEKDAYS[Number(e.key.slice('weekday:'.length))]}s: ${LEVEL_WORDS[e.level]}${own}, every week`;
        return `${dateWords(e.key.slice('date:'.length))}: ${LEVEL_WORDS[e.level]}${own}`;
      }
      case 'normal-day':
        return `Your normal day: about ${minutesWords(e.minutes)}`;
      case 'workload': {
        const was = beforeItems.get(e.assignmentId)?.effort.label;
        return `${title(e.assignmentId)} workload: ${WORKLOAD_WORDS[e.label]}${was && was !== 'Unknown' && was !== e.label ? ` (was ${WORKLOAD_WORDS[was]})` : ''}`;
      }
      case 'start-on':
        return `Start ${title(e.assignmentId)} on ${dateWords(e.date)}`;
      case 'guess':
        return `Your guess for ${title(e.assignmentId)}: about ${minutesWords(e.minutes)}`;
      case 'work-type': {
        const was = beforeItems.get(e.assignmentId)?.workType.type;
        return `${title(e.assignmentId)} is ${WORK_TYPE_WORDS[e.type]} work${was && was !== e.type ? ` (was ${WORK_TYPE_WORDS[was]})` : ''}`;
      }
      case 'time-left':
        return `You have ${minutesWords(e.minutes)} for this session`;
      case 'hide':
        return `Hide ${title(e.assignmentId)}`;
      case 'done-offline':
        return `Mark ${title(e.assignmentId)} done offline`;
      case 'keep-active':
        return `Keep ${title(e.assignmentId)} active`;
    }
  });
  return { lines, days, moves };
}

/** Checks the edits and stores a proposed change with its preview. Writes nothing to the plan. */
export async function proposeChange(db: LoomerDb, edits: PlanEdit[], threadKey: string | null, settings: PlanSettings, now: Date): Promise<{ ok: true; change: PlanChangeRecord } | { ok: false; error: string }> {
  const checked = await checkEdits(db, edits, now);
  if (!checked.ok) return checked;
  const preview = await previewFor(db, edits, await writesFor(db, edits, now), settings, now);
  const change: PlanChangeRecord = {
    id: crypto.randomUUID(),
    threadKey,
    edits,
    status: 'proposed',
    preview,
    writes: [],
    createdAt: now.toISOString(),
    appliedAt: null,
    undoneAt: null,
  };
  await db.planChanges.add(change);
  return { ok: true, change };
}

export type ApplyResult = { ok: true } | { ok: false; error: string; previewChanged?: true };

/**
 * Applies a proposed change after checking it again. If the plan moved since
 * the card was made, the card gets the new preview and nothing is written; the
 * student sees it and taps Apply again. `confirmPreview: false` is for panel
 * controls, where the student's tap is the whole decision.
 */
export async function applyChange(db: LoomerDb, id: string, settings: PlanSettings, now: Date, confirmPreview = true): Promise<ApplyResult> {
  const change = await db.planChanges.get(id);
  if (!change || change.status !== 'proposed') return { ok: false, error: 'This change was already handled.' };
  const checked = await checkEdits(db, change.edits, now);
  if (!checked.ok) {
    await db.planChanges.update(id, { status: 'dismissed' });
    return { ok: false, error: `This change no longer fits: ${checked.error}` };
  }
  const writes = await writesFor(db, change.edits, now);
  const preview = await previewFor(db, change.edits, writes, settings, now);
  if (confirmPreview && JSON.stringify(preview) !== JSON.stringify(change.preview)) {
    await db.planChanges.update(id, { preview });
    return { ok: false, error: 'Your plan changed since this card was made. Check the new preview, then apply.', previewChanged: true };
  }
  await db.transaction('rw', [db.dayRoom, db.studentContext, db.sessions, db.planChanges], async () => {
    for (const w of writes) await write(db, w, 'after');
    await db.planChanges.update(id, { status: 'applied', writes, preview, appliedAt: now.toISOString() });
  });
  return { ok: true };
}

/** Puts back what an applied change replaced. A slot a later change wrote again keeps the later value. */
export async function undoChange(db: LoomerDb, id: string, now: Date): Promise<ApplyResult> {
  const change = await db.planChanges.get(id);
  if (!change || change.status !== 'applied') return { ok: false, error: 'Only an applied change can be undone.' };
  await db.transaction('rw', [db.dayRoom, db.studentContext, db.sessions, db.planChanges], async () => {
    for (const w of [...change.writes].reverse()) {
      if (JSON.stringify(await current(db, w)) === JSON.stringify(w.after)) await write(db, w, 'before');
    }
    await db.planChanges.update(id, { status: 'undone', undoneAt: now.toISOString() });
  });
  return { ok: true };
}

export async function dismissChange(db: LoomerDb, id: string): Promise<ApplyResult> {
  const change = await db.planChanges.get(id);
  if (!change || change.status !== 'proposed') return { ok: false, error: 'This change was already handled.' };
  await db.planChanges.update(id, { status: 'dismissed' });
  return { ok: true };
}

async function current(db: LoomerDb, w: PlanWrite): Promise<unknown> {
  if (w.slot === 'room') return (await db.dayRoom.get(w.key)) ?? null;
  if (w.slot === 'context') return (await db.studentContext.get(w.key))?.[w.field] ?? null;
  return (await db.sessions.get(w.id))?.plannedUntil ?? null;
}

async function write(db: LoomerDb, w: PlanWrite, side: 'before' | 'after') {
  if (w.slot === 'room') {
    const value = w[side];
    if (value) await db.dayRoom.put(value);
    else await db.dayRoom.delete(w.key);
  } else if (w.slot === 'context') {
    const ctx = (await db.studentContext.get(w.key)) ?? { key: w.key };
    await db.studentContext.put({ ...ctx, [w.field]: w[side] ?? undefined });
  } else {
    await db.sessions.update(w.id, { plannedUntil: w[side] ?? undefined });
  }
}

/** Resolves a weekday name to its next date (today counts) as YYYY-MM-DD. */
export function nextDateFor(weekday: number, now: Date): string {
  const today = dayOfDate(localDay(now));
  const ahead = (weekday - weekdayOf(localDay(now)) + 7) % 7;
  return new Date((today + ahead) * 86_400_000).toISOString().slice(0, 10);
}
