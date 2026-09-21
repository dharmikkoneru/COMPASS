import { useEffect, useMemo, useState } from 'react';
import { buildForecast, quizzesPerWeek, type Forecast } from '../lib/forecast';
import { supabase } from '../lib/supabase';
import type { CompetencyMastery } from '../lib/types';

/**
 * Skill-trend forecast for the signed-in officer.
 *
 * Mastery rows come from the caller (the Dashboard already loads them);
 * this hook adds the one extra read the forecast needs — attempt
 * timestamps for the observed quiz cadence — and keeps the projection
 * memoized so refreshes stay cheap.
 */
export function useForecast(rows: CompetencyMastery[]) {
  const [dates, setDates] = useState<string[]>([]);
  const [cadenceLoading, setCadenceLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Timestamps only — the smallest read that yields a rate estimate.
      const { data, error } = await supabase
        .from('attempts')
        .select('submitted_at')
        .order('submitted_at', { ascending: false });
      if (cancelled) return;
      if (!error) setDates((data ?? []).map((r) => r.submitted_at as string));
      setCadenceLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const forecast: Forecast = useMemo(
    () => buildForecast(rows, quizzesPerWeek(dates)),
    [rows, dates],
  );

  return { forecast, loading: cadenceLoading };
}
