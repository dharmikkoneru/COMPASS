import { describe, expect, it } from 'vitest';
import { countQuestionsByQuiz, quizCountLabel, withStoredCounts } from './quizCounts';
import type { Quiz } from './types';

function quiz(id: string, question_count: number, stored?: number): Quiz {
  return {
    id,
    material_id: 'm1',
    created_by: 'u1',
    title: `Quiz ${id}`,
    difficulty: 'medium',
    question_count,
    created_at: '2026-09-01T10:00:00.000Z',
    ...(stored === undefined ? {} : { stored_question_count: stored }),
  };
}

describe('countQuestionsByQuiz', () => {
  it('groups rows by quiz id', () => {
    expect(
      countQuestionsByQuiz([
        { quiz_id: 'a' },
        { quiz_id: 'b' },
        { quiz_id: 'a' },
        { quiz_id: 'a' },
      ]),
    ).toEqual({ a: 3, b: 1 });
  });

  it('returns an empty map for no rows', () => {
    expect(countQuestionsByQuiz([])).toEqual({});
  });
});

describe('withStoredCounts', () => {
  it('attaches the stored count and defaults a missing quiz to zero', () => {
    const out = withStoredCounts([quiz('a', 5), quiz('b', 5)], { a: 3 });
    expect(out.map((q) => q.stored_question_count)).toEqual([3, 0]);
  });

  it('keeps the claimed count so the mismatch stays visible', () => {
    const [out] = withStoredCounts([quiz('a', 5)], { a: 0 });
    expect(out.question_count).toBe(5);
    expect(out.stored_question_count).toBe(0);
  });
});

describe('quizCountLabel', () => {
  it('reports the stored count, not the claimed one', () => {
    // The bug this guards: a row claiming 5 questions that holds 3.
    expect(quizCountLabel(quiz('a', 5, 3))).toEqual({ text: '3 Qs →', empty: false });
  });

  it('flags a quiz that holds no questions', () => {
    expect(quizCountLabel(quiz('a', 5, 0))).toEqual({
      text: 'no questions stored →',
      empty: true,
    });
  });

  it('does not say "Q s" for a single question', () => {
    expect(quizCountLabel(quiz('a', 1, 1)).text).toBe('1 Q →');
  });

  it('falls back to the claimed count when no stored count was attached', () => {
    expect(quizCountLabel(quiz('a', 8))).toEqual({ text: '8 Qs →', empty: false });
  });
});
