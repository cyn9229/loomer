import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LoomerDb, type PrepRecord } from '../core/db';
import { parseSite } from '../model/trail';
import { strictnessFor } from '../prep/ladder';
import { topicStandings, weakest } from '../prep/plan';
import { matchPage } from './match';
import { dismissSetup, elsewhereFor, loadTrailView, recordRead, trailRecap } from './trail';

const prep: PrepRecord = {
  assignmentId: 't', startDay: '2026-10-20', status: 'ready',
  topics: [
    { id: 'h', text: 'Annexation of Hawaii', source: 'guide', new: false, removed: false },
    { id: 'c', text: 'The Congo under Leopold II', source: 'guide', new: false, removed: false },
    { id: 'm', text: 'Monroe Doctrine', source: 'guide', new: false, removed: false },
  ],
  terms: [{ term: 'Queen Liliuokalani', definition: '' }, { term: 'rubber quotas', definition: '' }],
  formats: { selected: ['mcq'], found: {}, asked: false }, notes: { photos: 0, found: null },
};
const targets = { topics: prep.topics.map((t) => t.text), terms: prep.terms.map((t) => t.term) };
const now = new Date(2026, 9, 22, 16, 0);

describe('matching a study page', () => {
  it('needs two of the test\'s topics or terms, so one shared word does not count', () => {
    expect(matchPage(targets, 'Best beaches in Hawaii for your annexation-free vacation', [])).toMatchObject({ topics: [], terms: [] });
    const m = matchPage(targets, 'Flashcards: the annexation of Hawaii, Queen Liliuokalani, and the Monroe Doctrine', ['Why did the US annex Hawaii?', 'thanks']);
    expect([m.topics, m.terms]).toEqual([['Annexation of Hawaii', 'Monroe Doctrine'], ['Queen Liliuokalani']]);
    expect(m.asked).toEqual([['Annexation of Hawaii'], []]);
  });

  it('reads a typed site only as a plain domain', () => {
    expect(parseSite('https://www.Brainscape.com/')).toEqual({ origin: 'https://www.brainscape.com', name: 'brainscape.com' });
    expect(parseSite('quizlet.com')).toEqual({ origin: 'https://quizlet.com', name: 'Quizlet' });
    expect([parseSite('quizlet.com/flashcards'), parseSite('localhost'), parseSite('10.0.0.1')]).toEqual([null, null, null]);
  });
});

describe('study trail', () => {
  it('counts each ChatGPT message once, says what it took, and writes the end card lines', async () => {
    const db = new LoomerDb(`test-${crypto.randomUUID()}`);
    await db.preps.put(prep);
    const site = { origin: 'https://chatgpt.com', name: 'ChatGPT' };
    const page = 'Explain the annexation of Hawaii and the Monroe Doctrine. Queen Liliuokalani was overthrown in 1893.';
    const read = (asked: string[], elapsedMs: number) => recordRead(db, { sessionId: 1, assignmentId: 't', site, text: page, asked, elapsedMs, now });
    await read(['What was the Monroe Doctrine?'], 15_000);
    // The same message read again is not counted twice; a new one is.
    await read(['What was the Monroe Doctrine?', 'How does the Monroe Doctrine connect to Hawaii?'], 90_000);
    await db.trailSites.put({ ...site, picked: true, paused: false, dismissed: false });

    const view = await loadTrailView(db, 1, 'Unit 5 Test');
    expect(view.noticed).toEqual([{ origin: 'https://chatgpt.com', name: 'ChatGPT', minutes: 2, took: 'You asked about Monroe Doctrine twice and Annexation of Hawaii once.', paused: false }]);
    // Setup shows only while Loomer can't see the tab and nothing is picked or dismissed; Not now turns it off.
    await db.trailFront.put({ key: 'front', sessionId: 1, origin: null, blind: true, matched: null });
    await db.trailSites.clear();
    expect((await loadTrailView(db, 1, 'Unit 5 Test')).setup).toBe(true);
    await dismissSetup(db);
    expect((await loadTrailView(db, 1, 'Unit 5 Test')).setup).toBe(false);
    expect(trailRecap(await db.trailNotes.toArray(), true)).toEqual({
      trail: 'You studied 2 minutes on ChatGPT, mostly Monroe Doctrine and Annexation of Hawaii.',
      trailNext: 'Next time starts with one quick check on both.',
    });
  });

  it('checks topics asked about first and studied ones next, until Loomer checks them, without changing standing', async () => {
    const db = new LoomerDb(`test-${crypto.randomUUID()}`);
    await db.preps.put(prep);
    await recordRead(db, { sessionId: 1, assignmentId: 't', site: { origin: 'https://quizlet.com', name: 'Quizlet' }, text: 'Leopold II, the Congo, rubber quotas', asked: [], elapsedMs: 15_000, now });
    await recordRead(db, { sessionId: 1, assignmentId: 't', site: { origin: 'https://chatgpt.com', name: 'ChatGPT' }, text: 'Monroe Doctrine and Queen Liliuokalani', asked: ['monroe doctrine?', 'Monroe Doctrine again please'], elapsedMs: 15_000, now });
    const notes = await db.trailNotes.toArray();
    const away = elsewhereFor(prep, notes, [], []);
    expect(Object.fromEntries(away)).toEqual({
      c: { kind: 'site', text: 'Studied on Quizlet · next: one quick check' },
      m: { kind: 'asked', text: "Asked ChatGPT 2 times, so it's checked first" },
    });
    const topics = topicStandings(prep, [], [], strictnessFor(new Date(2026, 9, 24).toISOString(), now), away);
    expect(topics.map((t) => t.standing)).toEqual(['unchecked', 'unchecked', 'unchecked']);
    expect(weakest(topics, [], 3).map((t) => t.id)).toEqual(['m', 'c', 'h']);
    // A Loomer check after the outside study clears the mark.
    const later = new Date(now.getTime() + 60_000).toISOString();
    expect(elsewhereFor(prep, notes, [{ id: 1, assignmentId: 't', quizId: 'q', question: 0, topic: 'monroe doctrine', at: later, correct: true }], []).has('m')).toBe(false);
  });
});
