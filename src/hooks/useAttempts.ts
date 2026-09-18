import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import type { AttemptRow } from '../lib/attempts';

/**
 * Signed-in user's recent quiz attempts, plus their quiz titles.
 *
 * Attempts are the record of every mastery update the officer has triggered —
 * the Dashboard shows them so a completed quiz is still visible after the
 * result screen is closed.
 */
export function useAttempts(limit = 5) {
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by refresh() to re-run the fetch — the Dashboard's refresh control
  // needs both this list and the mastery profile to come back from the server.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error: attemptErr } = await supabase
        .from('attempts')
        .select('id, quiz_id, user_id, score, total, status, submitted_at')
        .order('submitted_at', { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (attemptErr) {
        setError(errorMessage(attemptErr, 'Failed to load your attempt history'));
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as AttemptRow[];
      const quizIds = [...new Set(rows.map((r) => r.quiz_id))];
      const titleMap: Record<string, string> = {};

      if (quizIds.length > 0) {
        const { data: quizzes, error: quizErr } = await supabase
          .from('quizzes')
          .select('id, title')
          .in('id', quizIds);
        if (cancelled) return;
        if (quizErr) {
          setError(errorMessage(quizErr, 'Failed to load quiz titles'));
          setLoading(false);
          return;
        }
        for (const q of quizzes ?? []) titleMap[q.id as string] = q.title as string;
      }

      if (cancelled) return;
      setAttempts(rows);
      setTitles(titleMap);
      setError(null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [limit, reloadToken]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadToken((n) => n + 1);
  }, []);

  return { attempts, titles, loading, error, refresh };
}
