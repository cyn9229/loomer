import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { LoomerDb } from './db';
import { loadWaitTimes, noteTime, overdue, runWait, usualSec, waitView } from './waits';

it('uses the starting guess until three timings, then the low and high of recent ones', async () => {
  const db = new LoomerDb(`test-${crypto.randomUUID()}`);
  expect(usualSec(await loadWaitTimes(db), 'analysis')).toEqual([14, 90]);
  for (const ms of [20_000, 31_000, 25_400]) await noteTime(db, 'analysis', ms);
  expect(usualSec(await loadWaitTimes(db), 'analysis')).toEqual([20, 31]);
});

it('keeps a failure on the record, and counts a wait past three times its high as failed', async () => {
  const db = new LoomerDb(`test-${crypto.randomUUID()}`);
  const failed = { text: "Loomer couldn't pick a focus.", retry: false };
  const out = await runWait(db, 'focus', 7, failed, async () => ({ ok: false, failed }));
  expect(out).toEqual({ ok: false, failed });
  const times = await loadWaitTimes(db);
  expect(waitView(await db.waits.get('focus:7'), times, { title: 'Picking a focus' }, 'stopped', new Date())).toEqual({ pending: null, failed });

  // A good run removes the record and is timed.
  await runWait(db, 'focus', 8, failed, async () => ({ ok: true, value: 1 }));
  expect([await db.waits.get('focus:8'), (await loadWaitTimes(db)).get('focus')?.length]).toEqual([undefined, 1]);

  const started = new Date('2026-10-22T12:00:00Z');
  expect(overdue('focus', times, started.toISOString(), new Date(started.getTime() + 89_000))).toBe(false);
  expect(overdue('focus', times, started.toISOString(), new Date(started.getTime() + 91_000))).toBe(true);
});
