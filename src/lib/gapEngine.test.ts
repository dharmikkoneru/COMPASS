import { describe, expect, it } from 'vitest';
import { COMPETENCIES, GAP_THRESHOLD } from './competencies';
import { diagnose, masteryFromAttempt, overallReadiness } from './gapEngine';
import type { CompetencyMastery } from './types';

describe('masteryFromAttempt (EMA)', () => {
  it('blends 60% prior mastery with 40% of this attempt', () => {
    // 0.6 * 50 + 0.4 * 80 = 62
    expect(masteryFromAttempt(50, 80)).toBeCloseTo(62);
  });

  it('returns 40% of the attempt when prior mastery is 0', () => {
    // A brand-new competency seeded by one perfect quiz.
    expect(masteryFromAttempt(0, 100)).toBeCloseTo(40);
  });

  it('moves a practised competency by tens of points, not tenths', () => {
    // The regression that read as "the competency map never updates": 33.28 is
    // the demo account's Sampling mastery, and a perfect attempt must lift it
    // to 0.6 * 33.28 + 40 ≈ 59.97 — the old cumulative term gave +0.02.
    expect(masteryFromAttempt(33.28, 100)).toBeCloseTo(59.968, 3);
  });

  it('clamps into [0, 100]', () => {
    expect(masteryFromAttempt(100, 100)).toBeLessThanOrEqual(100);
    expect(masteryFromAttempt(0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('diagnose', () => {
  it('splits gaps and strengths around the 60 threshold', () => {
    const rows: CompetencyMastery[] = [
      { competency_tag: 'Sampling Techniques', mastery: 72, attempts: 1, correct: 9, total: 10 },
      { competency_tag: 'Survey Methodology', mastery: 40, attempts: 1, correct: 5, total: 10 },
    ];
    const { gaps, strengths } = diagnose(rows);
    // The 6 unassessed competencies count as 0-mastery gaps too.
    expect(gaps).toHaveLength(7);
    expect(gaps).toContainEqual(expect.objectContaining({ competency: 'Survey Methodology' }));
    expect(strengths.map((s) => s.competency)).toEqual(['Sampling Techniques']);
  });

  it('orders gaps most-urgent-first and strengths best-first', () => {
    const values: Record<string, number> = {
      'Sampling Techniques': 55,
      'Survey Methodology': 20,
      'Statistical Computing': 80,
      'Data Quality & Validation': 65,
      'Data Collection & Field Ops': 30,
      'Data Indexing & Storage': 0,
      'Official Statistics & Indicators': 90,
      'Data Governance & Privacy': 10,
    };
    const rows: CompetencyMastery[] = COMPETENCIES.map((c) => ({
      competency_tag: c,
      mastery: values[c],
      attempts: 1,
      correct: 5,
      total: 10,
    }));
    const { gaps, strengths } = diagnose(rows);
    expect(gaps.map((g) => g.competency)).toEqual([
      'Data Indexing & Storage',
      'Data Governance & Privacy',
      'Survey Methodology',
      'Data Collection & Field Ops',
      'Sampling Techniques',
    ]);
    expect(strengths.map((s) => s.competency)).toEqual([
      'Official Statistics & Indicators',
      'Statistical Computing',
      'Data Quality & Validation',
    ]);
  });

  it('treats unassessed competencies as zero-mastery gaps', () => {
    const { gaps } = diagnose([]);
    expect(gaps).toHaveLength(COMPETENCIES.length);
    expect(gaps.every((g) => g.mastery === 0 && g.attempts === 0)).toBe(true);
  });
});

describe('overallReadiness', () => {
  it('averages mastery across the whole taxonomy', () => {
    const rows: CompetencyMastery[] = COMPETENCIES.map((c, i) => ({
      competency_tag: c,
      mastery: i * 10,
      attempts: 1,
      correct: 0,
      total: 0,
    }));
    expect(overallReadiness(rows)).toBe(35); // mean of 0..70
  });

  it('is 0 for a brand-new user', () => {
    expect(overallReadiness([])).toBe(0);
  });
});

describe('gap threshold', () => {
  it('is 60', () => {
    expect(GAP_THRESHOLD).toBe(60);
  });
});
