// COMPASS Skill Trend Forecast — deterministic trajectory projection.
//
// Mastery is an EMA over quiz percentages (see gapEngine.ts):
//
//   m_n = 0.6 * m_{n-1} + 0.4 * s_n        (m_0 = 0)
//
// Because the update rule is a fixed formula, the future is exact algebra
// rather than a guess:
//
//   1. Implied recent level — with uniform quiz score s, mastery after n
//      attempts converges to s * (1 - 0.6^n), so the score stream that
//      produced a mastery of m over n attempts implies
//
//          L = m / (1 - 0.6^n)
//
//      clamped to 0..100. L is the officer's demonstrated recent form.
//
//   2. Plateau — an EMA fed a constant level L converges TO L. So if L < 60,
//      mastery will settle near L and the gap never closes on current form.
//      Honest and important: closing a gap requires lifting quiz performance,
//      not merely taking more quizzes.
//
//   3. Threshold crossing — starting at m and scoring a steady S > T each
//      quiz, mastery reaches T after the smallest n with
//
//          0.6^n <= (S - T) / (S - m)
//          n   = ceil( log((S-T)/(S-m)) / log(0.6) )
//
//   4. Projection — after k more quizzes at level L:
//
//          m_k = L + (m - L) * 0.6^k
//
// Nothing here calls a model: it is explainable to evaluators, instant, and
// unit-tested in src/lib/forecast.test.ts.

import { COMPETENCIES, GAP_THRESHOLD, type Competency } from './competencies';
import type { CompetencyMastery } from './types';

/** EMA weight of the prior, mirroring gapEngine.masteryFromCumulative. */
const EMA_PRIOR = 0.6;

/**
 * Level a focused officer is asked to sustain in the "what if" scenario.
 * 70 = comfortably above the 60% bar without assuming perfection.
 */
export const SCENARIO_LEVEL = 70;

/** Recover the demonstrated quiz level from mastery + attempt count. */
export function impliedLevel(mastery: number, attempts: number): number {
  if (attempts <= 0) return 0;
  const decay = 1 - Math.pow(EMA_PRIOR, attempts);
  if (decay <= 0) return 0;
  return Math.max(0, Math.min(100, mastery / decay));
}

/** Mastery after k further quizzes scored at `level` (level is clamped 0..100). */
export function projectMastery(
  mastery: number,
  attempts: number,
  level: number,
  k: number,
): number {
  const L = Math.max(0, Math.min(100, level));
  const target = L + (mastery - L) * Math.pow(EMA_PRIOR, Math.max(0, k));
  return Math.max(0, Math.min(100, target));
}

/**
 * Smallest number of steady quizzes at `scenario` needed for mastery to
 * reach GAP_THRESHOLD. Returns 0 when already there, null when the scenario
 * level itself cannot clear the bar (the scenario must exceed the threshold).
 */
export function quizzesToThreshold(
  mastery: number,
  scenario: number,
  threshold: number = GAP_THRESHOLD,
): number | null {
  if (mastery >= threshold) return 0;
  if (scenario <= threshold) return null;
  const ratio = (scenario - threshold) / (scenario - mastery);
  if (ratio <= 0) return null;
  const n = Math.ceil(Math.log(ratio) / Math.log(EMA_PRIOR));
  return Math.max(1, n);
}

/**
 * Observed quiz cadence from submitted-at timestamps: attempts per week over
 * the trailing 28 days, falling back to the overall span when the last month
 * was quiet. Null when there is not enough history to estimate a rate.
 */
export function quizzesPerWeek(dates: string[], now: number = Date.now()): number | null {
  const times = dates
    .map((d) => Date.parse(d))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (times.length === 0) return null;

  const MONTH_MS = 28 * 24 * 60 * 60 * 1000;
  const recent = times.filter((t) => now - t <= MONTH_MS).length;
  if (recent > 0) return recent / 4;

  if (times.length >= 2) {
    const spanWeeks = (times[times.length - 1] - times[0]) / (7 * 24 * 60 * 60 * 1000);
    if (spanWeeks > 0) {
      return Math.max(0.25, (times.length - 1) / spanWeeks);
    }
  }
  return null;
}

export type ForecastVerdict = 'not_assessed' | 'on_track' | 'catching_up' | 'plateau';

export interface ForecastItem {
  competency: Competency;
  mastery: number;
  /** Demonstrated recent quiz form, 0..100. */
  level: number;
  verdict: ForecastVerdict;
  /** Mastery will settle near this if form is unchanged (== level for gaps). */
  plateau: number;
  /** Quizzes needed to cross the threshold at SCENARIO_LEVEL; null if impossible. */
  quizzesToClose: number | null;
  /** Calendar estimate for quizzesToClose at the observed cadence. */
  weeksToClose: number | null;
}

export interface Forecast {
  items: ForecastItem[];
  currentReadiness: number;
  /** Mean projected readiness 4 weeks out at current form and cadence. */
  projectedReadiness: number;
  cadence: number | null;
}

const PROJECT_WEEKS = 4;

/** Full forecast over the taxonomy; gaps sorted most urgent first. */
export function buildForecast(
  rows: CompetencyMastery[],
  cadence: number | null,
): Forecast {
  const byTag = new Map(rows.map((r) => [r.competency_tag, r]));
  const perWeek = cadence && cadence > 0 ? cadence : null;
  const projectQuizzes =
    perWeek === null ? 2 : Math.max(1, Math.round(perWeek * PROJECT_WEEKS));

  const items: ForecastItem[] = COMPETENCIES.map((competency) => {
    const row = byTag.get(competency);
    const attempts = row?.attempts ?? 0;
    const mastery = Number(row?.mastery ?? 0);

    if (attempts <= 0) {
      return {
        competency,
        mastery: 0,
        level: 0,
        verdict: 'not_assessed' as const,
        plateau: 0,
        quizzesToClose: null,
        weeksToClose: null,
      };
    }

    const level = impliedLevel(mastery, attempts);
    const onTrack = mastery >= GAP_THRESHOLD;
    const verdict: ForecastVerdict = onTrack
      ? 'on_track'
      : level >= GAP_THRESHOLD
        ? 'catching_up'
        : 'plateau';

    // On-track competencies are projected at their demonstrated level; gaps
    // are projected at theirs (which is what makes the plateau visible).
    const quizzesToClose = onTrack ? 0 : quizzesToThreshold(mastery, SCENARIO_LEVEL);
    const weeksToClose =
      quizzesToClose !== null && quizzesToClose > 0 && perWeek !== null
        ? Math.ceil(quizzesToClose / perWeek)
        : null;

    return {
      competency,
      mastery,
      level,
      verdict,
      plateau: projectMastery(mastery, attempts, level, 6),
      quizzesToClose,
      weeksToClose,
    };
  });

  const currentReadiness = Math.round(
    COMPETENCIES.reduce(
      (acc, c) => acc + (byTag.get(c)?.mastery ?? 0),
      0,
    ) / COMPETENCIES.length,
  );

  const projected = Math.round(
    COMPETENCIES.reduce((acc, c) => {
      const item = items.find((i) => i.competency === c)!;
      if (item.verdict === 'not_assessed') return acc;
      return acc + projectMastery(item.mastery, 1, item.level, projectQuizzes);
    }, 0) / COMPETENCIES.length,
  );

  // Real gaps lead the list, most urgent first; never-assessed competencies
  // trail at the end so they inform without crowding out the diagnosis.
  const unassessedLast = (v: ForecastVerdict) => (v === 'not_assessed' ? 1 : 0);
  return {
    items: items
      .filter((i) => i.verdict !== 'on_track')
      .sort(
        (a, b) =>
          unassessedLast(a.verdict) - unassessedLast(b.verdict) ||
          a.mastery - b.mastery,
      ),
    currentReadiness,
    projectedReadiness: projected,
    cadence: perWeek,
  };
}

/** One-line plain-language summary for a forecast item. */
export function forecastLine(item: ForecastItem): string {
  switch (item.verdict) {
    case 'not_assessed':
      return 'Not assessed yet — take a quiz on this competency to start its trend line.';
    case 'on_track':
      return `Holding above the bar — recent form ~${Math.round(item.level)}%.`;
    case 'catching_up':
      return item.quizzesToClose !== null
        ? `Recent form (~${Math.round(item.level)}%) clears the bar — ~${item.quizzesToClose} more quiz${item.quizzesToClose === 1 ? '' : 'zes'} carries mastery past ${GAP_THRESHOLD}%.`
        : `Recent form ~${Math.round(item.level)}% clears the bar — mastery follows within a few quizzes.`;
    case 'plateau': {
      const base = `On current form (~${Math.round(item.level)}% per quiz) mastery settles near ${Math.round(item.plateau)}% — this gap does not close by itself.`;
      return item.quizzesToClose !== null
        ? `${base} Sustaining ${SCENARIO_LEVEL}% averages crosses ${GAP_THRESHOLD}% in ~${item.quizzesToClose} quiz${item.quizzesToClose === 1 ? '' : 'zes'}${item.weeksToClose !== null ? ` (~${item.weeksToClose} week${item.weeksToClose === 1 ? '' : 's'} at your pace)` : ''}.`
        : base;
    }
  }
}
