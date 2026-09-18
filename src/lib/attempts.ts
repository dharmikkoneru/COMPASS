import type { Attempt } from './types';

/** Attempt fields the history actually reads — the answers payload is not needed. */
export type AttemptRow = Omit<Attempt, 'answers'>;

/**
 * Attempt history — pure helpers, unit-tested in src/lib/attempts.test.ts.
 *
 * `attempts` is the one table the app writes but never read: every quiz
 * submission landed a row (via apply_attempt) and nothing surfaced it, so a
 * completed attempt vanished the moment the result screen was closed.
 */

export interface AttemptSummary {
  id: string;
  quizId: string;
  title: string;
  score: number;
  total: number;
  percent: number;
  submittedAt: string;
}

/**
 * Newest-first attempt summaries, with quiz titles resolved client-side.
 *
 * Two explicit reads rather than a PostgREST embed, matching the rest of the
 * app: an embed needs the FK to be visible in the schema cache or it 400s.
 * An attempt whose quiz can no longer be read keeps a placeholder title
 * instead of dropping out of the history.
 */
export function summarizeAttempts(
  attempts: AttemptRow[],
  titles: Record<string, string>,
  limit = 5,
): AttemptSummary[] {
  return [...attempts]
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))
    .slice(0, Math.max(0, limit))
    .map((a) => ({
      id: a.id,
      quizId: a.quiz_id,
      title: titles[a.quiz_id] ?? 'Untitled quiz',
      score: a.score,
      total: a.total,
      percent: a.total > 0 ? Math.round((a.score / a.total) * 100) : 0,
      submittedAt: a.submitted_at,
    }));
}

/** "12m ago" style timestamps for the history list. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(then).toLocaleDateString();
}

/** Pass rate across a set of attempts; null when there is nothing to average. */
export function averageScore(summaries: AttemptSummary[]): number | null {
  if (summaries.length === 0) return null;
  const sum = summaries.reduce((acc, s) => acc + s.percent, 0);
  return Math.round(sum / summaries.length);
}
