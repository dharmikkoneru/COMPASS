import { describe, expect, it } from 'vitest';
import {
  buildForecast,
  forecastLine,
  impliedLevel,
  projectMastery,
  quizzesPerWeek,
  quizzesToThreshold,
} from './forecast';
import { GAP_THRESHOLD } from './competencies';
import type { CompetencyMastery } from './types';

const row = (
  tag: string,
  mastery: number,
  attempts: number,
): CompetencyMastery => ({
  competency_tag: tag,
  mastery,
  attempts,
  correct: Math.round((mastery / 100) * attempts * 4),
  total: attempts * 4,
});

describe('impliedLevel', () => {
  it('returns 0 for never-assessed competencies', () => {
    expect(impliedLevel(0, 0)).toBe(0);
  });

  it('recovers the exact level after many attempts (EMA converged)', () => {
    // By ~12 attempts 0.6^n is small enough that level ≈ mastery (0.6^12 ≈ 0.0022).
    expect(impliedLevel(55, 12)).toBeCloseTo(55, 0);
  });

  it('explains why a small mastery with one attempt is a high level', () => {
    // m_1 = 0.6*0 + 0.4*s  =>  s = m/0.4. Mastery 24 after one quiz = 60% form.
    expect(impliedLevel(24, 1)).toBeCloseTo(60, 5);
  });

  it('never exceeds 100 even for impossible inputs', () => {
    expect(impliedLevel(95, 1)).toBeLessThanOrEqual(100);
  });
});

describe('projectMastery', () => {
  it('moves mastery toward the level by the EMA factor each quiz', () => {
    const one = projectMastery(40, 3, 80, 1);
    expect(one).toBeCloseTo(40 + 0.4 * (80 - 40), 5);
  });

  it('converges to the level as k grows', () => {
    expect(projectMastery(40, 3, 80, 20)).toBeCloseTo(80, 1);
  });

  it('is a no-op at k=0', () => {
    expect(projectMastery(55, 4, 90, 0)).toBeCloseTo(55, 5);
  });
});

describe('quizzesToThreshold', () => {
  it('is 0 when mastery already clears the bar', () => {
    expect(quizzesToThreshold(75, 70)).toBe(0);
  });

  it('is null when the scenario cannot clear the bar', () => {
    expect(quizzesToThreshold(45, 55)).toBeNull();
  });

  it('computes a correct small case: m=40, S=70, T=60', () => {
    // ratio = 10/30 = 1/3; n = ceil(log(1/3)/log(0.6)) = ceil(2.258) = 3.
    expect(quizzesToThreshold(40, 70)).toBe(3);
    // Verify by simulation: three quizzes at 70 from 40.
    let m = 40;
    for (let i = 0; i < 3; i++) m = 0.6 * m + 0.4 * 70;
    expect(m).toBeGreaterThanOrEqual(GAP_THRESHOLD);
  });

  it('is exactly 1 when one scenario quiz suffices', () => {
    // m=59, S=90: after one quiz 0.6*59+0.4*90 = 71.4 >= 60.
    expect(quizzesToThreshold(59, 90)).toBe(1);
  });
});

describe('quizzesPerWeek', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('is null with no dates', () => {
    expect(quizzesPerWeek([])).toBeNull();
  });

  it('counts the trailing 28 days at 4 per 4 weeks', () => {
    const now = Date.now();
    const dates = [0, 7, 14, 21].map((d) => new Date(now - d * DAY).toISOString());
    expect(quizzesPerWeek(dates, now)).toBeCloseTo(1, 5);
  });

  it('falls back to overall span when the last month was quiet', () => {
    const now = Date.now();
    const old = 90;
    const dates = [old, old + 14].map((d) => new Date(now - d * DAY).toISOString());
    // 1 attempt over 2 weeks = 0.5/week, floored at 0.25.
    expect(quizzesPerWeek(dates, now)).toBeCloseTo(0.5, 5);
  });
});

describe('buildForecast', () => {
  const rows = [
    row('Survey Methodology', 78, 8),
    row('Data Governance & Privacy', 35, 4),
    row('Sampling Techniques', 55, 6),
  ];

  it('flags on-track competencies as such and excludes them from the gap list', () => {
    const f = buildForecast(rows, null);
    expect(f.currentReadiness).toBeGreaterThan(0);
    expect(f.items.map((i) => i.competency)).not.toContain('Survey Methodology');
    const governance = f.items.find((i) => i.competency === 'Data Governance & Privacy');
    expect(governance?.verdict).toBe('plateau');
  });

  it('marks recently-started gaps below-form-but-improving as catching_up', () => {
    // One quiz at 80% -> mastery 32, level 80 (>= threshold): catching up.
    const f = buildForecast([row('Sampling Techniques', 32, 1)], null);
    const sampling = f.items.find((i) => i.competency === 'Sampling Techniques');
    expect(sampling?.verdict).toBe('catching_up');
    expect(sampling?.quizzesToClose).toBeGreaterThan(0);
  });

  it('treats unassessed competencies separately and excludes them from projection', () => {
    const f = buildForecast(rows, null);
    const statComp = f.items.find((i) => i.competency === 'Statistical Computing');
    expect(statComp?.verdict).toBe('not_assessed');
    expect(statComp?.quizzesToClose).toBeNull();
  });

  it('converts quizzes-to-close into weeks using the cadence', () => {
    const f = buildForecast(rows, 1); // one quiz per week
    const governance = f.items.find((i) => i.competency === 'Data Governance & Privacy');
    expect(governance?.weeksToClose).toBeGreaterThan(0);
  });
});

describe('forecastLine', () => {
  it('tells unassessed users to take a quiz', () => {
    const f = buildForecast([], null);
    expect(forecastLine(f.items[0])).toMatch(/Not assessed/);
  });

  it('makes the plateau explicit for static gaps', () => {
    const f = buildForecast([row('Data Governance & Privacy', 35, 4)], null);
    const governance = f.items.find((i) => i.competency === 'Data Governance & Privacy')!;
    const line = forecastLine(governance);
    expect(line).toMatch(/does not close by itself/);
    expect(line).toMatch(/70%/); // the SCENARIO_LEVEL ask
  });

  it('promises crossing for catching_up items', () => {
    const f = buildForecast([row('Sampling Techniques', 32, 1)], null);
    const sampling = f.items.find((i) => i.competency === 'Sampling Techniques')!;
    expect(forecastLine(sampling)).toMatch(/carries mastery past 60%/);
  });
});
