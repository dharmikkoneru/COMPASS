import type { Quiz } from './types';

/**
 * Real question counts per quiz — pure helpers, unit-tested in
 * src/lib/quizCounts.test.ts.
 *
 * `quizzes.question_count` is written optimistically by the generate-quiz edge
 * function: the quiz row is inserted *before* the questions are, so a
 * generation that dies in between leaves a row claiming five questions with
 * none behind it. The Materials list rendered that claimed number, which is how
 * an empty quiz advertised "5 Qs →" and then opened onto "This quiz has no
 * questions."
 *
 * So the count is derived from the question rows themselves. A PostgREST embed
 * is not the answer: `questions(count)` becomes an INNER join and therefore
 * hides precisely the empty quizzes this is meant to expose.
 */

/** quiz_id → how many question rows genuinely exist for that quiz. */
export function countQuestionsByQuiz(rows: Array<{ quiz_id: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.quiz_id] = (counts[row.quiz_id] ?? 0) + 1;
  }
  return counts;
}

/** Attach the stored count to each quiz, leaving the claimed one intact. */
export function withStoredCounts(quizzes: Quiz[], counts: Record<string, number>): Quiz[] {
  return quizzes.map((quiz) => ({ ...quiz, stored_question_count: counts[quiz.id] ?? 0 }));
}

export interface QuizCountLabel {
  text: string;
  /** True when the row holds no questions — a leftover from a failed generation. */
  empty: boolean;
}

/** Caption for a quiz in the Materials list. Falls back to the claimed count. */
export function quizCountLabel(quiz: Quiz): QuizCountLabel {
  const stored = quiz.stored_question_count ?? quiz.question_count;
  if (stored > 0) return { text: `${stored} Q${stored === 1 ? '' : 's'} →`, empty: false };
  return { text: 'no questions stored →', empty: true };
}
