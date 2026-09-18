import { describe, expect, it } from 'vitest';
import { averageScore, relativeTime, summarizeAttempts } from './attempts';
import type { Attempt } from './types';

function attempt(over: Partial<Attempt> & { id: string; quiz_id: string }): Attempt {
  return {
    user_id: 'u1',
    answers: {},
    score: 0,
    total: 0,
    status: 'completed',
    submitted_at: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

describe('summarizeAttempts', () => {
  it('sorts newest first regardless of input order', () => {
    const rows = [
      attempt({ id: 'old', quiz_id: 'q1', submitted_at: '2026-01-01T00:00:00.000Z' }),
      attempt({ id: 'new', quiz_id: 'q2', submitted_at: '2026-06-01T00:00:00.000Z' }),
    ];
    const out = summarizeAttempts(rows, {});
    expect(out.map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('resolves quiz titles and falls back to a placeholder', () => {
    const rows = [
      attempt({ id: 'a', quiz_id: 'q1' }),
      attempt({ id: 'b', quiz_id: 'gone' }),
    ];
    const out = summarizeAttempts(rows, { q1: 'Sampling Basics' });
    expect(out.find((a) => a.id === 'a')?.title).toBe('Sampling Basics');
    expect(out.find((a) => a.id === 'b')?.title).toBe('Untitled quiz');
  });

  it('computes a percentage and survives a zero-question quiz', () => {
    const rows = [
      attempt({ id: 'a', quiz_id: 'q1', score: 3, total: 4, submitted_at: '2026-06-01T00:00:00.000Z' }),
      attempt({ id: 'b', quiz_id: 'q2', score: 0, total: 0, submitted_at: '2026-05-01T00:00:00.000Z' }),
    ];
    const out = summarizeAttempts(rows, {});
    expect(out.map((a) => a.percent)).toEqual([75, 0]);
  });

  it('keeps only the requested number of rows', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      attempt({
        id: `a${i}`,
        quiz_id: 'q1',
        submitted_at: `2026-07-0${(i % 9) + 1}T00:00:00.000Z`,
      }),
    );
    expect(summarizeAttempts(rows, {}, 3)).toHaveLength(3);
    expect(summarizeAttempts(rows, {}, 0)).toHaveLength(0);
  });
});

describe('averageScore', () => {
  it('averages the percentages', () => {
    const summaries = summarizeAttempts(
      [
        attempt({ id: 'a', quiz_id: 'q1', score: 1, total: 2, submitted_at: '2026-01-02T00:00:00.000Z' }),
        attempt({ id: 'b', quiz_id: 'q2', score: 2, total: 2, submitted_at: '2026-01-01T00:00:00.000Z' }),
      ],
      {},
    );
    expect(averageScore(summaries)).toBe(75);
  });

  it('returns null with no attempts', () => {
    expect(averageScore([])).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-14T12:00:00.000Z');

  it('formats recent timestamps', () => {
    expect(relativeTime('2026-09-14T11:59:30.000Z', now)).toBe('just now');
    expect(relativeTime('2026-09-14T11:30:00.000Z', now)).toBe('30m ago');
    expect(relativeTime('2026-09-14T06:00:00.000Z', now)).toBe('6h ago');
    expect(relativeTime('2026-09-11T12:00:00.000Z', now)).toBe('3d ago');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(relativeTime('not-a-date', now)).toBe('');
  });
});
