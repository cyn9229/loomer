// The skill ladder for test prep, ported from Plum (plum/convex/lib/domain/
// skillLadder.ts) and fitted to a school test. Each rung is a harder use of
// the same idea: recall, explain, apply, tell apart (from known mix-ups), and
// transfer (compare cases). It decides two things: what the next question on a
// topic should ask, and whether the topic is ready for the test. The student
// never sees the rungs; the panel shows only `progress` and `ready`.
//
// The rules, as in Plum: a rung is held after enough sure, right answers on
// different questions at that rung or above (a higher rung shows the lower
// ones). Two misses in a row at or below the working rung step down one; a
// miss on a stretch question above it is not a slip. A right guess earns a
// little credit and never climbs. A sure, wrong answer opens a mix-up, which
// caps the topic below "tell apart" until a check written for it is passed.
// Ready means the target rung is held, no mix-up is open, and a right answer
// at or above the target came in a later sitting. Close to the test the rules
// relax: fewer answers to climb, a shorter gap, and on test day no later
// sitting at all.
import type { PracticeRecord } from '../core/db';
import type { PracticeKind, PracticeSkill } from '../model/prep';

/** Was this answer right? Written answers count when at least two thirds of what they needed was there. */
export function answerRight(a: PracticeRecord['answers'][string]): boolean | null {
  switch (a.kind) {
    case 'mcq':
    case 'math':
      return a.right;
    case 'vocab':
      return a.knew;
    case 'short':
    case 'explain':
      return a.status === 'ready' ? a.met.length * 3 >= (a.met.length + a.missing.length) * 2 : null;
    case 'frq':
      return a.status === 'ready' ? a.needs.filter((n) => n.met).length * 3 >= a.needs.length * 2 : null;
  }
}

/** Counts toward a topic being solid: right, and not a guess. */
export function answerSolid(a: PracticeRecord['answers'][string]): boolean | null {
  return a.kind === 'mcq' ? a.outcome === 'solid' : answerRight(a);
}

export const RUNGS = ['recall', 'explain', 'apply', 'tell-apart', 'transfer'] as const;
export type Rung = (typeof RUNGS)[number];
const TELL_APART = RUNGS.indexOf('tell-apart');
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** How strict "ready" is, from the time left before the test. */
export type Strictness = { passesToClimb: number; retentionMs: number | null; target: Rung };

/**
 * A week or so out: two answers per rung and a later day, aiming at apply.
 * Within two days: two answers, and a later sitting 3 hours on (the evening
 * check). The day before: one answer per rung, still a later sitting. Test
 * day: one answer per rung, no later sitting, aiming at explain.
 */
export function strictnessFor(testAt: string, now: Date): Strictness {
  const left = Date.parse(testAt) - now.getTime();
  if (left < 12 * HOUR_MS) return { passesToClimb: 1, retentionMs: null, target: 'explain' };
  if (left < 1.5 * DAY_MS) return { passesToClimb: 1, retentionMs: 3 * HOUR_MS, target: 'apply' };
  if (left < 3 * DAY_MS) return { passesToClimb: 2, retentionMs: 3 * HOUR_MS, target: 'apply' };
  return { passesToClimb: 2, retentionMs: 20 * HOUR_MS, target: 'apply' };
}

/** Credit toward the next rung; it never fills a rung by itself (Plum's numbers). */
const CREDIT = { pass: 0.45, pick: 0.3, assisted: 0.12, partial: 0.1, repeat: 0.04, miss: 0.15, mixup: 0.3, ceiling: 0.9, floor: -0.35, afterStepDown: 0.5 } as const;

type ObsKind = 'pass' | 'pick' | 'assisted' | 'partial' | 'miss' | 'mixup';
/** One answer on a topic. `checksMixup`: a check written after a mix-up's teaching block. */
export type Observation = { at: number; questionId: string; rung: number; kind: ObsKind; checksMixup: boolean };

/** The rung a question asks at, from its skill and kind. */
export function rungOf(skill: PracticeSkill, kind: PracticeKind, checksMixup: boolean): number {
  if (checksMixup) return TELL_APART;
  if (kind === 'frq') return RUNGS.indexOf('transfer');
  if (kind === 'vocab') return RUNGS.indexOf('recall');
  if (kind === 'short' || kind === 'explain') return RUNGS.indexOf('explain');
  if (kind === 'math') return RUNGS.indexOf('apply');
  return skill === 'remember' ? 0 : skill === 'understand' ? 1 : 2;
}

/** A topic's answers in time order, as ladder observations. */
export function observationsFor(topicId: string, practices: PracticeRecord[]): Observation[] {
  return practices
    .slice()
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
    .flatMap((p) => {
      const at = Date.parse(p.startedAt ?? p.createdAt);
      const mixupBlocks = new Set(p.blocks.map((b) => b.block.id));
      return p.questions.flatMap((q): Observation[] => {
        const a = p.answers[q.id];
        if (q.topicId !== topicId || !a) return [];
        const checksMixup = Boolean(q.checkOf && mixupBlocks.has(q.checkOf));
        const rung = rungOf(q.skill, q.kind, checksMixup);
        const obs = (kind: ObsKind): Observation[] => [{ at, questionId: q.id, rung, kind, checksMixup }];
        if (a.kind === 'mcq') return obs(a.outcome === 'solid' ? 'pick' : a.outcome === 'shaky' ? 'assisted' : a.outcome === 'mixup' ? 'mixup' : 'miss');
        if (a.kind === 'vocab') return obs(a.knew ? 'pick' : 'miss');
        const right = answerRight(a);
        if (right === null) return [];
        if (right) return obs('pass');
        const partly = (a.kind === 'frq' ? a.needs.some((n) => n.met) : a.kind === 'short' || a.kind === 'explain' ? a.met.length > 0 : false);
        return obs(partly ? 'partial' : 'miss');
      });
    });
}

export type Ladder = {
  /** Rungs held, 0 to RUNGS.length. */
  level: number;
  /** The rung the next question should ask at. */
  ask: Rung;
  ready: boolean;
  /** A sure, wrong answer not yet cleared by a check written for it. */
  mixupOpen: boolean;
  /** 0 to 1 toward ready, for a simple bar. Never 1 until ready. */
  progress: number;
  /** Whether any answer was seen. */
  seen: boolean;
};

/** Replays a topic's answers into its ladder. */
export function climb(observations: Observation[], strict: Strictness): Ladder {
  const target = RUNGS.indexOf(strict.target);
  let level = 0;
  let credit = 0;
  let passes = new Map<string, number>();
  let misses = 0;
  let mixupOpen = false;
  let targetHeldAt: number | null = null;
  let retained = false;
  const setLevel = (next: number) => {
    if (next !== level) credit = 0;
    level = next;
  };
  const cap = () => (mixupOpen ? Math.min(level, TELL_APART) : level);
  for (const o of observations) {
    const before = level;
    if (o.kind === 'mixup' || o.kind === 'miss') {
      if (o.kind === 'mixup') mixupOpen = true;
      setLevel(cap());
      // A stretch question above the working rung is a probe; missing it is not a slip.
      if (o.kind === 'miss' && o.rung > level) continue;
      misses += 1;
      credit = Math.max(level === 0 ? 0 : CREDIT.floor, credit - (o.kind === 'mixup' ? CREDIT.mixup : CREDIT.miss));
    } else if (o.kind === 'pass' || o.kind === 'pick') {
      if (o.checksMixup) mixupOpen = false;
      misses = 0;
      if (targetHeldAt !== null && o.rung >= target && (strict.retentionMs === null || o.at - targetHeldAt >= strict.retentionMs)) retained = true;
      const counts = o.rung >= level && !passes.has(o.questionId);
      if (o.rung >= level) passes.set(o.questionId, o.rung);
      credit = Math.min(CREDIT.ceiling, credit + (counts ? (o.kind === 'pass' ? CREDIT.pass : CREDIT.pick) : CREDIT.repeat));
      if (passes.size >= strict.passesToClimb) {
        setLevel(Math.max(level + 1, Math.min(...passes.values()) + 1));
        passes = new Map();
      }
      setLevel(cap());
    } else {
      credit = Math.min(CREDIT.ceiling, credit + (o.kind === 'partial' ? CREDIT.partial : CREDIT.assisted));
    }
    if (misses >= 2) {
      setLevel(Math.max(0, level - 1));
      if (level < before) credit = CREDIT.afterStepDown;
      misses = 0;
      passes = new Map();
    }
    if (level > target && !mixupOpen) {
      if (targetHeldAt === null) {
        targetHeldAt = o.at;
        if (strict.retentionMs === null) retained = true;
      }
    } else {
      targetHeldAt = null;
      retained = false;
    }
  }
  const ready = targetHeldAt !== null && retained && !mixupOpen;
  const span = target + 1;
  const progress = ready ? 1 : Math.max(0, Math.min(0.95, (Math.min(level, span) + (level >= span ? 0.5 : credit)) / span));
  // A mix-up is asked at "tell apart"; a held topic is asked at its target to keep it held.
  const ask: Rung = mixupOpen ? 'tell-apart' : level > target ? strict.target : RUNGS[Math.min(level, RUNGS.length - 1)]!;
  return { level, ask, ready, mixupOpen, progress, seen: observations.length > 0 };
}
