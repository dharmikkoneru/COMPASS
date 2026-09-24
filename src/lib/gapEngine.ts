import { COMPETENCIES, GAP_THRESHOLD, type Competency } from './competencies';
import type { CompetencyMastery } from './types';

/**
 * COMPASS Gap Engine — deterministic competency diagnostics.
 *
 * After every quiz attempt, each competency the quiz touched is updated with an
 * exponential moving average over *that attempt's own* score:
 *
 *   m_n = 0.6 * m_(n-1) + 0.4 * s_n      (s_n = this attempt's ratio, as a %)
 *
 * The SQL twin is the apply_attempt RPC (migration 0012), which uses the same
 * weights — so the number this module predicts is the number the database
 * stores. It used to average the *lifetime cumulative* ratio instead, which on
 * an account with history moved mastery by tenths of a point per quiz and made
 * the radar look frozen (BACKLOG.md section A).
 *
 * A competency is a "gap" when mastery < GAP_THRESHOLD (60).
 *
 * This is deliberately NOT an LLM call: it is explainable to evaluators,
 * free, instant, and identical on every run. Unit-tested in
 * src/lib/gapEngine.test.ts.
 */

export const EMA_PRIOR_WEIGHT = 0.6;

const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** One quiz's score for a competency, as a 0–100 percentage. */
export function masteryFromAttempt(oldMastery: number, attemptPercent: number): number {
  return clamp(EMA_PRIOR_WEIGHT * oldMastery + (1 - EMA_PRIOR_WEIGHT) * attemptPercent);
}

export interface DiagnosisItem {
  competency: Competency;
  mastery: number;
  attempts: number;
}

/** Mastery lookup by tag; unseen competencies default to 0 (never assessed yet). */
export function masteryMap(rows: CompetencyMastery[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) map[row.competency_tag] = Number(row.mastery);
  return map;
}

/**
 * Full taxonomy diagnosis. Strengths sorted best-first; gaps sorted
 * most-urgent-first (lowest mastery at the front).
 */
export function diagnose(rows: CompetencyMastery[]): {
  strengths: DiagnosisItem[];
  gaps: DiagnosisItem[];
} {
  const map = masteryMap(rows);
  const attemptsByTag: Record<string, number> = {};
  for (const row of rows) attemptsByTag[row.competency_tag] = row.attempts;

  const items: DiagnosisItem[] = COMPETENCIES.map((competency) => ({
    competency,
    mastery: map[competency] ?? 0,
    attempts: attemptsByTag[competency] ?? 0,
  }));

  const strengths = items
    .filter((i) => i.mastery >= GAP_THRESHOLD)
    .sort((a, b) => b.mastery - a.mastery);
  const gaps = items
    .filter((i) => i.mastery < GAP_THRESHOLD)
    .sort((a, b) => a.mastery - b.mastery);

  return { strengths, gaps };
}

/** Overall readiness = mean mastery across the full taxonomy (0–100). */
export function overallReadiness(rows: CompetencyMastery[]): number {
  const map = masteryMap(rows);
  const sum = COMPETENCIES.reduce((acc, c) => acc + (map[c] ?? 0), 0);
  return Math.round(sum / COMPETENCIES.length);
}
