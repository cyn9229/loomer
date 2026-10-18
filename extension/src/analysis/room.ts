// Day room lookups. The student's entries live in the dayRoom table; this turns
// them into the planner's RoomFor and into the Week view's day list.
import type { DayRoomRecord } from '../core/db';
import type { DayRoom } from '../model/home';
import { dateOfDay, dayOfDate, type RoomFor } from './plan';

export const ROOM_DAYS_SHOWN = 14;
export const roomKey = {
  date: (ymd: string) => `date:${ymd}`,
  weekday: (n: number) => `weekday:${n}`,
  default: 'default',
} as const;

/** 0 is Sunday, as in Date.getDay(). */
export const weekdayOf = (ymd: string) => new Date(dayOfDate(ymd) * 86_400_000).getUTCDay();

/** A dated entry beats a weekly one; otherwise the student's normal day, otherwise free. */
export function roomLookup(records: DayRoomRecord[]): RoomFor {
  const byKey = new Map(records.map((r) => [r.key, r]));
  const normal = byKey.get(roomKey.default);
  return (date) => {
    const dated = byKey.get(roomKey.date(date));
    if (dated) return { date, level: dated.level, minutes: dated.minutes, repeating: false };
    const weekly = byKey.get(roomKey.weekday(weekdayOf(date)));
    if (weekly) return { date, level: weekly.level, minutes: weekly.minutes, repeating: true };
    return { date, level: 'free', minutes: normal?.minutes ?? null, repeating: false };
  };
}

/** Today and the following days, with their room. */
export function roomDays(roomFor: RoomFor, today: string, count = ROOM_DAYS_SHOWN): DayRoom[] {
  const first = dayOfDate(today);
  return Array.from({ length: count }, (_, i) => roomFor(dateOfDay(first + i)));
}
