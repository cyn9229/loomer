// Where the student stands on each topic of their sheet, from their own quick
// checks: unchecked, shaky (under 80% right on the latest check), or solid. No
// ticking; the checks are the signal. Also picks what to do next. Pure.
import type { SheetTopicsRecord, TopicCheckRecord } from '../core/db';
import type { TopicItem, TopicNext } from '../model/session';

const SOLID_RATIO = 0.8;

const normalize = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
/** A topic's stable key: its name, normalized. */
export const topicKey = (text: string) => normalize(text);

/** The latest check on one topic: one quiz, the last answer per question. */
export function lastCheck(checks: TopicCheckRecord[]): TopicItem['lastCheck'] {
  const latest = checks.reduce<TopicCheckRecord | null>((a, c) => (!a || c.at > a.at ? c : a), null);
  if (!latest) return null;
  const answers = new Map<number, TopicCheckRecord>();
  for (const c of checks.filter((c) => c.quizId === latest.quizId).sort((a, b) => a.at.localeCompare(b.at))) answers.set(c.question, c);
  const all = [...answers.values()];
  return { correct: all.filter((c) => c.correct).length, total: all.length, at: latest.at };
}

export function standingOf(check: TopicItem['lastCheck']): TopicItem['standing'] {
  if (!check || check.total === 0) return 'unchecked';
  return check.correct / check.total >= SOLID_RATIO ? 'solid' : 'shaky';
}

/** The topic list with standings, in sheet order. */
export function topicItems(
  record: Extract<SheetTopicsRecord, { status: 'ok' }>,
  checks: TopicCheckRecord[],
  skipped: ReadonlySet<string>,
  sheetTitles: ReadonlyMap<string, string | null>,
): TopicItem[] {
  return record.topics.map((t) => {
    const key = topicKey(t.text);
    const check = lastCheck(checks.filter((c) => c.topic === key));
    return { text: t.text, quote: t.quote, sheet: sheetTitles.get(t.sheetId) ?? null, standing: standingOf(check), lastCheck: check, skipped: skipped.has(key) };
  });
}

/** What to do next: the shakiest topic, else the first unchecked one. Null when every topic is solid or skipped. */
export function nextTopic(items: TopicItem[]): TopicNext {
  const open = items.filter((t) => !t.skipped);
  const shaky = open
    .filter((t) => t.standing === 'shaky' && t.lastCheck)
    .sort((a, b) => a.lastCheck!.correct / a.lastCheck!.total - b.lastCheck!.correct / b.lastCheck!.total)[0];
  if (shaky?.lastCheck) {
    const missed = shaky.lastCheck.total - shaky.lastCheck.correct;
    return { topic: shaky.text, reason: `You missed ${missed} of ${shaky.lastCheck.total} on the last check.`, mode: 'explain' };
  }
  const unchecked = open.find((t) => t.standing === 'unchecked');
  return unchecked ? { topic: unchecked.text, reason: 'Not checked yet.', mode: 'check' } : null;
}
